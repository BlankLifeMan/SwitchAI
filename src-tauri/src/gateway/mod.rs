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
    log_tx: tokio::sync::mpsc::UnboundedSender<types::RequestLog>,
    log_rx: Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<types::RequestLog>>>,
}

impl GatewayState {
    pub fn new(config: Config, db: Arc<Mutex<Connection>>) -> Self {
        let (log_tx, log_rx) = tokio::sync::mpsc::unbounded_channel::<types::RequestLog>();

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
            log_tx,
            log_rx: Mutex::new(Some(log_rx)),
        }
    }

    pub fn spawn_log_worker(&self) {
        let mut rx_opt = self.log_rx.lock();
        if let Some(mut rx) = rx_opt.take() {
            let db_clone = self.db.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(log) = rx.recv().await {
                    let conn = db_clone.lock();
                    if let Err(e) = db::add_log(&conn, &log) {
                        tracing::error!("Failed to persist log: {}", e);
                    }
                }
            });
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
        if let Err(e) = self.log_tx.send(log.clone()) {
            tracing::error!("Failed to send log to database worker: {}", e);
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
                let providers = {
                    let gw = state.lock();
                    if !gw.is_running() {
                        break;
                    }
                    gw.config.providers.clone()
                };
                
                let mut futures = Vec::new();
                for p in &providers {
                    if !p.enabled || !p.auto_health_check {
                        continue;
                    }
                    let api_key = {
                        let conn = db.lock();
                        crate::db::get_api_key(&conn, &p.id).unwrap_or(None)
                    };
                    let client = client.clone();
                    let health = health.clone();
                    let p_id = p.id.clone();
                    let api_base = p.api_base.clone();
                    
                    futures.push(tokio::spawn(async move {
                        let latency = check_provider_health(&client, &api_base, api_key.as_deref()).await;
                        let mut health_map = health.lock();
                        let entry = health_map.entry(p_id.clone()).or_insert_with(|| ProviderHealth {
                            consecutive_failures: 0,
                            unhealthy: false,
                            last_check: None,
                            last_error: None,
                            latency_history: Vec::new(),
                            average_latency_ms: None,
                        });
                        entry.last_check = Some(chrono::Utc::now().to_rfc3339());
                        if let Some(lat) = latency {
                            if entry.unhealthy {
                                tracing::info!("Provider '{}' recovered - marking healthy", p_id);
                            }
                            entry.consecutive_failures = 0;
                            entry.unhealthy = false;
                            entry.last_error = None;
                            
                            entry.latency_history.push(lat);
                            if entry.latency_history.len() > 10 {
                                entry.latency_history.remove(0);
                            }
                            let sum: u32 = entry.latency_history.iter().sum();
                            entry.average_latency_ms = Some(sum / entry.latency_history.len() as u32);
                        } else {
                            entry.consecutive_failures += 1;
                            entry.last_error = Some("Health check to /v1/models failed".to_string());
                            if entry.consecutive_failures >= 3 && !entry.unhealthy {
                                tracing::warn!(
                                    "Provider '{}' failed {} health checks - marking unhealthy",
                                    p_id,
                                    entry.consecutive_failures
                                );
                                entry.unhealthy = true;
                            }
                        }
                    }));
                }
                let _ = futures::future::join_all(futures).await;
                
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
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

async fn check_provider_health(client: &reqwest::Client, api_base: &str, api_key: Option<&str>) -> Option<u32> {
    let url = format!("{}/v1/models", api_base.trim_end_matches('/'));
    let mut req = client.get(&url);
    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let start = std::time::Instant::now();
    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
                Some(start.elapsed().as_millis() as u32)
            } else {
                None
            }
        }
        Err(e) => {
            tracing::debug!("Health check failed for {}: {}", url, e);
            None
        }
    }
}
