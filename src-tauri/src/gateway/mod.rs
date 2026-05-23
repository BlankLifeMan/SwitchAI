pub mod types;
pub mod router;
pub mod server;

use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use rusqlite::Connection;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::collections::HashMap;

use crate::db;
use types::{Config, ProviderHealth};

pub type SharedGatewayState = Arc<Mutex<GatewayState>>;

pub struct GatewayState {
    pub config: Config,
    pub db: Arc<Mutex<Connection>>,
    pub running: AtomicBool,
    pub start_time: Option<DateTime<Utc>>,
    pub handle: Option<tokio::task::JoinHandle<()>>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    request_count: Arc<AtomicU64>,
    provider_health: Arc<Mutex<HashMap<String, ProviderHealth>>>,
    health_handle: Option<tokio::task::JoinHandle<()>>,
}

impl GatewayState {
    pub fn new(config: Config, db: Arc<Mutex<Connection>>) -> Self {
        Self {
            config,
            db,
            running: AtomicBool::new(false),
            start_time: None,
            handle: None,
            shutdown_tx: None,
            request_count: Arc::new(AtomicU64::new(0)),
            provider_health: Arc::new(Mutex::new(HashMap::new())),
            health_handle: None,
        }
    }

    pub fn request_counter(&self) -> Arc<AtomicU64> {
        self.request_count.clone()
    }

    pub fn total_requests(&self) -> u64 {
        self.request_count.load(Ordering::Relaxed)
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn set_shutdown_tx(&mut self, tx: tokio::sync::oneshot::Sender<()>) {
        self.shutdown_tx = Some(tx);
    }

    pub fn take_shutdown_tx(&mut self) -> Option<tokio::sync::oneshot::Sender<()>> {
        self.shutdown_tx.take()
    }

    pub fn add_log(&self, log: &types::RequestLog) {
        let conn = self.db.lock();
        if let Err(e) = db::add_log(&conn, log) {
            tracing::error!("Failed to persist log: {}", e);
        }
    }

    pub fn health_map(&self) -> Arc<Mutex<HashMap<String, ProviderHealth>>> {
        self.provider_health.clone()
    }

    pub fn snapshot_health(&self) -> HashMap<String, ProviderHealth> {
        self.provider_health.lock().clone()
    }

    pub fn start_health_check_loop(&mut self, state: SharedGatewayState) {
        let health = self.provider_health.clone();
        let db = self.db.clone();
        let handle = tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .ok();
            let Some(client) = client else {
                tracing::error!("Health check loop: failed to build reqwest client");
                return;
            };
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                let providers = {
                    let gw = state.lock();
                    if !gw.is_running() {
                        break;
                    }
                    gw.config.providers.clone()
                };
                for p in &providers {
                    if !p.enabled {
                        continue;
                    }
                    let api_key = {
                        let conn = db.lock();
                        crate::db::get_api_key(&conn, &p.id).unwrap_or(None)
                    };
                    let ok = check_provider_health(&client, &p.api_base, api_key.as_deref()).await;
                    let mut health_map = health.lock();
                    let entry = health_map.entry(p.id.clone()).or_insert_with(|| ProviderHealth {
                        consecutive_failures: 0,
                        unhealthy: false,
                        last_check: None,
                        last_error: None,
                    });
                    entry.last_check = Some(chrono::Utc::now().to_rfc3339());
                    if ok {
                        if entry.unhealthy {
                            tracing::info!("Provider '{}' recovered - marking healthy", p.id);
                        }
                        entry.consecutive_failures = 0;
                        entry.unhealthy = false;
                        entry.last_error = None;
                    } else {
                        entry.consecutive_failures += 1;
                        entry.last_error = Some("Health check to /v1/models failed".to_string());
                        if entry.consecutive_failures >= 3 && !entry.unhealthy {
                            tracing::warn!(
                                "Provider '{}' failed {} health checks - marking unhealthy",
                                p.id,
                                entry.consecutive_failures
                            );
                            entry.unhealthy = true;
                        }
                    }
                }
            }
        });
        self.health_handle = Some(handle);
    }

    pub fn reload_config(&mut self) -> Result<(), String> {
        let conn = self.db.lock();
        let config = db::load_config(&conn)?
            .unwrap_or_default();
        self.config = config;
        Ok(())
    }
}

async fn check_provider_health(client: &reqwest::Client, api_base: &str, api_key: Option<&str>) -> bool {
    let url = format!("{}/v1/models", api_base.trim_end_matches('/'));
    let mut req = client.get(&url);
    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    match req.send().await {
        Ok(resp) => resp.status().is_success(),
        Err(e) => {
            tracing::debug!("Health check failed for {}: {}", url, e);
            false
        }
    }
}
