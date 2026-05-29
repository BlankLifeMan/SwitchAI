use tauri::State;
use chrono::Utc;
use std::sync::atomic::Ordering;

use crate::config;
use crate::gateway::server;
use crate::gateway::types::GatewayStatus;
use crate::gateway::SharedGatewayState;

pub fn update_last_gateway_state(running: bool) {
    config::update_last_gateway_state(running);
}

#[tauri::command]
pub async fn start_gateway(
    state: State<'_, SharedGatewayState>,
) -> Result<GatewayStatus, String> {
    let result = start_gateway_inner(&state).await;
    if result.is_ok() {
        update_last_gateway_state(true);
    }
    result
}

pub async fn start_gateway_inner(state: &SharedGatewayState) -> Result<GatewayStatus, String> {
    let (host, port, db_clone) = {
        let mut gw = state.lock();
        gw.reload_config()?;
        server::validate_gateway_config(&gw.config)?;
        (
            gw.config.server.host.clone(),
            gw.config.server.port,
            gw.db.clone(),
        )
    };

    let handle = server::start_server(state.clone(), db_clone).await?;

    {
        let mut gw = state.lock();
        gw.handle = Some(handle);
        gw.start_time = Some(Utc::now());
        gw.running.store(true, Ordering::Release);
        gw.start_health_check_loop(state.clone());
    }

    Ok(GatewayStatus {
        running: true,
        host,
        port,
        uptime_seconds: Some(0),
        total_requests: 0,
        provider_health: std::collections::HashMap::new(),
    })
}

#[tauri::command]
pub async fn stop_gateway(
    state: State<'_, SharedGatewayState>,
) -> Result<GatewayStatus, String> {
    let result = stop_gateway_inner(&state).await;
    if result.is_ok() {
        update_last_gateway_state(false);
    }
    result
}

pub async fn stop_gateway_inner(state: &SharedGatewayState) -> Result<GatewayStatus, String> {
    let (host, port) = {
        let gw = state.lock();
        (
            gw.config.server.host.clone(),
            gw.config.server.port,
        )
    };

    let mut handle = {
        let mut gw = state.lock();
        gw.start_time = None;
        gw.running.store(false, Ordering::Release);
        gw.handle.take()
    };

    if let Some(ref mut h) = handle {
        server::stop_gateway(h).await?;
    }

    Ok(GatewayStatus {
        running: false,
        host,
        port,
        uptime_seconds: None,
        total_requests: 0,
        provider_health: std::collections::HashMap::new(),
    })
}

#[tauri::command]
pub async fn gateway_status(
    state: State<'_, SharedGatewayState>,
) -> Result<GatewayStatus, String> {
    Ok(get_status_inner(&state))
}

#[tauri::command]
pub async fn reset_provider_health(
    id: String,
    state: State<'_, SharedGatewayState>,
) -> Result<GatewayStatus, String> {
    {
        let gw = state.lock();
        let health_arc = gw.health_map();
        let mut health_map = health_arc.lock();
        if let Some(entry) = health_map.get_mut(&id) {
            entry.consecutive_failures = 0;
            entry.unhealthy = false;
            entry.last_error = None;
        } else {
            health_map.insert(id, crate::gateway::types::ProviderHealth {
                consecutive_failures: 0,
                unhealthy: false,
                last_check: Some(chrono::Utc::now().to_rfc3339()),
                last_error: None,
                latency_history: Vec::new(),
                average_latency_ms: None,
            });
        }
    }
    Ok(get_status_inner(&state))
}

pub fn get_status_inner(state: &SharedGatewayState) -> GatewayStatus {
    let gw = state.lock();
    let uptime = gw.start_time.map(|t| (Utc::now() - t).num_seconds() as u64);
    GatewayStatus {
        running: gw.is_running(),
        host: gw.config.server.host.clone(),
        port: gw.config.server.port,
        uptime_seconds: uptime,
        total_requests: gw.total_requests(),
        provider_health: gw.snapshot_health(),
    }
}
