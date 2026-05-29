use crate::db;
use crate::gateway::types::{
    Config, ConfigDisplay, Provider, ProviderDisplay, RoutingConfig, ClientApiKey, ModelPrice,
};
use parking_lot::Mutex;
use rusqlite::Connection;
use std::sync::Arc;
use tauri::State;

use std::collections::HashMap;

fn config_to_display(config: &Config) -> ConfigDisplay {
    ConfigDisplay {
        providers: config.providers.iter().map(ProviderDisplay::from).collect(),
        routing: config.routing.clone(),
        server: config.server.clone(),
        api_key: config.api_key.clone(),
        theme: config.theme.clone(),
        language: config.language.clone(),
        auto_start: config.auto_start,
        gateway_on_startup: config.gateway_on_startup,
        last_gateway_state: config.last_gateway_state,
        model_mappings: config.model_mappings.clone(),
        client_api_keys: config.client_api_keys.clone(),
        model_prices: config.model_prices.clone(),
    }
}

#[tauri::command]
pub fn get_config(
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<ConfigDisplay, String> {
    let conn = db.lock();
    let config = db::load_config(&conn)?
        .unwrap_or_default();
    Ok(config_to_display(&config))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_config(
    port: u16,
    log_retention_days: u32,
    api_key: String,
    theme: String,
    language: String,
    auto_start: bool,
    gateway_on_startup: bool,
    default_model_id: String,
    token_price_per_1k: f64,
    gateway_mode: String,
    providers: Vec<Provider>,
    routing: RoutingConfig,
    model_mappings: HashMap<String, String>,
    client_api_keys: Vec<ClientApiKey>,
    model_prices: Vec<ModelPrice>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<ConfigDisplay, String> {
    let conn = db.lock();
    let mut current = db::load_config(&conn)?
        .unwrap_or_default();

    current.server.port = port;
    current.server.log_retention_days = log_retention_days;
    current.server.default_model_id = default_model_id;
    current.server.token_price_per_1k = token_price_per_1k;
    current.server.gateway_mode = gateway_mode;
    current.api_key = api_key;
    current.theme = theme;
    current.language = language;
    current.auto_start = auto_start;
    current.gateway_on_startup = gateway_on_startup;
    current.providers = providers;
    current.routing = routing;
    current.model_mappings = model_mappings;
    current.client_api_keys = client_api_keys;
    current.model_prices = model_prices;

    db::save_config(&conn, &current, true)?;
    Ok(config_to_display(&current))
}

#[tauri::command]
pub fn add_provider(
    name: String,
    api_base: String,
    api_key: String,
    priority: u32,
    enabled: bool,
    models: Vec<String>,
    multimodal_models: Vec<String>,
    auto_health_check: bool,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<ConfigDisplay, String> {
    let conn = db.lock();
    let mut config = db::load_config(&conn)?
        .unwrap_or_default();

    let id = crate::config::generate_provider_id(&name);
    let provider = Provider {
        id: id.clone(),
        name,
        api_base,
        api_key_ref: Some(id.clone()),
        priority,
        enabled,
        models,
        multimodal_models,
        auto_health_check,
    };

    if !api_key.is_empty() {
        db::store_api_key(&conn, &id, &api_key)?;
    }

    config.providers.push(provider);
    db::save_config(&conn, &config, true)?;
    Ok(config_to_display(&config))
}

#[tauri::command]
pub fn update_provider(
    id: String,
    name: String,
    api_base: String,
    api_key: Option<String>,
    priority: u32,
    enabled: bool,
    models: Vec<String>,
    multimodal_models: Vec<String>,
    auto_health_check: bool,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<ConfigDisplay, String> {
    let conn = db.lock();
    let mut config = db::load_config(&conn)?
        .unwrap_or_default();

    let provider = config
        .providers
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("Provider not found")?;

    provider.name = name;
    provider.api_base = api_base;
    provider.priority = priority;
    provider.enabled = enabled;
    provider.models = models;
    provider.multimodal_models = multimodal_models;
    provider.auto_health_check = auto_health_check;

    if let Some(key) = api_key {
        if !key.is_empty() {
            db::store_api_key(&conn, &id, &key)?;
        }
    }

    db::save_config(&conn, &config, true)?;
    Ok(config_to_display(&config))
}

#[tauri::command]
pub fn delete_provider(
    id: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<ConfigDisplay, String> {
    let conn = db.lock();
    let mut config = db::load_config(&conn)?
        .unwrap_or_default();

    config.providers.retain(|p| p.id != id);
    config.routing.models.retain(|r| !r.provider_order.contains(&id));

    let _ = db::delete_api_key(&conn, &id);
    db::save_config(&conn, &config, true)?;
    Ok(config_to_display(&config))
}

#[tauri::command]
pub async fn test_provider(
    id: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<crate::gateway::types::TestResult, String> {
    let (api_base, api_key) = {
        let conn = db.lock();
        let config = db::load_config(&conn)?
            .unwrap_or_default();
        let provider = config
            .providers
            .iter()
            .find(|p| p.id == id)
            .ok_or("Provider not found")?
            .clone();

        let key = db::get_api_key(&conn, &id)?
            .ok_or_else(|| "No API key configured for this provider. Edit the provider and re-enter the API key to store it again.".to_string())?;

        (provider.api_base, key)
    };

    test_connectivity(&api_base, &api_key).await
}

#[tauri::command]
pub async fn test_provider_direct(
    api_base: String,
    api_key: String,
) -> Result<crate::gateway::types::TestResult, String> {
    test_connectivity(&api_base, &api_key).await
}

async fn test_connectivity(api_base: &str, api_key: &str) -> Result<crate::gateway::types::TestResult, String> {
    let client = reqwest::Client::new();
    let test_url = format!("{}/v1/models", api_base.trim_end_matches('/'));
    match client
        .get(&test_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if status == 200 {
                match resp.json::<serde_json::Value>().await {
                    Ok(body) => Ok(crate::gateway::types::TestResult {
                        success: true,
                        message: format!(
                            "Connected — {} models available",
                            body.get("data")
                                .and_then(|d| d.as_array())
                                .map(|a| a.len())
                                .unwrap_or(0)
                        ),
                    }),
                    Err(_) => Ok(crate::gateway::types::TestResult {
                        success: true,
                        message: "Connected".to_string(),
                    }),
                }
            } else {
                let body = resp.text().await.unwrap_or_default();
                Ok(crate::gateway::types::TestResult {
                    success: false,
                    message: format!("HTTP {}: {}", status, body.chars().take(200).collect::<String>()),
                })
            }
        }
        Err(e) => Ok(crate::gateway::types::TestResult {
            success: false,
            message: format!("Connection failed: {}", e),
        }),
    }
}
