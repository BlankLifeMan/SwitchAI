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
        .route("/v1/models", get(models_handler))
        .route("/health", get(health_handler))
        .route("/", get(health_handler))
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(tower_http::cors::CorsLayer::permissive())
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

fn check_auth(headers: &HeaderMap, expected_key: &str) -> bool {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if auth.is_empty() {
        return false;
    }
    let token = auth.strip_prefix("Bearer ").unwrap_or(auth);
    token == expected_key
}

fn provider_error_response(message: &str) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({
            "error": {
                "message": message,
                "type": "provider_error"
            }
        })),
    )
        .into_response()
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

fn build_response(status: StatusCode, content_type: &str, provider: &str, body: axum::body::Body) -> Response {
    let provider_header = format!("switchai-{}", provider);
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("X-Provider", provider_header)
        .body(body)
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
    let (api_key, providers, default_model_id) = {
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
        (
            gw.config.api_key.clone(),
            providers,
            gw.config.server.default_model_id.clone(),
        )
    };

    if !check_auth(&headers, &api_key) {
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
    for p in &providers {
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
    let mut model = original_model.clone();
    if let Some(mapped_model) = gateway_config.model_mappings.get(&model) {
        tracing::info!("Mapping model '{}' to '{}'", model, mapped_model);
        model = mapped_model.clone();
        request.model = mapped_model.clone();
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

    if !check_auth(&headers, &gateway_config.api_key) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "error": {"message": "Invalid API key", "type": "unauthorized"}
            })),
        )
            .into_response();
    }

    let selector = RouteSelector::new(gateway_config.clone());

    let is_multimodal = router::is_multimodal_request(&request.messages);

    let route = match selector.select(&model, is_multimodal) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("chat_handler: route selection failed for '{}': {}", model, e);
            return provider_error_response(&e);
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

    if is_stream {
        return handle_streaming_chat(
            &state,
            &candidates_with_keys,
            start_idx,
            max_tries,
            &request_body,
            &effective_model,
            start_time,
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
) -> Response {
    let client = Client::new();

    for attempt in 0..max_tries {
        let idx = (start_idx + attempt) % candidates.len();
        let (pid, api_base, api_key) = &candidates[idx];

        let url = format!("{}/chat/completions", api_base.trim_end_matches('/'));

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
                    };
                    state.gateway.lock().add_log(&log);

                    if attempt + 1 < max_tries {
                        tracing::warn!(
                            "Provider {} returned {} (attempt {}/{}), trying next",
                            pid, status_code, attempt + 1, max_tries
                        );
                        continue;
                    }

                    return build_response(
                        StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY),
                        "application/json",
                        pid.as_str(),
                        axum::body::Body::from(error_body),
                    );
                }

                let body_bytes = match response.bytes().await {
                    Ok(b) => b,
                    Err(e) => {
                        tracing::error!("Failed to read response body from {}: {}", pid, e);
                        if attempt + 1 < max_tries {
                            continue;
                        }
                        return provider_error_response(&format!("Failed to read response: {}", e));
                    }
                };
                let body_text = String::from_utf8_lossy(&body_bytes).to_string();
                let parsed: serde_json::Value =
                    serde_json::from_str(&body_text).unwrap_or(serde_json::Value::Null);

                let (input_tokens, output_tokens) = extract_tokens(&parsed);

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
                };
                state.gateway.lock().add_log(&log);

                return build_response(
                    StatusCode::from_u16(status_code).unwrap_or(StatusCode::OK),
                    "application/json",
                    pid.as_str(),
                    axum::body::Body::from(body_bytes),
                );
            }
            Err(e) => {
                tracing::warn!("Provider {} connection failed (attempt {}/{}): {}", pid, attempt + 1, max_tries, e);
                if attempt + 1 >= max_tries {
                    return provider_error_response(&format!("All providers failed: {}", e));
                }
            }
        }
    }

    provider_error_response("All providers exhausted")
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

async fn handle_streaming_chat(
    state: &Arc<AppState>,
    candidates: &[(String, String, String)],
    start_idx: usize,
    max_tries: usize,
    request_body: &Arc<String>,
    model: &str,
    start_time: std::time::Instant,
) -> Response {
    let client = Client::new();
    let buffer_size = 65536;

    for attempt in 0..max_tries {
        let idx = (start_idx + attempt) % candidates.len();
        let (pid, api_base, api_key) = &candidates[idx];

        let url = format!("{}/chat/completions", api_base.trim_end_matches('/'));

        match client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .body(Arc::clone(request_body).as_ref().to_owned())
            .timeout(std::time::Duration::from_secs(600))
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
                        is_streaming: true,
                        request_body: Some(truncate_body(request_body, 8000)),
                        response_body: Some(error_body.chars().take(2000).collect()),
                        endpoint: Some(url),
                        request_headers: None,
                    };
                    state.gateway.lock().add_log(&log);

                    if attempt + 1 < max_tries {
                        tracing::warn!(
                            "Provider {} returned {} on stream connect (attempt {}/{}), trying next",
                            pid, status_code, attempt + 1, max_tries
                        );
                        continue;
                    }

                    return build_response(
                        StatusCode::from_u16(status_code).unwrap_or(StatusCode::BAD_GATEWAY),
                        "application/json",
                        pid.as_str(),
                        axum::body::Body::from(error_body),
                    );
                }

                let pid_for_log = pid.clone();
                let model_for_log = model.to_string();
                let state_for_log = state.clone();
                let (tx, rx) = tokio::sync::mpsc::channel::<Result<bytes::Bytes, String>>(buffer_size);
                let pid_ss = pid.clone();
                let sse_data_chunks = Arc::new(Mutex::new(Vec::<String>::new()));
                let sse_chunks_ref = sse_data_chunks.clone();
                let request_body_for_log = request_body.clone();
                let url_for_log = url.clone();

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

                return build_response(
                    StatusCode::OK,
                    "text/event-stream",
                    &pid_ss,
                    body,
                );
            }
            Err(e) => {
                tracing::warn!(
                    "Stream provider {} connection failed (attempt {}/{}): {}",
                    pid, attempt + 1, max_tries, e
                );
                if attempt + 1 >= max_tries {
                    return provider_error_response(&format!("All providers failed: {}", e));
                }
            }
        }
    }

    provider_error_response("All providers exhausted")
}
