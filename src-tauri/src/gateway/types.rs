use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub api_base: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_ref: Option<String>,
    pub priority: u32,
    pub enabled: bool,
    pub models: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub multimodal_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRouting {
    pub model: String,
    pub strategy: RoutingStrategy,
    pub provider_order: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoutingStrategy {
    Failover,
    LoadBalance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingConfig {
    pub models: Vec<ModelRouting>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    #[serde(default = "default_default_model_id")]
    pub default_model_id: String,
    #[serde(default = "default_log_retention_days")]
    pub log_retention_days: u32,
    #[serde(default = "default_token_price")]
    pub token_price_per_1k: f64,
}

fn default_log_retention_days() -> u32 {
    7
}

fn default_token_price() -> f64 {
    0.01
}

fn default_default_model_id() -> String {
    "localhost".to_string()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3000,
            default_model_id: "localhost".to_string(),
            log_retention_days: 7,
            token_price_per_1k: 0.01,
        }
    }
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_language() -> String {
    "zh".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub providers: Vec<Provider>,
    pub routing: RoutingConfig,
    pub server: ServerConfig,
    pub api_key: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub gateway_on_startup: bool,
    #[serde(default)]
    pub last_gateway_state: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            providers: Vec::new(),
            routing: RoutingConfig { models: Vec::new() },
            server: ServerConfig::default(),
            api_key: "sk-switchai-default".to_string(),
            theme: "system".to_string(),
            language: "zh".to_string(),
            auto_start: false,
            gateway_on_startup: false,
            last_gateway_state: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDisplay {
    pub id: String,
    pub name: String,
    pub api_base: String,
    pub api_key_ref: Option<String>,
    pub has_api_key: bool,
    pub priority: u32,
    pub enabled: bool,
    pub models: Vec<String>,
    pub multimodal_models: Vec<String>,
}

impl From<&Provider> for ProviderDisplay {
    fn from(p: &Provider) -> Self {
        Self {
            id: p.id.clone(),
            name: p.name.clone(),
            api_base: p.api_base.clone(),
            api_key_ref: p.api_key_ref.clone(),
            has_api_key: p.api_key_ref.is_some(),
            priority: p.priority,
            enabled: p.enabled,
            models: p.models.clone(),
            multimodal_models: p.multimodal_models.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDisplay {
    pub providers: Vec<ProviderDisplay>,
    pub routing: RoutingConfig,
    pub server: ServerConfig,
    pub api_key: String,
    pub theme: String,
    pub language: String,
    pub auto_start: bool,
    pub gateway_on_startup: bool,
    pub last_gateway_state: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub timestamp: DateTime<Utc>,
    pub model: String,
    pub provider: String,
    pub status_code: u16,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub duration_ms: u64,
    pub success: bool,
    pub error_message: Option<String>,
    #[serde(default)]
    pub is_streaming: bool,
    #[serde(default)]
    pub request_body: Option<String>,
    #[serde(default)]
    pub response_body: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub request_headers: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatus {
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub uptime_seconds: Option<u64>,
    pub total_requests: u64,
    #[serde(default)]
    pub provider_health: HashMap<String, ProviderHealth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub consecutive_failures: u32,
    pub unhealthy: bool,
    pub last_check: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionMessage {
    pub role: String,
    pub content: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatCompletionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(flatten)]
    #[serde(default)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChoice {
    pub index: u32,
    pub message: ChatCompletionMessage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<ChatCompletionChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestProviderResult {
    pub success: bool,
    pub message: String,
    pub models: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsSummary {
    pub total_requests: u64,
    pub successful_requests: u64,
    pub failed_requests: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost: f64,
    pub input_cost: f64,
    pub output_cost: f64,
    pub by_model: Vec<ModelStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStats {
    pub model: String,
    pub requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedLogs {
    pub logs: Vec<RequestLog>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFilter {
    pub model: Option<String>,
    pub success: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStats {
    pub date: String,
    pub requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsSnapshot {
    pub total_requests: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub success_count: u64,
    pub fail_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
}
