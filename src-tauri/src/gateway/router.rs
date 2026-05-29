use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::gateway::types::{ChatCompletionMessage, Config, Provider, RoutingStrategy};

static ROUND_ROBIN_IDX: AtomicUsize = AtomicUsize::new(0);

pub struct RouteSelector {
    pub config: Config,
}

#[derive(Debug, Clone)]
pub struct ProviderCandidate {
    pub id: String,
    pub api_base: String,
    pub priority: u32,
}

#[derive(Debug, Clone)]
pub struct SelectedRoute {
    pub candidates: Vec<ProviderCandidate>,
    pub strategy: RoutingStrategy,
}

impl RouteSelector {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    pub fn select(&self, model_name: &str, is_multimodal: bool, health_map: &HashMap<String, crate::gateway::types::ProviderHealth>) -> Result<SelectedRoute, String> {
        let default_id = &self.config.server.default_model_id;

        if model_name == default_id {
            return self.select_default(is_multimodal, health_map);
        }

        if let Some(route) = self
            .config
            .routing
            .models
            .iter()
            .find(|r| crate::gateway::types::matches_wildcard(&r.model, model_name))
        {
            let mut candidates = self.resolve_order(&route.provider_order, is_multimodal, Some(model_name));
            if candidates.is_empty() {
                return Err(format!(
                    "No enabled providers found for routed model '{}'",
                    model_name
                ));
            }

            match route.strategy {
                RoutingStrategy::Failover => {
                    // Stays in resolved order
                }
                RoutingStrategy::LoadBalance => {
                    // Picked dynamically at request time
                }
                RoutingStrategy::LowestLatency => {
                    let get_latency = |c: &ProviderCandidate| -> u32 {
                        health_map.get(&c.id)
                            .and_then(|h| h.average_latency_ms)
                            .unwrap_or(9999)
                    };
                    candidates.sort_by_key(|c| get_latency(c));
                }
                RoutingStrategy::LowestCost => {
                    let get_cost = |c: &ProviderCandidate| -> f64 {
                        let actual_model = if self.config.server.gateway_mode == "unified" {
                            self.config.providers.iter()
                                .find(|p| p.id == c.id)
                                .and_then(|p| p.models.first().cloned())
                                .unwrap_or_else(|| model_name.to_string())
                        } else {
                            model_name.to_string()
                        };
                        let (in_p, out_p) = self.config.get_model_price(&actual_model);
                        in_p + out_p
                    };
                    candidates.sort_by(|a, b| {
                        get_cost(a).partial_cmp(&get_cost(b)).unwrap_or(std::cmp::Ordering::Equal)
                    });
                }
            }

            return Ok(SelectedRoute {
                candidates,
                strategy: route.strategy.clone(),
            });
        }

        let candidates = self.find_candidates(model_name, is_multimodal);

        if candidates.is_empty() {
            return Err(format!(
                "No provider supports model '{}'",
                model_name
            ));
        }

        let mut sorted = candidates;
        sorted.sort_by_key(|c| c.priority);
        sorted.reverse();

        Ok(SelectedRoute {
            candidates: sorted,
            strategy: RoutingStrategy::Failover,
        })
    }

    fn find_candidates(&self, model_name: &str, is_multimodal: bool) -> Vec<ProviderCandidate> {
        let eligible: Vec<&Provider> = self
            .config
            .providers
            .iter()
            .filter(|p| p.enabled && p.models.contains(&model_name.to_string()))
            .collect();

        if is_multimodal {
            let multimodal: Vec<ProviderCandidate> = eligible
                .iter()
                .filter(|p| p.multimodal_models.contains(&model_name.to_string()))
                .map(|p| ProviderCandidate {
                    id: p.id.clone(),
                    api_base: p.api_base.clone(),
                    priority: p.priority,
                })
                .collect();

            if !multimodal.is_empty() {
                return multimodal;
            }
            tracing::warn!(
                "html5 check: Multimodal request for model '{}', but no multimodal-capable provider found. Falling back to regular providers.",
                model_name
            );
        }

        eligible
            .iter()
            .map(|p| ProviderCandidate {
                id: p.id.clone(),
                api_base: p.api_base.clone(),
                priority: p.priority,
            })
            .collect()
    }

    fn resolve_order(&self, order: &[String], is_multimodal: bool, model_name: Option<&str>) -> Vec<ProviderCandidate> {
        let provider_map: HashMap<&str, &Provider> = self
            .config
            .providers
            .iter()
            .map(|p| (p.id.as_str(), p))
            .collect();

        let candidates: Vec<ProviderCandidate> = order
            .iter()
            .filter_map(|pid| {
                provider_map.get(pid.as_str()).and_then(|p| {
                    if !p.enabled {
                        return None;
                    }
                    Some(ProviderCandidate {
                        id: p.id.clone(),
                        api_base: p.api_base.clone(),
                        priority: p.priority,
                    })
                })
            })
            .collect();

        if is_multimodal {
            if let Some(model) = model_name {
                let multimodal: Vec<ProviderCandidate> = candidates
                    .iter()
                    .filter(|c| {
                        provider_map
                            .get(c.id.as_str())
                            .map(|p| p.multimodal_models.contains(&model.to_string()))
                            .unwrap_or(false)
                    })
                    .cloned()
                    .collect();

                if !multimodal.is_empty() {
                    return multimodal;
                }
                tracing::warn!(
                    "Multimodal request for model '{}' with custom routing order, but no multimodal-capable provider found. Falling back to regular providers.",
                    model
                );
            }
        }

        candidates
    }

    fn select_default(&self, is_multimodal: bool, _health_map: &HashMap<String, crate::gateway::types::ProviderHealth>) -> Result<SelectedRoute, String> {
        let enabled: Vec<&Provider> = self
            .config
            .providers
            .iter()
            .filter(|p| p.enabled && !p.models.is_empty())
            .collect();

        if enabled.is_empty() {
            return Err("No enabled provider with models available for default route".to_string());
        }

        let mut candidates: Vec<ProviderCandidate> = if is_multimodal {
            let mm: Vec<ProviderCandidate> = enabled
                .iter()
                .filter(|p| !p.multimodal_models.is_empty())
                .map(|p| ProviderCandidate {
                    id: p.id.clone(),
                    api_base: p.api_base.clone(),
                    priority: p.priority,
                })
                .collect();

            if !mm.is_empty() {
                mm
            } else {
                enabled
                    .iter()
                    .map(|p| ProviderCandidate {
                        id: p.id.clone(),
                        api_base: p.api_base.clone(),
                        priority: p.priority,
                    })
                    .collect()
            }
        } else {
            enabled
                .iter()
                .map(|p| ProviderCandidate {
                    id: p.id.clone(),
                    api_base: p.api_base.clone(),
                    priority: p.priority,
                })
                .collect()
        };

        candidates.sort_by_key(|c| c.priority);
        candidates.reverse();

        Ok(SelectedRoute {
            candidates,
            strategy: RoutingStrategy::Failover,
        })
    }

    pub fn pick_for_load_balance(candidates: &[ProviderCandidate]) -> usize {
        if candidates.is_empty() {
            return 0;
        }

        let total_weight: u32 = candidates.iter().map(|c| c.priority.max(1)).sum();
        if total_weight == 0 {
            let idx = ROUND_ROBIN_IDX.fetch_add(1, Ordering::Relaxed);
            return idx % candidates.len();
        }

        let current = ROUND_ROBIN_IDX.fetch_add(1, Ordering::Relaxed) as u32;
        let mod_val = current % total_weight;

        let mut cumulative = 0u32;
        for (i, c) in candidates.iter().enumerate() {
            let w = c.priority.max(1);
            cumulative += w;
            if mod_val < cumulative {
                return i;
            }
        }

        (current as usize) % candidates.len()
    }
}

pub fn is_multimodal_request(messages: &[ChatCompletionMessage]) -> bool {
    messages.iter().any(|m| {
        m.content.as_array().map_or(false, |arr| {
            arr.iter().any(|item| {
                item.get("type").and_then(|v| v.as_str()) == Some("image_url")
            })
        })
    })
}
