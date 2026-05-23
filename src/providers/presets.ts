export interface ProviderPreset {
  key: string;
  name: string;
  api_base: string;
  models: string[];
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "openai",
    name: "OpenAI",
    api_base: "https://api.openai.com",
    models: [
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-4.1",
      "gpt-4.1-mini",
      "o3",
      "o4-mini",
    ],
  },
  {
    key: "azure",
    name: "Azure OpenAI",
    api_base: "https://YOUR_RESOURCE.openai.azure.com",
    models: [
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-4.1",
    ],
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    api_base: "https://api.deepseek.com",
    models: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
  },
  {
    key: "anthropic",
    name: "Anthropic Claude",
    api_base: "https://api.anthropic.com",
    models: [
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
  },
  {
    key: "google",
    name: "Google Gemini",
    api_base: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
    ],
  },
  {
    key: "mistral",
    name: "Mistral AI",
    api_base: "https://api.mistral.ai",
    models: [
      "mistral-large-3",
      "mistral-medium-3.5",
      "mistral-small-4",
      "devstral-2-2512",
      "codestral-2501",
    ],
  },
  {
    key: "groq",
    name: "Groq",
    api_base: "https://api.groq.com/openai",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ],
  },
  {
    key: "together",
    name: "Together AI",
    api_base: "https://api.together.xyz",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen3.5-397B-A17B",
      "deepseek-ai/DeepSeek-V3",
      "google/gemma-4-31B-it",
    ],
  },
  {
    key: "xai",
    name: "xAI (Grok)",
    api_base: "https://api.x.ai",
    models: [
      "grok-4-1-fast-non-reasoning",
      "grok-4.1-mini",
    ],
  },
  {
    key: "perplexity",
    name: "Perplexity",
    api_base: "https://api.perplexity.ai",
    models: [
      "sonar",
      "sonar-pro",
      "sonar-reasoning",
      "sonar-deep-research",
    ],
  },
  {
    key: "ollama",
    name: "Ollama (本地部署)",
    api_base: "http://localhost:11434",
    models: [
      "llama3.2",
      "qwen2.5",
      "mistral",
      "gemma2",
      "deepseek-r1:8b",
    ],
  },
];

export const PRIORITY_OPTIONS = [
  { value: 25, label: "priority.low" },
  { value: 50, label: "priority.normal" },
  { value: 75, label: "priority.high" },
  { value: 100, label: "priority.critical" },
];
