use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use futures::StreamExt;
use parking_lot::Mutex;
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::oneshot;

use crate::db;
use crate::gateway::router::{self, ProviderCandidate, RouteSelector};
use crate::gateway::types::*;
use crate::gateway::{GatewayState, SharedGatewayState};
use rusqlite::Connection;

pub struct AppState {
    pub gateway: Arc<Mutex<GatewayState>>,
    pub db: Arc<Mutex<Connection>>,
}

pub async fn start_server(
    gw_state: SharedGatewayState,
    db: Arc<Mutex<Connection>>,
) -> Result<tokio::task::JoinHandle<()>, String> {
    let app_state = Arc::new(AppState {
        gateway: gw_state,
        db,
    });

    let app = Router::new()
        .route("/v1/chat/completions", post(chat_handler))
        .route("/v1/embeddings", post(embeddings_handler))
        .route("/v1/models", get(models_handler))
        .route("/health", get(health_handler))
        .route("/", get(health_handler))
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(
            tower_http::cors::CorsLayer::permissive()
                .expose_headers([
                    axum::http::HeaderName::from_static("x-switchai-trace")
                ])
        )
        .with_state(app_state.clone());

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let bind_addr = {
        let mut state = app_state.gateway.lock();
        state.set_shutdown_tx(shutdown_tx);
        format!("{}:{}", state.config.server.host, state.config.server.port)
    };

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", bind_addr, e))?;

    tracing::info!("Gateway listening on http://{}/v1", bind_addr);

    let handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
                tracing::info!("Gateway shutting down gracefully");
            })
            .await
            .unwrap_or_else(|e| {
                tracing::error!("Gateway server error: {}", e);
            });
    });

    Ok(handle)
}

pub async fn stop_gateway(handle: &mut tokio::task::JoinHandle<()>) -> Result<(), String> {
    handle.abort();
    Ok(())
}

pub fn validate_gateway_config(config: &Config) -> Result<(), String> {
    if config.api_key.is_empty() {
        return Err("API key cannot be empty. Please set an API key in Settings.".to_string());
    }
    if config.providers.is_empty() {
        return Err("No providers configured".to_string());
    }
    let has_enabled = config.providers.iter().any(|p| p.enabled);
    if !has_enabled {
        return Err("No enabled providers".to_string());
    }
    Ok(())
}

fn authenticate_and_get_client(headers: &HeaderMap, config: &Config) -> Option<String> {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if auth.is_empty() {
        return None;
    }
    let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
    if token == config.api_key {
        return Some("Admin".to_string());
    }
    for client_key in &config.client_api_keys {
        if client_key.enabled && client_key.api_key == token {
            return Some(client_key.name.clone());
        }
    }
    None
}

#[derive(Debug, Clone, serde::Serialize)]
struct RouteAttempt {
    provider_id: String,
    endpoint: String,
    status_code: u16,
    duration_ms: u64,
    success: bool,
    error_message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
struct AttemptTrace {
    model: String,
    routing_strategy: String,
    attempts: Vec<RouteAttempt>,
}

fn provider_error_response(message: &str, trace: Option<String>) -> Response {
    let mut builder = Response::builder()
        .status(StatusCode::SERVICE_UNAVAILABLE)
        .header("Content-Type", "application/json");
    if let Some(t) = trace {
        builder = builder.header("X-SwitchAI-Trace", t);
    }
    builder.body(axum::body::Body::from(serde_json::to_vec(&serde_json::json!({
        "error": {
            "message": message,
            "type": "provider_error"
        }
    })).unwrap()))
    .unwrap_or_else(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response()
    })
}

fn bad_request_response(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": {
                "message": message,
                "type": "invalid_request_error"
            }
        })),
    )
        .into_response()
}

fn build_response(status: StatusCode, content_type: &str, provider: &str, trace: Option<String>, body: axum::body::Body) -> Response {
    let provider_header = format!("switchai-{}", provider);
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("X-Provider", provider_header);
    if let Some(t) = trace {
        builder = builder.header("X-SwitchAI-Trace", t);
    }
    builder.body(body)
        .unwrap_or_else(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response()
        })
}

async fn health_handler() -> Response {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "service": "SwitchAI Gateway"
    }))
    .into_response()
}

async fn models_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    let (gateway_config, default_model_id) = {
        let gw = state.gateway.lock();
        let unhealthy_ids: Vec<String> = gw.provider_health.lock()
            .iter()
            .filter(|(_, h)| h.unhealthy)
            .map(|(id, _)| id.clone())
            .collect();
        let mut providers = gw.config.providers.clone();
        if !unhealthy_ids.is_empty() {
            for p in &mut providers {
                if unhealthy_ids.contains(&p.id) && p.enabled {
                    p.enabled = false;
                }
            }
        }
        let mut config = gw.config.clone();
        config.providers = providers;
        (
            config,
            gw.config.server.default_model_id.clone(),
        )
    };

    if authenticate_and_get_client(&headers, &gateway_config).is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": {"message": "Invalid API key", "type": "unauthorized"}
            })),
        )
            .into_response();
    }

    let mut set = std::collections::HashSet::new();
    let mut multimodal_set = std::collections::HashSet::new();
    set.insert(default_model_id.clone());
    for p in &gateway_config.providers {
        if p.enabled {
            for m in &p.models {
                set.insert(m.clone());
            }
            for m in &p.multimodal_models {
                multimodal_set.insert(m.clone());
            }
        }
    }
    let mut models: Vec<String> = set.into_iter().collect();
    models.sort();

    let json_models: Vec<serde_json::Value> = models
        .into_iter()
        .map(|id| {
            let is_multimodal = multimodal_set.contains(&id);
            let mut obj = serde_json::json!({
                "id": id,
                "object": "model",
                "owned_by": "switchai"
            });
            if is_multimodal {
                obj["multimodal"] = serde_json::Value::Bool(true);
            }
            obj
        })
        .collect();

    Json(serde_json::json!({
        "object": "list",
        "data": json_models
    }))
    .into_response()
}

async fn chat_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut request): Json<ChatCompletionRequest>,
) -> Response {
    let start_time = std::time::Instant::now();
    let is_stream = request.stream.unwrap_or(false);

    let (mut gateway_config, request_counter, health_map) = {
        let gw = state.gateway.lock();
        (
            gw.config.clone(),
            gw.request_counter(),
            gw.health_map(),
        )
    };

    let original_model = request.model.clone();
    let mut model = if gateway_config.server.gateway_mode == "unified" {
        gateway_config.server.default_model_id.clone()
    } else {
        original_model.clone()
    };

    if gateway_config.server.gateway_mode != "unified" {
        for (src_pattern, target_model) in &gateway_config.model_mappings {
            if crate::gateway::types::matches_wildcard(src_pattern, &model) {
                tracing::info!("Wildcard mapping model '{}' (pattern '{}') to '{}'", model, src_pattern, target_model);
                model = target_model.clone();
                request.model = target_model.clone();
                break;
            }
        }
    }

    let unhealthy_ids: Vec<String> = {
        health_map.lock().iter()
            .filter(|(_, h)| h.unhealthy)
            .map(|(id, _)| id.clone())
            .collect()
    };
    if !unhealthy_ids.is_empty() {
        for p in &mut gateway_config.providers {
            if unhealthy_ids.contains(&p.id) && p.enabled {
                tracing::warn!("Provider '{}' is unhealthy - temporarily disabling in route selection", p.id);
                p.enabled = false;
            }
        }
    }

    request_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let client_key_name = match authenticate_and_get_client(&headers, &gateway_config) {
        Some(name) => name,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": {"message": "Invalid API key", "type": "unauthorized"}
                })),
            )
                .into_response();
        }
    };

    let selector = RouteSelector::new(gateway_config.clone());

    let is_multimodal = router::is_multimodal_request(&request.messages);

    let route = match selector.select(&model, is_multimodal, &health_map.lock()) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("chat_handler: route selection failed for '{}': {}", model, e);
            return provider_error_response(&e, None);
        }
    };

    let effective_model = if model == gateway_config.server.default_model_id {
        gateway_config
            .providers
            .iter()
            .find(|p| p.enabled && !p.models.is_empty())
            .and_then(|p| p.models.first())
            .cloned()
            .unwrap_or(model.clone())
    } else {
        model.clone()
    };

    let candidates_with_keys: Vec<(String, String, String)> = {
        let conn = state.db.lock();
        route
            .candidates
            .iter()
            .filter_map(|c| match db::get_api_key(&conn, &c.id) {
                Ok(Some(key)) => Some((c.id.clone(), c.api_base.clone(), key)),
                Ok(None) => {
                    tracing::error!(
                        "provider '{}' has no API key in DB — save the provider again with a new key",
                        c.id
                    );
                    None
                }
                Err(e) => {
                    tracing::error!("failed to read API key for provider '{}': {}", c.id, e);
                    None
                }
            })
            .collect()
    };

    if candidates_with_keys.is_empty() {
        let failed_ids: Vec<_> = route.candidates.iter().map(|c| &c.id).collect();
        tracing::error!(
            "chat_handler: all {} provider(s) failed keyring lookup: {:?}",
            route.candidates.len(),
            failed_ids
        );
        return provider_error_response(
            "No available provider with valid API key. Try editing each provider and re-entering the key, then save again.",
            None,
        );
    }

    let lb_candidates: Vec<ProviderCandidate> = route
        .candidates
        .iter()
        .filter(|c| candidates_with_keys.iter().any(|(id, _, _)| &c.id == id))
        .cloned()
        .collect();
    let start_idx = if route.strategy == RoutingStrategy::Failover {
        0
    } else {
        RouteSelector::pick_for_load_balance(&lb_candidates)
    };
    let max_tries = candidates_with_keys.len();

    if is_stream {
        request.extra.insert(
            "stream_options".to_string(),
            serde_json::json!({ "include_usage": true }),
        );
    }

    request.model = effective_model.clone();
    let request_body = match serde_json::to_string(&request) {
        Ok(b) => b,
        Err(e) => return bad_request_response(&format!("Failed to serialize request: {}", e)),
    };
    let request_body = std::sync::Arc::new(request_body);

    let is_unified = gateway_config.server.gateway_mode == "unified";

    let trace = AttemptTrace {
        model: model.clone(),
        routing_strategy: serde_json::to_value(&route.strategy)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| format!("{:?}", route.strategy)),
        attempts: Vec::new(),
    };

    if is_stream {
        return handle_streaming_chat(
            &state,
            &candidates_with_keys,
            start_idx,
            max_tries,
            &request_body,
            &effective_model,
            start_time,
            client_key_name,
            &original_model,
            is_unified,
            trace,
        )
        .await;
    }

    handle_non_streaming_chat(
        &state,
        &candidates_with_keys,
        start_idx,
        max_tries,
        &request_body,
        &effective_model,
        start_time,
        client_key_name,
        &original_model,
        is_unified,
        trace,
    )
    .await
}

async fn handle_non_streaming_chat(
    state: &Arc<AppState>,
    candidates: &[(String, String, String)],
    start_idx: usize,
    max_tries: usize,
    request_body: &Arc<String>,
    model: &str,
    start_time: std::time::Instant,
    client_key_name: String,
    _original_model: &str,
    is_unified: bool,
    mut trace: AttemptTrace,
) -> Response {
    let client = Client::new();

    for attempt in 0..max_tries {
        let idx = (start_idx + attempt) % candidates.len();
        let (pid, api_base, api_key) = &candidates[idx];

        let url = format!("{}/chat/completions", api_base.trim_end_matches('/'));

        let actual_model = if is_unified {
            let gw = state.gateway.lock();
            gw.config.providers.iter()
                .find(|p| p.id == *pid)
                .and_then(|p| p.models.first().cloned())
                .unwrap_or_else(|| model.to_string())
        } else {
            model.to_string()
        };

        let attempt_body = if is_unified {
            let mut parsed: serde_json::Value = serde_json::from_str(request_body.as_str()).unwrap_or_default();
            parsed["model"] = serde_json::json!(actual_model);
            serde_json::to_string(&parsed).unwrap_or_else(|_| request_body.as_str().to_string())
        } else {
            request_body.as_str().to_string()
        };

        let attempt_start = std::time::Instant::now();
        match client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .body(attempt_body.clone())
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
        {
            Ok(response) => {
                let status_code = response.status().as_u16();

                if !(200..300).contains(&status_code) {
                    let error_body = response.text().await.unwrap_or_default();
                    let duration_ms = attempt_start.elapsed().as_millis() as u64;
                    trace.attempts.push(RouteAttempt {
                        provider_id: pid.clone(),
                        endpoint: url.clone(),
                        status_code,
                        duration_ms,
                        success: false,
                        error_message: Some(format!(
                            "Upstream {}: {}",
                            status_code,
                            error_body.chars().take(100).collect::<String>()
                        )),
                    });

                    let log = RequestLog {
                        timestamp: Utc::now(),
                        model: actual_model.clone(),
                        provider: pid.clone(),
                        status_code,
                        input_tokens: None,
                        output_tokens: None,
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        success: false,
                        error_message: Some(format!(
                            "Upstream {}: {}",
                            status_code,
                            error_body.chars().take(200).collect::<String>()
                        )),
                        is_streaming: false,
                        request_body: Some(truncate_body(&attempt_body, 8000)),
                        response_body: Some(error_body.chars().take(2000).collect()),
                        endpoint: Some(url),
                        request_headers: None,
                        client_key_name: Some(client_key_name.clone()),
                    };
                    state.gateway.lock().add_log(&log);

                    if attempt + 1 < max_tries {
                        tracing::warn!(
                            "Provider {} returned {} (attempt {}/{}), trying next",
                            pid, status_code, attempt + 1, max_tries
                        );
                        continue;
                    }

                    let trace_json = serde_json::to_string(&trace).ok();
                    return build_response(
                        StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY),
                        "application/json",
                        pid.as_str(),
                        trace_json,
                        axum::body::Body::from(error_body),
                    );
                }

                let body_bytes = match response.bytes().await {
                    Ok(b) => b,
                    Err(e) => {
                        tracing::error!("Failed to read response body from {}: {}", pid, e);
                        let duration_ms = attempt_start.elapsed().as_millis() as u64;
                        trace.attempts.push(RouteAttempt {
                            provider_id: pid.clone(),
                            endpoint: url.clone(),
                            status_code: 500,
                            duration_ms,
                            success: false,
                            error_message: Some(format!("Failed to read response body: {}", e)),
                        });
                        if attempt + 1 < max_tries {
                            continue;
                        }
                        let trace_json = serde_json::to_string(&trace).ok();
                        return provider_error_response(&format!("Failed to read response: {}", e), trace_json);
                    }
                };
                let body_text = String::from_utf8_lossy(&body_bytes).to_string();
                let parsed: serde_json::Value =
                    serde_json::from_str(&body_text).unwrap_or(serde_json::Value::Null);

                let (input_tokens, output_tokens) = extract_tokens(&parsed);
                let (input_tokens, output_tokens) = get_tokens_with_fallback(
                    input_tokens,
                    output_tokens,
                    &attempt_body,
                    &body_text,
                    false,
                    false,
                    None,
                );

                let duration_ms = attempt_start.elapsed().as_millis() as u64;
                trace.attempts.push(RouteAttempt {
                    provider_id: pid.clone(),
                    endpoint: url.clone(),
                    status_code,
                    duration_ms,
                    success: true,
                    error_message: None,
                });

                let log = RequestLog {
                    timestamp: Utc::now(),
                    model: actual_model.clone(),
                    provider: pid.clone(),
                    status_code,
                    input_tokens,
                    output_tokens,
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    success: true,
                    error_message: None,
                    is_streaming: false,
                    request_body: Some(truncate_body(&attempt_body, 8000)),
                    response_body: Some(body_text.chars().take(2000).collect()),
                    endpoint: Some(url),
                    request_headers: None,
                    client_key_name: Some(client_key_name.clone()),
                };
                state.gateway.lock().add_log(&log);

                let trace_json = serde_json::to_string(&trace).ok();
                return build_response(
                    StatusCode::from_u16(status_code).unwrap_or(StatusCode::OK),
                    "application/json",
                    pid.as_str(),
                    trace_json,
                    axum::body::Body::from(body_bytes),
                );
            }
            Err(e) => {
                let duration_ms = attempt_start.elapsed().as_millis() as u64;
                trace.attempts.push(RouteAttempt {
                    provider_id: pid.clone(),
                    endpoint: url.clone(),
                    status_code: 0,
                    duration_ms,
                    success: false,
                    error_message: Some(e.to_string()),
                });
                tracing::warn!("Provider {} connection failed (attempt {}/{}): {}", pid, attempt + 1, max_tries, e);
                if attempt + 1 >= max_tries {
                    let trace_json = serde_json::to_string(&trace).ok();
                    return provider_error_response(&format!("All providers failed: {}", e), trace_json);
                }
            }
        }
    }

    let trace_json = serde_json::to_string(&trace).ok();
    provider_error_response("All providers exhausted", trace_json)
}

fn extract_tokens(parsed: &serde_json::Value) -> (Option<u32>, Option<u32>) {
    let usage = match parsed {
        serde_json::Value::Object(root) => {
            root.get("usage").or_else(|| root.get("usageMetadata"))
        }
        _ => parsed.get("usage"),
    };

    let usage = match usage {
        Some(u) => u,
        None => {
            tracing::debug!("extract_tokens: no 'usage' field in response");
            return (None, None);
        }
    };

    let input = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .or_else(|| usage.get("promptTokenCount"))
        .and_then(|v| v.as_u64())
        .map(|t| t as u32);

    let output = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .or_else(|| usage.get("candidatesTokenCount"))
        .and_then(|v| v.as_u64())
        .map(|t| t as u32);

    let input = input.or_else(|| {
        usage
            .get("total_tokens")
            .or_else(|| usage.get("totalTokenCount"))
            .and_then(|v| v.as_u64())
            .map(|t| (t as f64 * 0.7) as u32)
    });

    let output = output.or_else(|| {
        usage
            .get("total_tokens")
            .or_else(|| usage.get("totalTokenCount"))
            .and_then(|v| v.as_u64())
            .map(|t| (t as f64 * 0.3) as u32)
    });

    tracing::debug!(
        "extract_tokens: input={:?}, output={:?}, usage_keys={:?}",
        input,
        output,
        usage.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );

    (input, output)
}

fn extract_tokens_from_sse_data(data: &str) -> (Option<u32>, Option<u32>) {
    let parsed: serde_json::Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    extract_tokens(&parsed)
}

fn extract_tokens_from_sse_chunks(chunks: &[String]) -> (Option<u32>, Option<u32>) {
    let mut last_input = None;
    let mut last_output = None;
    for chunk in chunks {
        if chunk == "[DONE]" {
            continue;
        }
        let (inp, out) = extract_tokens_from_sse_data(chunk);
        if inp.is_some() {
            last_input = inp;
        }
        if out.is_some() {
            last_output = out;
        }
    }
    (last_input, last_output)
}

fn truncate_body(body: &str, max_len: usize) -> String {
    if body.len() <= max_len {
        body.to_string()
    } else {
        body.chars().take(max_len).collect()
    }
}

fn estimate_tokens(text: &str) -> u32 {
    let mut tokens = 0;
    for c in text.chars() {
        if c.is_ascii_alphanumeric() || c.is_ascii_whitespace() || c.is_ascii_punctuation() {
            tokens += 30; // 0.3 tokens
        } else {
            tokens += 130; // 1.3 tokens
        }
    }
    let estimated = (tokens + 99) / 100;
    std::cmp::max(1, estimated)
}

fn extract_text_from_request_body(request_body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(request_body) {
        if let Some(messages) = parsed.get("messages").and_then(|m| m.as_array()) {
            let mut text = String::new();
            for msg in messages {
                if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                    text.push_str(content);
                    text.push_str(" ");
                }
            }
            return text;
        }
    }
    request_body.to_string()
}

fn extract_text_from_embeddings_request(request_body: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(request_body) {
        if let Some(input) = parsed.get("input") {
            if let Some(s) = input.as_str() {
                return s.to_string();
            } else if let Some(arr) = input.as_array() {
                let mut text = String::new();
                for val in arr {
                    if let Some(s) = val.as_str() {
                        text.push_str(s);
                        text.push_str(" ");
                    }
                }
                return text;
            }
        }
    }
    request_body.to_string()
}

fn extract_text_from_sse_chunks(chunks: &[String]) -> String {
    let mut text = String::new();
    for chunk in chunks {
        if chunk == "[DONE]" {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(chunk) {
            if let Some(content) = parsed
                .get("choices")
                .and_then(|c| c.as_array())
                .and_then(|a| a.first())
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(|c| c.as_str())
            {
                text.push_str(content);
            }
        }
    }
    text
}

fn get_tokens_with_fallback(
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
    request_body: &str,
    response_body_text: &str,
    is_embeddings: bool,
    is_streaming: bool,
    sse_chunks: Option<&[String]>,
) -> (Option<u32>, Option<u32>) {
    let inp = match input_tokens {
        Some(t) if t > 0 => Some(t),
        _ => {
            let text = if is_embeddings {
                extract_text_from_embeddings_request(request_body)
            } else {
                extract_text_from_request_body(request_body)
            };
            Some(estimate_tokens(&text))
        }
    };

    let out = match output_tokens {
        Some(t) if t > 0 => Some(t),
        _ => {
            if is_embeddings {
                Some(0)
            } else if is_streaming {
                if let Some(chunks) = sse_chunks {
                    let text = extract_text_from_sse_chunks(chunks);
                    Some(estimate_tokens(&text))
                } else {
                    Some(0)
                }
            } else {
                let mut text = String::new();
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(response_body_text) {
                    if let Some(choices) = parsed.get("choices").and_then(|c| c.as_array()) {
                        for choice in choices {
                            if let Some(content) = choice.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
                                text.push_str(content);
                            }
                        }
                    }
                }
                if text.is_empty() {
                    Some(estimate_tokens(response_body_text))
                } else {
                    Some(estimate_tokens(&text))
                }
            }
        }
    };

    (inp, out)
}

async fn handle_streaming_chat(
    state: &Arc<AppState>,
    candidates: &[(String, String, String)],
    start_idx: usize,
    max_tries: usize,
    request_body: &Arc<String>,
    model: &str,
    start_time: std::time::Instant,
    client_key_name: String,
    _original_model: &str,
    is_unified: bool,
    mut trace: AttemptTrace,
) -> Response {
    let client = Client::new();
    let buffer_size = 65536;

    for attempt in 0..max_tries {
        let idx = (start_idx + attempt) % candidates.len();
        let (pid, api_base, api_key) = &candidates[idx];

        let url = format!("{}/chat/completions", api_base.trim_end_matches('/'));

        let actual_model = if is_unified {
            let gw = state.gateway.lock();
            gw.config.providers.iter()
                .find(|p| p.id == *pid)
                .and_then(|p| p.models.first().cloned())
                .unwrap_or_else(|| model.to_string())
        } else {
            model.to_string()
        };

        let attempt_body = if is_unified {
            let mut parsed: serde_json::Value = serde_json::from_str(request_body.as_str()).unwrap_or_default();
            parsed["model"] = serde_json::json!(actual_model);
            serde_json::to_string(&parsed).unwrap_or_else(|_| request_body.as_str().to_string())
        } else {
            request_body.as_str().to_string()
        };

        let attempt_start = std::time::Instant::now();
        match client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .body(attempt_body.clone())
            .timeout(std::time::Duration::from_secs(600))
            .send()
            .await
        {
            Ok(response) => {
                let status_code = response.status().as_u16();

                if !(200..300).contains(&status_code) {
                    let error_body = response.text().await.unwrap_or_default();
                    let duration_ms = attempt_start.elapsed().as_millis() as u64;
                    trace.attempts.push(RouteAttempt {
                        provider_id: pid.clone(),
                        endpoint: url.clone(),
                        status_code,
                        duration_ms,
                        success: false,
                        error_message: Some(format!(
                            "Upstream {}: {}",
                            status_code,
                            error_body.chars().take(100).collect::<String>()
                        )),
                    });

                    let log = RequestLog {
                        timestamp: Utc::now(),
                        model: actual_model.clone(),
                        provider: pid.clone(),
                        status_code,
                        input_tokens: None,
                        output_tokens: None,
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        success: false,
                        error_message: Some(format!(
                            "Upstream {}: {}",
                            status_code,
                            error_body.chars().take(200).collect::<String>()
                        )),
                        is_streaming: true,
                        request_body: Some(truncate_body(&attempt_body, 8000)),
                        response_body: Some(error_body.chars().take(2000).collect()),
                        endpoint: Some(url),
                        request_headers: None,
                        client_key_name: Some(client_key_name.clone()),
                    };
                    state.gateway.lock().add_log(&log);

                    if attempt + 1 < max_tries {
                        tracing::warn!(
                            "Provider {} returned {} on stream connect (attempt {}/{}), trying next",
                            pid, status_code, attempt + 1, max_tries
                        );
                        continue;
                    }

                    let trace_json = serde_json::to_string(&trace).ok();
                    return build_response(
                        StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY),
                        "application/json",
                        pid.as_str(),
                        trace_json,
                        axum::body::Body::from(error_body),
                    );
                }

                let duration_ms = attempt_start.elapsed().as_millis() as u64;
                trace.attempts.push(RouteAttempt {
                    provider_id: pid.clone(),
                    endpoint: url.clone(),
                    status_code,
                    duration_ms,
                    success: true,
                    error_message: None,
                });

                let pid_for_log = pid.clone();
                let model_for_log = actual_model.clone();
                let state_for_log = state.clone();
                let (tx, rx) = tokio::sync::mpsc::channel::<Result<bytes::Bytes, String>>(buffer_size);
                let pid_ss = pid.clone();
                let sse_data_chunks = Arc::new(Mutex::new(Vec::<String>::new()));
                let sse_chunks_ref = sse_data_chunks.clone();
                let request_body_for_log = Arc::new(attempt_body.clone());
                let url_for_log = url.clone();
                let client_key_name_for_log = client_key_name.clone();

                tokio::spawn(async move {
                    let mut stream = response.bytes_stream();
                    let mut buffer = Vec::new();
                    while let Some(chunk) = stream.next().await {
                        match chunk {
                            Ok(bytes) => {
                                if tx.send(Ok(bytes.clone())).await.is_err() {
                                    break;
                                }
                                buffer.extend_from_slice(&bytes);
                                while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                                    let line_bytes = buffer.drain(..=pos).collect::<Vec<u8>>();
                                    let mut line_len = line_bytes.len();
                                    if line_len > 0 && line_bytes[line_len - 1] == b'\n' {
                                        line_len -= 1;
                                    }
                                    if line_len > 0 && line_bytes[line_len - 1] == b'\r' {
                                        line_len -= 1;
                                    }
                                    let line_str = String::from_utf8_lossy(&line_bytes[..line_len]);
                                    if let Some(data) = line_str.strip_prefix("data: ") {
                                        sse_chunks_ref.lock().push(data.to_string());
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = tx
                                    .send(Err(format!("Stream read error: {}", e)))
                                    .await;
                                break;
                            }
                        }
                    }
                    if !buffer.is_empty() {
                        let line_str = String::from_utf8_lossy(&buffer);
                        if let Some(data) = line_str.strip_prefix("data: ") {
                            sse_chunks_ref.lock().push(data.to_string());
                        }
                    }

                    let (input_tokens, output_tokens) =
                        extract_tokens_from_sse_chunks(&sse_chunks_ref.lock());
                    let (input_tokens, output_tokens) = get_tokens_with_fallback(
                        input_tokens,
                        output_tokens,
                        &request_body_for_log,
                        "",
                        false,
                        true,
                        Some(&sse_chunks_ref.lock()),
                    );

                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        let duration = start_time.elapsed().as_millis() as u64;
                        RequestLog {
                            timestamp: Utc::now(),
                            model: model_for_log,
                            provider: pid_for_log,
                            status_code: 200,
                            input_tokens,
                            output_tokens,
                            duration_ms: duration,
                            success: true,
                            error_message: None,
                            is_streaming: true,
                            request_body: Some(truncate_body(&request_body_for_log, 8000)),
                            response_body: Some(sse_chunks_ref.lock().join("\n").chars().take(2000).collect()),
                            endpoint: Some(url_for_log),
                            request_headers: None,
                            client_key_name: Some(client_key_name_for_log.clone()),
                        }
                    }));
                    match result {
                        Ok(log) => {
                            state_for_log.gateway.lock().add_log(&log);
                        }
                        Err(e) => {
                            tracing::error!("streaming log task panicked: {:?}", e);
                        }
                    }
                });

                let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
                let body = axum::body::Body::from_stream(stream.map(|r| match r {
                    Ok(bytes) => Ok::<_, std::convert::Infallible>(bytes),
                    Err(e) => Ok(bytes::Bytes::from(format!("data: [ERROR] {}\n\n", e))),
                }));

                let trace_json = serde_json::to_string(&trace).ok();
                return build_response(
                    StatusCode::OK,
                    "text/event-stream",
                    &pid_ss,
                    trace_json,
                    body,
                );
            }
            Err(e) => {
                let duration_ms = attempt_start.elapsed().as_millis() as u64;
                trace.attempts.push(RouteAttempt {
                    provider_id: pid.clone(),
                    endpoint: url.clone(),
                    status_code: 0,
                    duration_ms,
                    success: false,
                    error_message: Some(e.to_string()),
                });
                tracing::warn!(
                    "Stream provider {} connection failed (attempt {}/{}): {}",
                    pid, attempt + 1, max_tries, e
                );
                if attempt + 1 >= max_tries {
                    let trace_json = serde_json::to_string(&trace).ok();
                    return provider_error_response(&format!("All providers failed: {}", e), trace_json);
                }
            }
        }
    }

    let trace_json = serde_json::to_string(&trace).ok();
    provider_error_response("All providers exhausted", trace_json)
}

async fn embeddings_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut request): Json<EmbeddingsRequest>,
) -> Response {
    let start_time = std::time::Instant::now();

    let (mut gateway_config, request_counter, health_map) = {
        let gw = state.gateway.lock();
        (
            gw.config.clone(),
            gw.request_counter(),
            gw.health_map(),
        )
    };

    let original_model = request.model.clone();
    let mut model = original_model.clone();
    for (src_pattern, target_model) in &gateway_config.model_mappings {
        if crate::gateway::types::matches_wildcard(src_pattern, &model) {
            tracing::info!("Wildcard mapping model '{}' (pattern '{}') to '{}'", model, src_pattern, target_model);
            model = target_model.clone();
            request.model = target_model.clone();
            break;
        }
    }

    let unhealthy_ids: Vec<String> = {
        health_map.lock().iter()
            .filter(|(_, h)| h.unhealthy)
            .map(|(id, _)| id.clone())
            .collect()
    };
    if !unhealthy_ids.is_empty() {
        for p in &mut gateway_config.providers {
            if unhealthy_ids.contains(&p.id) && p.enabled {
                tracing::warn!("Provider '{}' is unhealthy - temporarily disabling in route selection", p.id);
                p.enabled = false;
            }
        }
    }

    request_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let client_key_name = match authenticate_and_get_client(&headers, &gateway_config) {
        Some(name) => name,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "error": {"message": "Invalid API key", "type": "unauthorized"}
                })),
            )
                .into_response();
        }
    };

    let selector = RouteSelector::new(gateway_config.clone());

    let route = match selector.select(&model, false, &health_map.lock()) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("embeddings_handler: route selection failed for '{}': {}", model, e);
            return provider_error_response(&e, None);
        }
    };

    let effective_model = if model == gateway_config.server.default_model_id {
        gateway_config
            .providers
            .iter()
            .find(|p| p.enabled && !p.models.is_empty())
            .and_then(|p| p.models.first())
            .cloned()
            .unwrap_or(model.clone())
    } else {
        model.clone()
    };

    let candidates_with_keys: Vec<(String, String, String)> = {
        let conn = state.db.lock();
        route
            .candidates
            .iter()
            .filter_map(|c| match db::get_api_key(&conn, &c.id) {
                Ok(Some(key)) => Some((c.id.clone(), c.api_base.clone(), key)),
                Ok(None) => {
                    tracing::error!(
                        "provider '{}' has no API key in DB — save the provider again with a new key",
                        c.id
                    );
                    None
                }
                Err(e) => {
                    tracing::error!("failed to read API key for provider '{}': {}", c.id, e);
                    None
                }
            })
            .collect()
    };

    if candidates_with_keys.is_empty() {
        let failed_ids: Vec<_> = route.candidates.iter().map(|c| &c.id).collect();
        tracing::error!(
            "embeddings_handler: all {} provider(s) failed keyring lookup: {:?}",
            route.candidates.len(),
            failed_ids
        );
        return provider_error_response(
            "No available provider with valid API key. Try editing each provider and re-entering the key, then save again.",
            None,
        );
    }

    let lb_candidates: Vec<ProviderCandidate> = route
        .candidates
        .iter()
        .filter(|c| candidates_with_keys.iter().any(|(id, _, _)| &c.id == id))
        .cloned()
        .collect();
    let start_idx = RouteSelector::pick_for_load_balance(&lb_candidates);
    let max_tries = candidates_with_keys.len();

    request.model = effective_model.clone();
    let request_body = match serde_json::to_string(&request) {
        Ok(b) => b,
        Err(e) => return bad_request_response(&format!("Failed to serialize request: {}", e)),
    };
    let request_body = std::sync::Arc::new(request_body);

    handle_embeddings(
        &state,
        &candidates_with_keys,
        start_idx,
        max_tries,
        &request_body,
        &effective_model,
        start_time,
        client_key_name,
    )
    .await
}

async fn handle_embeddings(
    state: &Arc<AppState>,
    candidates: &[(String, String, String)],
    start_idx: usize,
    max_tries: usize,
    request_body: &Arc<String>,
    model: &str,
    start_time: std::time::Instant,
    client_key_name: String,
) -> Response {
    let client = Client::new();

    for attempt in 0..max_tries {
        let idx = (start_idx + attempt) % candidates.len();
        let (pid, api_base, api_key) = &candidates[idx];

        let url = format!("{}/embeddings", api_base.trim_end_matches('/'));

        match client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .body(Arc::clone(request_body).as_ref().to_owned())
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
        {
            Ok(response) => {
                let status_code = response.status().as_u16();

                if !(200..300).contains(&status_code) {
                    let error_body = response.text().await.unwrap_or_default();
                    let log = RequestLog {
                        timestamp: Utc::now(),
                        model: model.to_string(),
                        provider: pid.clone(),
                        status_code,
                        input_tokens: None,
                        output_tokens: None,
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        success: false,
                        error_message: Some(format!(
                            "Upstream {}: {}",
                            status_code,
                            error_body.chars().take(200).collect::<String>()
                        )),
                        is_streaming: false,
                        request_body: Some(truncate_body(request_body, 8000)),
                        response_body: Some(error_body.chars().take(2000).collect()),
                        endpoint: Some(url),
                        request_headers: None,
                        client_key_name: Some(client_key_name.clone()),
                    };
                    state.gateway.lock().add_log(&log);

                    if attempt + 1 < max_tries {
                        tracing::warn!(
                            "Provider {} returned {} on embeddings, trying next",
                            pid, status_code
                        );
                        continue;
                    }

                    return build_response(
                        StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY),
                        "application/json",
                        pid.as_str(),
                        None,
                        axum::body::Body::from(error_body),
                    );
                }

                let body_bytes = match response.bytes().await {
                    Ok(bytes) => bytes,
                    Err(e) => {
                        return provider_error_response(&format!("Failed to read response body: {}", e), None);
                    }
                };

                let body_text = String::from_utf8_lossy(&body_bytes);
                let parsed: serde_json::Value = serde_json::from_str(&body_text).unwrap_or_default();

                let (input_tokens, output_tokens) = extract_tokens(&parsed);
                let (input_tokens, output_tokens) = get_tokens_with_fallback(
                    input_tokens,
                    output_tokens,
                    request_body.as_str(),
                    &body_text,
                    true,
                    false,
                    None,
                );

                let log = RequestLog {
                    timestamp: Utc::now(),
                    model: model.to_string(),
                    provider: pid.clone(),
                    status_code,
                    input_tokens,
                    output_tokens,
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    success: true,
                    error_message: None,
                    is_streaming: false,
                    request_body: Some(truncate_body(request_body, 8000)),
                    response_body: Some(body_text.chars().take(2000).collect()),
                    endpoint: Some(url),
                    request_headers: None,
                    client_key_name: Some(client_key_name.clone()),
                };
                state.gateway.lock().add_log(&log);

                return build_response(
                    StatusCode::from_u16(status_code).unwrap_or(StatusCode::OK),
                    "application/json",
                    pid.as_str(),
                    None,
                    axum::body::Body::from(body_bytes),
                );
            }
            Err(e) => {
                tracing::warn!("Provider {} connection failed (attempt {}/{}): {}", pid, attempt + 1, max_tries, e);
                if attempt + 1 >= max_tries {
                    return provider_error_response(&format!("All providers failed: {}", e), None);
                }
            }
        }
    }

    provider_error_response("All providers exhausted", None)
}

