export interface Provider {
  id: string;
  name: string;
  api_base: string;
  api_key_ref?: string;
  has_api_key: boolean;
  priority: number;
  enabled: boolean;
  models: string[];
  multimodal_models: string[];
  auto_health_check: boolean;
}

export interface ModelRouting {
  model: string;
  strategy: "failover" | "loadbalance" | "lowest_latency" | "lowest_cost";
  provider_order: string[];
}

export interface RoutingConfig {
  models: ModelRouting[];
}

export interface ServerConfig {
  host: string;
  port: number;
  default_model_id: string;
  log_retention_days: number;
  token_price_per_1k?: number;
  gateway_mode?: string;
}

export interface ClientApiKey {
  id: string;
  name: string;
  api_key: string;
  enabled: boolean;
  created_at: string;
}

export interface ModelPrice {
  model_pattern: string;
  input_price_per_1k: number;
  output_price_per_1k: number;
}

export interface Config {
  providers: Provider[];
  routing: RoutingConfig;
  server: ServerConfig;
  api_key: string;
  theme: string;
  language: string;
  auto_start: boolean;
  gateway_on_startup: boolean;
  last_gateway_state: boolean;
  model_mappings: Record<string, string>;
  client_api_keys?: ClientApiKey[];
  model_prices?: ModelPrice[];
}

export interface GatewayStatus {
  running: boolean;
  host: string;
  port: number;
  uptime_seconds?: number;
  total_requests: number;
  provider_health?: Record<string, ProviderHealth>;
}

export interface ProviderHealth {
  consecutive_failures: number;
  unhealthy: boolean;
  last_check?: string;
  last_error?: string;
  latency_history?: number[];
  average_latency_ms?: number;
}

export interface RequestLog {
  timestamp: string;
  model: string;
  provider: string;
  status_code: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms: number;
  success: boolean;
  error_message?: string;
  is_streaming?: boolean;
  request_body?: string;
  response_body?: string;
  endpoint?: string;
  request_headers?: string;
  client_key_name?: string;
}

export interface PaginatedLogs {
  logs: RequestLog[];
  total: number;
  page: number;
  page_size: number;
}

export interface LogFilter {
  model?: string;
  success?: boolean;
  search_text?: string;
}

export interface TestProviderResult {
  success: boolean;
  message: string;
  models?: string[];
}

export interface StatsSummary {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  input_cost: number;
  output_cost: number;
  by_model: ModelStats[];
}

export interface ModelStats {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
}

export interface DailyStats {
  date: string;
  requests: number;
  tokens: number;
}
