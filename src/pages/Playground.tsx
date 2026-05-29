import { useState, useEffect, useRef, useMemo } from "react";
import { useConfigStore } from "../store/configStore";
import { useGatewayStore } from "../store/gatewayStore";
import { useI18n } from "../i18n/I18nContext";
import { useToastStore } from "../store/toastStore";
import {
  Send,
  Trash2,
  AlertCircle,
  CheckCircle,
  XCircle,
  HelpCircle,
  Network,
  Cpu,
  ArrowRight,
  Clock,
  Coins,
  Bot,
  User,
  Settings,
  Sparkles,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronUp
} from "lucide-react";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface RouteAttempt {
  provider_id: string;
  endpoint: string;
  status_code: number;
  duration_ms: number;
  success: boolean;
  error_message?: string;
}

interface AttemptTrace {
  model: string;
  routing_strategy: string;
  attempts: RouteAttempt[];
}

export function Playground() {
  const { lang, t } = useI18n();
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const fetchGatewayStatus = useGatewayStore((s) => s.fetchStatus);
  const startGateway = useGatewayStore((s) => s.startGateway);
  const addToast = useToastStore((s) => s.addToast);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    lang === "zh" ? "你是一个有用的 AI 助手。" : "You are a helpful AI assistant."
  );
  
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collapseSim, setCollapseSim] = useState(false);
  
  // Tracing information
  const [activeTrace, setActiveTrace] = useState<AttemptTrace | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedAttempts, setExpandedAttempts] = useState<Record<number, boolean>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Wildcard match helper in JS
  function matchWildcard(pattern: string, text: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
    return new RegExp(regexStr, "i").test(text);
  }

  // Routing Simulator decision logic
  const routingSimulation = useMemo(() => {
    if (!config) return null;

    const rawModel = useCustomModel ? customModel.trim() : selectedModel;
    if (!rawModel) return null;

    const mode = config.server?.gateway_mode || "direct";
    const defaultModel = config.server?.default_model_id || "";

    // 1. Ingress
    let modelAfterMode = rawModel;
    let ingressExplanation = "";
    if (mode === "unified") {
      modelAfterMode = defaultModel;
      ingressExplanation = lang === "zh"
        ? `统一模式拦截：输入模型 "${rawModel}" 被重映射为默认模型 "${defaultModel}"`
        : `Unified Mode: Input model "${rawModel}" intercepted & mapped to default "${defaultModel}"`;
    } else {
      ingressExplanation = lang === "zh"
        ? `直连模式放行：使用客户端发起请求的原始模型 "${rawModel}"`
        : `Direct Mode: Passing through original request model ID "${rawModel}"`;
    }

    // 2. Wildcard mapping (only for direct mode)
    let finalModel = modelAfterMode;
    let mappedExplanation = "";
    if (mode !== "unified") {
      const mappingsList = Object.entries(config.model_mappings || {});
      for (const [src_pattern, target_model] of mappingsList) {
        if (matchWildcard(src_pattern, modelAfterMode)) {
          finalModel = target_model;
          mappedExplanation = lang === "zh"
            ? `命中别名规则 "${src_pattern}" ➡️ 重写请求为 "${target_model}"`
            : `Matched alias "${src_pattern}" ➡️ Rewritten to "${target_model}"`;
          break;
        }
      }
      if (!mappedExplanation) {
        mappedExplanation = lang === "zh"
          ? "未匹配到任何别名映射规则，保持原样"
          : "No wildcard alias matched, using raw ID";
      }
    } else {
      mappedExplanation = lang === "zh"
        ? "已绕过别名别称规则重写"
        : "Wildcard alias step bypassed in Unified Mode";
    }

    // 3. Routing Strategy
    const routingRule = config.routing?.models?.find((r) => matchWildcard(r.model, finalModel));
    const strategy = routingRule?.strategy || "failover";
    const strategyExplanation = lang === "zh"
      ? (routingRule
          ? `命中专属路由策略：[${routingRule.model}] 策略为 [${strategy}]`
          : `未命中专属路由规则，默认使用 [故障转移 (Failover)]`)
      : (routingRule
          ? `Matched rule for [${routingRule.model}]: using [${strategy}]`
          : `No specific rule matched, fallback to [Failover]`);

    // 4. Candidates
    const candidates = (config.providers || [])
      .filter((p) => p.enabled && (p.models?.includes(finalModel) || p.multimodal_models?.includes(finalModel)))
      .map((p) => {
        const health = gatewayStatus?.provider_health?.[p.id];
        const averageLatency = health?.average_latency_ms ?? 9999;
        
        const priceRule = config.model_prices?.find((pr) => matchWildcard(pr.model_pattern, finalModel));
        const inputPrice = priceRule?.input_price_per_1k ?? 0.01;
        const outputPrice = priceRule?.output_price_per_1k ?? 0.01;
        const totalCost = inputPrice + outputPrice;

        return {
          id: p.id,
          priority: p.priority ?? 0,
          averageLatency,
          totalCost,
          isHealthy: health ? !health.unhealthy : true,
        };
      });

    const sortedCandidates = [...candidates];
    if (strategy === "lowest_latency") {
      sortedCandidates.sort((a, b) => {
        if (!a.isHealthy && b.isHealthy) return 1;
        if (a.isHealthy && !b.isHealthy) return -1;
        return a.averageLatency - b.averageLatency;
      });
    } else if (strategy === "lowest_cost") {
      sortedCandidates.sort((a, b) => {
        if (!a.isHealthy && b.isHealthy) return 1;
        if (a.isHealthy && !b.isHealthy) return -1;
        return a.totalCost - b.totalCost;
      });
    } else {
      sortedCandidates.sort((a, b) => b.priority - a.priority);
    }

    return {
      rawModel,
      ingressModel: modelAfterMode,
      ingressExplanation,
      finalModel,
      mappedExplanation,
      strategy,
      strategyExplanation,
      candidates: sortedCandidates,
    };
  }, [config, selectedModel, customModel, useCustomModel, gatewayStatus, lang]);

  const handleModeChange = async (mode: string) => {
    if (!config) return;
    try {
      await saveConfig({
        ...config,
        server: {
          ...config.server,
          gateway_mode: mode,
        }
      });
      addToast("success", lang === "zh" ? `网关模式已切换为: ${mode === "unified" ? "统一模式" : "直连模式"}` : `Gateway mode switched to ${mode}`);
    } catch (e) {
      addToast("error", String(e));
    }
  };

  const handleDefaultModelChange = async (modelId: string) => {
    if (!config) return;
    try {
      await saveConfig({
        ...config,
        server: {
          ...config.server,
          default_model_id: modelId,
        }
      });
    } catch (e) {
      addToast("error", String(e));
    }
  };

  // Keep chat scrolled
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function useMemoModels() {
    if (!config?.providers) return [];
    const modelsSet = new Set<string>();
    config.providers.forEach((p) => {
      if (p.enabled) {
        p.models?.forEach((m) => modelsSet.add(m));
        p.multimodal_models?.forEach((m) => modelsSet.add(m));
      }
    });
    return Array.from(modelsSet).sort();
  }

  const availableModels = useMemoModels();

  useEffect(() => {
    if (availableModels.length > 0 && !selectedModel) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);

  const handleStartGateway = async () => {
    try {
      await startGateway();
      addToast("success", lang === "zh" ? "网关启动成功" : "Gateway started successfully");
    } catch (e) {
      addToast("error", String(e));
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setActiveTrace(null);
  };

  const toggleAttemptExpand = (index: number) => {
    setExpandedAttempts((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const gatewayRunning = gatewayStatus?.running;
    if (!gatewayRunning) {
      addToast("error", lang === "zh" ? "网关未启动，无法测试" : "Gateway is not running, cannot test");
      return;
    }

    const modelToUse = useCustomModel ? customModel.trim() : selectedModel;
    if (!modelToUse) {
      addToast("error", lang === "zh" ? "请选择或输入模型 ID" : "Please select or enter a Model ID");
      return;
    }

    // Build chat context
    const currentMessages: Message[] = [];
    if (systemPrompt.trim()) {
      currentMessages.push({ role: "system", content: systemPrompt });
    }
    
    // Add history
    const history = messages.filter(m => m.role !== "system");
    currentMessages.push(...history);
    
    // Add user message
    const userMessage: Message = { role: "user", content: input };
    currentMessages.push(userMessage);

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setActiveTrace(null);
    setExpandedAttempts({});

    // Append a placeholder assistant message
    const assistantMessageIndex = messages.length + 1;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const gatewayUrl = `http://${gatewayStatus.host}:${gatewayStatus.port}/v1/chat/completions`;
    const apiKey = config?.api_key || "";

    try {
      const response = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: currentMessages,
          stream: true,
        }),
      });

      // Parse route trace header
      const traceHeader = response.headers.get("x-switchai-trace");
      if (traceHeader) {
        try {
          const parsedTrace = JSON.parse(traceHeader) as AttemptTrace;
          setActiveTrace(parsedTrace);
        } catch (e) {
          console.error("Failed to parse x-switchai-trace header:", e);
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errMsg = errorText;
        try {
          const json = JSON.parse(errorText);
          if (json.error?.message) errMsg = json.error.message;
        } catch {}
        
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantMessageIndex] = {
            role: "assistant",
            content: `⚠️ Error: ${errMsg}`,
          };
          return updated;
        });
        setLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body reader not available");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last partial line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6);
            try {
              if (dataStr.startsWith("[ERROR]")) {
                fullContent += `\n⚠️ Stream Error: ${dataStr.slice(7)}`;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantMessageIndex] = { role: "assistant", content: fullContent };
                  return updated;
                });
                continue;
              }

              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content || "";
              if (delta) {
                fullContent += delta;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantMessageIndex] = { role: "assistant", content: fullContent };
                  return updated;
                });
              }
            } catch (err) {
              // Ignore partial or non-json lines
            }
          }
        }
      }

      // Flush remaining buffer
      if (buffer.startsWith("data: ")) {
        const dataStr = buffer.slice(6);
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content || "";
          if (delta) {
            fullContent += delta;
            setMessages((prev) => {
              const updated = [...prev];
              updated[assistantMessageIndex] = { role: "assistant", content: fullContent };
              return updated;
            });
          }
        } catch {}
      }

    } catch (error) {
      console.error(error);
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantMessageIndex] = {
          role: "assistant",
          content: `⚠️ Failed to fetch stream: ${String(error)}`,
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const gatewayRunning = gatewayStatus?.running;

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-4">
      {/* Title Header */}
      <div className="flex items-center justify-between border-b border-gray-150 dark:border-gray-800 pb-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary-500 animate-pulse" />
            {lang === "zh" ? "测试沙盒 (Playground)" : "Chat Playground"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {lang === "zh" ? "测试路由策略、故障转移及映射效果" : "Test gateway routing, failovers, and mappings in real time"}
          </p>
        </div>

        {/* Gateway Status Summary */}
        <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${gatewayRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
            <span className="font-semibold text-gray-700 dark:text-gray-300">
              Gateway: {gatewayRunning ? (lang === "zh" ? "运行中" : "Running") : (lang === "zh" ? "已停止" : "Stopped")}
            </span>
          </div>
          {gatewayRunning ? (
            <span className="text-gray-500 border-l border-gray-200 dark:border-gray-700 pl-3">
              Port: {gatewayStatus.port}
            </span>
          ) : (
            <button
              onClick={handleStartGateway}
              className="bg-primary-600 hover:bg-primary-700 text-white font-medium px-2 py-1 rounded-md transition-colors ml-2"
            >
              {lang === "zh" ? "快速启动" : "Start Now"}
            </button>
          )}
        </div>
      </div>

      {/* Quick Mode Config */}
      <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center justify-between shadow-sm">
        <div className="flex flex-col gap-1 text-left">
          <span className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-primary-500" />
            {lang === "zh" ? "网关路由模式快捷配置" : "Gateway Mode Quick Config"}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {lang === "zh" 
              ? "实时控制并热重载网关对于请求模型 ID 的拦截与映射逻辑（自动同步并生效）" 
              : "Control request model ID interception and wildcard rewriting on the fly"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Mode Selector */}
          <div className="flex bg-gray-100 dark:bg-gray-850 p-0.5 rounded-lg border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => handleModeChange("direct")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                config?.server?.gateway_mode !== "unified"
                  ? "bg-white dark:bg-gray-700 text-primary-600 dark:text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              {lang === "zh" ? "直连入口模式 (Direct)" : "Direct Mode"}
            </button>
            <button
              onClick={() => handleModeChange("unified")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                config?.server?.gateway_mode === "unified"
                  ? "bg-white dark:bg-gray-700 text-primary-600 dark:text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              {lang === "zh" ? "统一入口模式 (Unified)" : "Unified Mode"}
            </button>
          </div>

          {/* Unified Model configuration */}
          {config?.server?.gateway_mode === "unified" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                {lang === "zh" ? "全局重定义模型 ID:" : "Target Model ID:"}
              </span>
              <input
                type="text"
                placeholder="e.g. localhost"
                value={config.server?.default_model_id || ""}
                onChange={(e) => handleDefaultModelChange(e.target.value)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-750 rounded-lg px-2.5 py-1 text-xs w-36 focus:ring-2 focus:ring-primary-500 dark:text-white"
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        
        {/* Left Side: Setup & Chat Workspace (3 cols) */}
        <div className="lg:col-span-3 flex flex-col min-h-0 bg-white dark:bg-gray-900/40 border border-gray-150 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
          
          {/* Top Control Bar */}
          <div className="border-b border-gray-100 dark:border-gray-800 p-4 bg-gray-50/50 dark:bg-gray-900/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              
              {/* Custom Model Toggle */}
              <div className="flex items-center gap-2 pr-3 border-r border-gray-200 dark:border-gray-700">
                <input
                  type="checkbox"
                  id="useCustomModel"
                  checked={useCustomModel}
                  onChange={(e) => setUseCustomModel(e.target.checked)}
                  className="rounded text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                />
                <label htmlFor="useCustomModel" className="text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap cursor-pointer">
                  {lang === "zh" ? "自定义模型" : "Custom Model"}
                </label>
              </div>

              {useCustomModel ? (
                <input
                  type="text"
                  placeholder={lang === "zh" ? "例如: gpt-3.5-turbo, gpt-4o, *" : "e.g., gpt-3.5-turbo, gpt-4o, *"}
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-primary-500 dark:text-white"
                />
              ) : (
                <div className="relative">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg pl-3 pr-8 py-1.5 text-sm w-64 appearance-none focus:ring-2 focus:ring-primary-500 dark:text-white font-medium cursor-pointer"
                  >
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {availableModels.length === 0 && (
                      <option value="">
                        {lang === "zh" ? "无可用模型 (请先配置提供商)" : "No models configured"}
                      </option>
                    )}
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-2.5 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Actions / System Prompt Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  showSettings
                    ? "bg-primary-50 dark:bg-primary-950/40 text-primary-600 border-primary-200 dark:border-primary-800"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                {lang === "zh" ? "系统提示词" : "System Prompt"}
              </button>

              <button
                onClick={handleClearChat}
                disabled={messages.length === 0}
                className="flex items-center gap-1.5 bg-white dark:bg-gray-850 border border-gray-300 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 dark:hover:text-red-400 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {lang === "zh" ? "清除对话" : "Clear"}
              </button>
            </div>
          </div>

          {/* System Prompt Expanded Settings Drawer */}
          {showSettings && (
            <div className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800 p-4">
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {lang === "zh" ? "系统设置 (System Message)" : "System Instructions"}
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={lang === "zh" ? "设置 AI 助手的初始人设和回复规则..." : "Provide context or rules for the AI's behavior..."}
                className="w-full h-20 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 dark:text-white"
              />
            </div>
          )}

          {/* Messages Panel */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 bg-gray-50/20 dark:bg-gray-950/10">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 bg-primary-50 dark:bg-primary-950/30 rounded-2xl flex items-center justify-center text-primary-500 dark:text-primary-400 mb-4 shadow-inner">
                  <Bot className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-gray-800 dark:text-gray-200">
                  {lang === "zh" ? "开始测试 AI 网关" : "Start testing your gateway"}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mt-1">
                  {lang === "zh" ? "在上方选择一个模型，发送聊天内容以观察网关的智能路由与日志链路。" : "Type a message below to test automatic failover and routing paths."}
                </p>
              </div>
            ) : (
              messages.map((msg, index) => {
                // Do not display system prompt directly in chat flow, only history
                if (msg.role === "system") return null;

                const isUser = msg.role === "user";
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-950 text-primary-700 dark:text-primary-300 flex items-center justify-center font-bold text-sm shrink-0 border border-primary-200 dark:border-primary-850">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm leading-relaxed ${
                        isUser
                          ? "bg-primary-600 text-white font-medium rounded-tr-none"
                          : "bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-150 border border-gray-150 dark:border-gray-750 rounded-tl-none"
                      }`}
                    >
                      <span className="whitespace-pre-wrap">{msg.content || <span className="inline-flex gap-1 items-center"><span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"></span><span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{animationDelay:"0.2s"}}></span><span className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{animationDelay:"0.4s"}}></span></span>}</span>
                    </div>
                    {isUser && (
                      <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center justify-center font-bold text-sm shrink-0 border border-gray-300 dark:border-gray-750">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Bottom Send Input Bar */}
          <div className="border-t border-gray-150 dark:border-gray-800 p-4 bg-white dark:bg-gray-900/60">
            <form onSubmit={handleSend} className="flex gap-2">
              <input
                type="text"
                disabled={loading}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  loading
                    ? (lang === "zh" ? "等待 AI 回复中..." : "Waiting for response...")
                    : (lang === "zh" ? "输入测试消息..." : "Type your message to proxy...")
                }
                className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none dark:text-white disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-3 rounded-xl flex items-center justify-center font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-md"
              >
                {loading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Side: Live Simulator + Trace Timeline (1 col) */}
        <div className="lg:col-span-1 flex flex-col bg-white dark:bg-gray-900/40 border border-gray-150 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden min-h-0 backdrop-blur-md">

          {/* ── Section 1: Live Route Simulator ── */}
          <div className="shrink-0 border-b border-gray-150 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setCollapseSim(!collapseSim)}
              className="w-full p-4 bg-gray-50/60 dark:bg-gray-900/60 flex items-center justify-between focus:outline-none"
            >
              <h2 className="font-extrabold text-sm text-gray-800 dark:text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-primary-500" />
                {lang === "zh" ? "实时路由模拟器" : "Live Route Simulator"}
              </h2>
              {collapseSim
                ? <ChevronDown className="w-4 h-4 text-gray-400" />
                : <ChevronUp className="w-4 h-4 text-gray-400" />}
            </button>

            {!collapseSim && (
              <div className="max-h-[42vh] overflow-y-auto px-4 pb-4 space-y-3 text-xs border-t border-gray-100 dark:border-gray-800 bg-gray-50/20 dark:bg-gray-950/10">
                {!routingSimulation ? (
                  <div className="py-6 text-center text-gray-400 text-[11px]">
                    {lang === "zh" ? "请先选择一个模型以预览路由决策。" : "Select a model above to preview routing decisions."}
                  </div>
                ) : (
                  <>
                    {/* Step 1: Mode */}
                    <div className="pt-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700 dark:text-gray-200">
                          1. {lang === "zh" ? "网关入口拦截" : "Gateway Ingress"}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          config?.server?.gateway_mode === "unified"
                            ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900"
                            : "bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900"
                        }`}>
                          {config?.server?.gateway_mode === "unified" ? "Unified" : "Direct"}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        {routingSimulation.ingressExplanation}
                      </p>
                    </div>

                    {/* Step 2: Alias */}
                    <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700 dark:text-gray-200">
                          2. {lang === "zh" ? "别名映射重写" : "Alias Rewrite"}
                        </span>
                        <span className="font-mono text-[10px] text-primary-600 dark:text-primary-400 font-semibold">
                          → {routingSimulation.finalModel}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        {routingSimulation.mappedExplanation}
                      </p>
                    </div>

                    {/* Step 3: Strategy */}
                    <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700 dark:text-gray-200">
                          3. {lang === "zh" ? "路由策略" : "Routing Strategy"}
                        </span>
                        <span className="bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-bold px-1.5 py-0.5 rounded text-[10px] border border-primary-100 dark:border-primary-900/50">
                          {routingSimulation.strategy}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        {routingSimulation.strategyExplanation}
                      </p>
                    </div>

                    {/* Step 4: Dispatch Queue */}
                    <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-1.5">
                      <span className="font-bold text-gray-700 dark:text-gray-200">
                        4. {lang === "zh" ? "调度队列预览" : "Dispatch Queue"}
                      </span>
                      {routingSimulation.candidates.length === 0 ? (
                        <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-950/20 p-2 rounded border border-red-200 dark:border-red-900/50 mt-1">
                          ⚠️ {lang === "zh" ? "无任何提供商支持此模型，请求将失败！" : "No providers support this model — request will fail!"}
                        </div>
                      ) : (
                        <div className="space-y-1 mt-1">
                          {routingSimulation.candidates.map((c, i) => (
                            <div key={c.id} className={`flex items-center justify-between rounded-lg px-2 py-1.5 border text-[11px] ${
                              i === 0
                                ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/50"
                                : "bg-white dark:bg-gray-850 border-gray-150 dark:border-gray-750"
                            }`}>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[9px] w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold shrink-0">
                                  {i + 1}
                                </span>
                                <span className={`font-semibold truncate max-w-[80px] ${
                                  c.isHealthy ? "text-gray-800 dark:text-gray-200" : "text-gray-400 dark:text-gray-600 line-through"
                                }`}>
                                  {c.id}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {routingSimulation.strategy === "lowest_latency" && (
                                  <span className="text-purple-600 dark:text-purple-400 font-semibold text-[10px] flex items-center gap-0.5">
                                    <Clock className="w-2.5 h-2.5" />
                                    {c.averageLatency >= 9999 ? "?" : `${Math.round(c.averageLatency)}ms`}
                                  </span>
                                )}
                                {routingSimulation.strategy === "lowest_cost" && (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] flex items-center gap-0.5">
                                    <Coins className="w-2.5 h-2.5" />
                                    ${c.totalCost.toFixed(3)}
                                  </span>
                                )}
                                {routingSimulation.strategy !== "lowest_latency" && routingSimulation.strategy !== "lowest_cost" && (
                                  <span className="text-gray-400 dark:text-gray-500 text-[10px]">
                                    P{c.priority}
                                  </span>
                                )}
                                {!c.isHealthy && (
                                  <span className="text-red-500 font-bold text-[9px] bg-red-50 dark:bg-red-950/30 px-1 rounded">ERR</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Section 2: Route Trace Timeline ── */}
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 shrink-0">
            <h2 className="font-extrabold text-sm text-gray-800 dark:text-white flex items-center gap-2">
              <Network className="w-4 h-4 text-primary-500" />
              {lang === "zh" ? "路由诊断链路 (Trace)" : "Route Trace Diagnostics"}
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0 space-y-3">
            {!activeTrace ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 p-4 gap-3">
                <Network className="w-10 h-10 text-gray-300 dark:text-gray-700" />
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {lang === "zh" ? "等待请求..." : "Awaiting request..."}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-1 leading-relaxed">
                    {lang === "zh"
                      ? "发送测试消息后，此处将实时展示完整的路由转发链路诊断数据。"
                      : "After sending a request, the full route trace, failover triggers, and per-attempt diagnostics will appear here."}
                  </p>
                </div>
              </div>
            ) : (() => {
              const totalMs = activeTrace.attempts.reduce((sum, a) => sum + a.duration_ms, 0);
              const successAttempt = activeTrace.attempts.find(a => a.success);
              const failedCount = activeTrace.attempts.filter(a => !a.success).length;
              const isAllFailed = !successAttempt;
              return (
                <div className="space-y-3">

                  {/* ── Summary Banner ── */}
                  <div className={`rounded-xl p-3 border ${
                    isAllFailed
                      ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40"
                      : "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/40"
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        {isAllFailed
                          ? <XCircle className="w-4 h-4 text-red-500" />
                          : <CheckCircle className="w-4 h-4 text-green-500" />}
                        <span className={`text-xs font-bold ${isAllFailed ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                          {isAllFailed
                            ? (lang === "zh" ? "全部尝试失败" : "All Attempts Failed")
                            : (lang === "zh" ? `转发成功（${activeTrace.attempts.length > 1 ? `经 ${failedCount} 次失败后` : ""}直接命中）` : `Routed Successfully${activeTrace.attempts.length > 1 ? ` after ${failedCount} failure(s)` : ""}`)}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />{totalMs}ms
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-gray-500 dark:text-gray-400">{lang === "zh" ? "请求模型" : "Request Model"}</span>
                        <span className="font-mono font-bold text-gray-800 dark:text-gray-200 truncate">{activeTrace.model}</span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-gray-500 dark:text-gray-400">{lang === "zh" ? "路由策略" : "Strategy"}</span>
                        <span className="font-bold text-primary-600 dark:text-primary-400">{activeTrace.routing_strategy}</span>
                      </div>
                      {successAttempt && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-gray-500 dark:text-gray-400">{lang === "zh" ? "最终服务商" : "Final Provider"}</span>
                          <span className="font-bold text-gray-800 dark:text-gray-200">{successAttempt.provider_id}</span>
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-gray-500 dark:text-gray-400">{lang === "zh" ? "总尝试次数" : "Total Attempts"}</span>
                        <span className="font-bold text-gray-800 dark:text-gray-200">{activeTrace.attempts.length}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Duration Bar ── */}
                  {activeTrace.attempts.length > 0 && totalMs > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        {lang === "zh" ? "各阶段耗时分布" : "Time Distribution"}
                      </span>
                      <div className="flex h-3 rounded-full overflow-hidden gap-px">
                        {activeTrace.attempts.map((attempt, i) => {
                          const pct = totalMs > 0 ? (attempt.duration_ms / totalMs) * 100 : 100 / activeTrace.attempts.length;
                          return (
                            <div
                              key={i}
                              title={`${attempt.provider_id}: ${attempt.duration_ms}ms`}
                              style={{ width: `${pct}%` }}
                              className={`rounded-sm transition-all ${
                                attempt.success
                                  ? "bg-green-400 dark:bg-green-500"
                                  : "bg-red-400 dark:bg-red-500"
                              }`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[9px] text-gray-400">
                        <span>0ms</span>
                        <span>{totalMs}ms</span>
                      </div>
                    </div>
                  )}

                  {/* ── Attempt Timeline ── */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {lang === "zh" ? "转发尝试链路" : "Attempt Chain"}
                    </span>
                    <div className="relative border-l-2 border-gray-200 dark:border-gray-700 ml-2 pl-4 space-y-4">
                      {activeTrace.attempts.map((attempt, index) => {
                        const isSuccess = attempt.success;
                        const isLast = index === activeTrace.attempts.length - 1;
                        return (
                          <div key={index} className="relative">
                            {/* Node */}
                            <div className={`absolute -left-[21px] top-1 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              isSuccess
                                ? "border-green-500 bg-green-50 dark:bg-green-950"
                                : "border-red-400 bg-red-50 dark:bg-red-950"
                            }`}>
                              {isSuccess
                                ? <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                                : <XCircle className="w-2.5 h-2.5 text-red-400" />}
                            </div>

                            {/* Card */}
                            <div className={`rounded-xl border text-[11px] overflow-hidden ${
                              isSuccess
                                ? "border-green-200 dark:border-green-900/50 bg-white dark:bg-gray-900"
                                : "border-red-200 dark:border-red-900/40 bg-white dark:bg-gray-900"
                            }`}>
                              {/* Card Header */}
                              <div className={`px-3 py-2 flex items-center justify-between ${
                                isSuccess
                                  ? "bg-green-50 dark:bg-green-950/20"
                                  : "bg-red-50 dark:bg-red-950/20"
                              }`}>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[9px] w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 shrink-0">
                                    {index + 1}
                                  </span>
                                  <span className="font-bold text-gray-800 dark:text-gray-200">{attempt.provider_id}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-0.5">
                                    <Clock className="w-2.5 h-2.5" />{attempt.duration_ms}ms
                                  </span>
                                  <span className={`font-bold text-[10px] px-1.5 py-0.5 rounded-md ${
                                    isSuccess
                                      ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                                      : "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300"
                                  }`}>
                                    {attempt.status_code || "ERR"}
                                  </span>
                                </div>
                              </div>

                              {/* Card Body */}
                              <div className="px-3 py-2 space-y-1.5 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                                <div className="flex gap-1 items-start">
                                  <span className="shrink-0 font-semibold text-gray-600 dark:text-gray-300">URL</span>
                                  <span className="break-all text-primary-600 dark:text-primary-400">{attempt.endpoint}</span>
                                </div>
                                {attempt.error_message && (
                                  <div className="flex gap-1 items-start text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-1.5 rounded-lg border border-red-100 dark:border-red-900/50">
                                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                    <span className="break-words">{attempt.error_message}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Failover arrow between attempts */}
                            {!isSuccess && !isLast && (
                              <div className="flex items-center gap-1 mt-1.5 pl-1 text-orange-500 text-[10px] font-semibold">
                                <ArrowRight className="w-3 h-3 animate-pulse shrink-0" />
                                <span>{lang === "zh" ? "触发故障转移，尝试下一供应商..." : "Failover triggered → trying next provider..."}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

      </div>
    </div>
  );
}
