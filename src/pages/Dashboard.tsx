import { useEffect, useState, useMemo } from "react";
import { useStatsStore } from "../store/statsStore";
import { useConfigStore } from "../store/configStore";
import { useGatewayStore } from "../store/gatewayStore";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Zap, Database, RefreshCw, Copy, Server, Key, Terminal, Power, PowerOff, Check, Eye, EyeOff, DollarSign, AlertTriangle } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import { useToastStore } from "../store/toastStore";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

export function Dashboard() {
  const { t } = useI18n();
  const stats = useStatsStore((s) => s.stats);
  const dailyStats = useStatsStore((s) => s.dailyStats);
  const fetchStats = useStatsStore((s) => s.fetchStats);
  const fetchDailyStats = useStatsStore((s) => s.fetchDailyStats);
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const fetchGatewayStatus = useGatewayStore((s) => s.fetchStatus);
  const statsError = useStatsStore((s) => s.error);
  const startGateway = useGatewayStore((s) => s.startGateway);
  const stopGateway = useGatewayStore((s) => s.stopGateway);
  const addToast = useToastStore((s) => s.addToast);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [keySaving, setKeySaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const savedApiKey = config?.api_key || "";
  const displayKey = draftKey !== null ? draftKey : savedApiKey;

  const handleKeyChange = (value: string) => {
    setDraftKey(value);
  };

  const regenerateKeyValue = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sk-switchai-${hex}`;
  };

  const handleRegenerate = () => {
    setDraftKey(regenerateKeyValue());
  };

  const handleKeyConfirm = async () => {
    if (!config || !draftKey?.trim()) return;
    setKeySaving(true);
    try {
      await saveConfig({ ...config, api_key: draftKey });
      setDraftKey(null);
      addToast("success", t("settings.saved"));
    } catch (e) {
      addToast("error", String(e));
    } finally {
      setKeySaving(false);
    }
  };

  const refresh = () => {
    fetchStats(days);
    fetchDailyStats(days);
    fetchGatewayStatus();
  };

  useEffect(() => {
    refresh();
  }, [days]);

  const gatewayRunning = gatewayStatus?.running;
  const gatewayUrl = gatewayStatus
    ? `http://${gatewayStatus.host}:${gatewayStatus.port}/v1`
    : "";
  const apiKey = config?.api_key || "";
  const modelId = config?.server?.default_model_id || "localhost";
  const curlExample = `curl ${gatewayUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{"model": "${modelId}", "messages": [{"role": "user", "content": "Hello!"}]}'`;

  useEffect(() => {
    if (!gatewayRunning) return;
    const interval = setInterval(() => {
      fetchStats(days);
      fetchDailyStats(days);
    }, 5000);
    return () => clearInterval(interval);
  }, [gatewayRunning, days]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    addToast("success", `${label} copied`);
  };

  const handleGatewayToggle = async () => {
    setGatewayLoading(true);
    try {
      if (gatewayRunning) {
        await stopGateway();
      } else {
        await startGateway();
      }
    } catch (e) {
      addToast("error", String(e));
    } finally {
      setGatewayLoading(false);
    }
  };

  const totalInputTokens = stats?.total_input_tokens || 0;
  const totalOutputTokens = stats?.total_output_tokens || 0;

  const pieData = useMemo(
    () =>
      stats?.by_model.map((m) => ({
        name: m.model,
        value: m.input_tokens + m.output_tokens,
      })) || [],
    [stats]
  );

  const chartData = dailyStats.map((d) => ({
    date: d.date.slice(5),
    tokens: d.tokens,
    requests: d.requests,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("dashboard.title")}</h1>
        <div className="flex items-center gap-2">
          {[7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                days === d
                  ? "bg-primary-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {d === 7 ? t("dashboard.days7") : t("dashboard.days30")}
            </button>
          ))}
          <button onClick={refresh} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-primary-600" />
            {t("dashboard.apiEntry")}
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  gatewayRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"
                }`}
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {gatewayRunning ? t("dashboard.gatewayRunning") : t("dashboard.gatewayStopped")}
              </span>
            </div>
            <button
              onClick={handleGatewayToggle}
              disabled={gatewayLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                gatewayRunning
                  ? "bg-red-50 dark:bg-red-950 text-red-600 hover:bg-red-100 dark:hover:bg-red-900"
                  : "bg-green-50 dark:bg-green-950 text-green-600 hover:bg-green-100 dark:hover:bg-green-900"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {gatewayRunning ? (
                <PowerOff className="w-4 h-4" />
              ) : (
                <Power className="w-4 h-4" />
              )}
              {gatewayRunning ? t("sidebar.stop") : t("sidebar.start")}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 min-w-[100px]">
              <Server className="w-3.5 h-3.5" />
              {t("dashboard.gatewayUrl")}
            </label>
            <div className="flex items-center gap-2 flex-1">
              <code className="flex-1 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm font-mono text-gray-900 dark:text-gray-100 break-all select-all">
                {gatewayRunning ? gatewayUrl : "--"}
              </code>
              {gatewayRunning && (
                <button onClick={() => copyText(gatewayUrl, "URL")}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
                  <Copy className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 min-w-[100px]">
              <Key className="w-3.5 h-3.5" />
              {t("dashboard.modelId")}
            </label>
            <div className="flex items-center gap-2 flex-1">
              <code className="flex-1 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm font-mono text-gray-900 dark:text-gray-100 break-all select-all">
                {modelId}
              </code>
              <button onClick={() => copyText(modelId, t("dashboard.modelId"))}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 min-w-[100px]">
              <Key className="w-3.5 h-3.5" />
              {t("dashboard.apiKey")}
            </label>
            <div className="flex items-center gap-2 flex-1">
              <input
                type={showKey ? "text" : "password"}
                className="input-field font-mono text-sm flex-1"
                value={displayKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder={t("settings.apiKeyPlaceholder")}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                title={showKey ? "Hide" : "Show"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              {displayKey && (
                <button onClick={() => copyText(displayKey, "API Key")}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
                  <Copy className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={handleRegenerate}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                title={t("settings.apiKeyRegenerate")}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={handleKeyConfirm}
                disabled={keySaving || !displayKey.trim()}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                title={t("settings.save")}
              >
                {keySaving ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            {t("dashboard.curlExample")}
          </label>
          <div className="relative">
            <pre className="px-4 py-3 rounded-lg bg-gray-900 dark:bg-black text-xs text-green-400 overflow-x-auto select-all whitespace-pre-wrap">
{gatewayRunning ? curlExample : `# Start the gateway to see the curl example
# The API is compatible with OpenAI SDK — point any OpenAI client to:
#   base_url = "${"http://127.0.0.1:3000/v1"}"`}
            </pre>
            {gatewayRunning && (
              <button
                onClick={() => copyText(curlExample, "cURL")}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {gatewayRunning && (
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <Key className="w-3 h-3" />
            <span>{t("dashboard.openaiCompatible")}</span>
            <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              POST {gatewayUrl}/chat/completions
            </code>
            <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              GET {gatewayUrl}/models
            </code>
          </div>
        )}

        <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-700 dark:text-blue-300">
            💡 <strong>{t("dashboard.sdkTipTitle")}</strong>{" "}
            {t("dashboard.sdkTipDesc")}
          </p>
        </div>
      </div>

      {statsError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{statsError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Zap className="w-5 h-5" />}
          label={t("dashboard.totalRequests")}
          value={stats?.total_requests.toLocaleString() || "0"}
          color="text-blue-600"
          bg="bg-blue-50 dark:bg-blue-950"
        />
        <StatCard
          icon={<Database className="w-5 h-5" />}
          label={t("dashboard.totalInputTokens")}
          value={totalInputTokens.toLocaleString()}
          color="text-green-600"
          bg="bg-green-50 dark:bg-green-950"
        />
        <StatCard
          icon={<Database className="w-5 h-5" />}
          label={t("dashboard.totalOutputTokens")}
          value={totalOutputTokens.toLocaleString()}
          color="text-purple-600"
          bg="bg-purple-50 dark:bg-purple-950"
        />
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label={t("dashboard.estCost")}
          value={`$${(stats?.total_cost || 0).toFixed(4)}`}
          color="text-amber-600"
          bg="bg-amber-50 dark:bg-amber-950"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            {t("dashboard.tokenChart")}
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="tokens" name={t("dashboard.tokens")} stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="requests" name={t("dashboard.requests")} stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400">
              {t("dashboard.noData")}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            {t("dashboard.tokenDist")}
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  label={({ name }) => name}
                >
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400">
              {t("dashboard.noData")}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("dashboard.failedRate")}
        </h3>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">{stats?.successful_requests.toLocaleString() || 0}</p>
            <p className="text-sm text-gray-500">{t("dashboard.successful")}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-red-600">{stats?.failed_requests.toLocaleString() || 0}</p>
            <p className="text-sm text-gray-500">{t("dashboard.failed")}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-600 dark:text-gray-300">
              {stats?.total_requests
                ? ((stats.failed_requests / stats.total_requests) * 100).toFixed(1)
                : "0"}%
            </p>
            <p className="text-sm text-gray-500">{t("dashboard.failureRate")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bg: string;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-lg ${bg} ${color}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}
