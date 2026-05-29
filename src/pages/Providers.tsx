import { useState } from "react";
import { useConfigStore } from "../store/configStore";
import { useGatewayStore } from "../store/gatewayStore";
import { useToastStore } from "../store/toastStore";
import { ProviderForm, type ProviderFormData } from "../components/ProviderForm";
import type { Provider } from "../types";
import { Plus, Pencil, Trash2, FlaskConical, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";

const PRIORITY_LABELS: Record<number, string> = {
  25: "Low",
  50: "Normal",
  75: "High",
  100: "Critical",
};

function LatencySparkline({ history, avg }: { history: number[]; avg: number | undefined }) {
  if (!history || history.length === 0) {
    return <span className="text-gray-400 text-xs">-</span>;
  }

  const width = 60;
  const height = 24;
  const padding = 2;
  
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min;
  
  const points = history.map((val, index) => {
    const x = (index / (history.length - 1 || 1)) * (width - padding * 2) + padding;
    const y = range === 0 
      ? height / 2 
      : height - ((val - min) / range) * (height - padding * 2) - padding;
    return `${x},${y}`;
  });

  const pathD = points.length > 0 ? `M ${points.join(" L ")}` : "";

  return (
    <div className="flex items-center gap-3">
      {avg !== undefined && (
        <span className="text-xs font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
          {avg.toFixed(0)}ms
        </span>
      )}
      {history.length > 1 && (
        <svg width={width} height={height} className="overflow-visible">
          <path
            d={pathD}
            fill="none"
            className="stroke-primary-500 dark:stroke-primary-400"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={`${pathD} L ${width - padding},${height} L ${padding},${height} Z`}
            className="fill-primary-500/10 dark:fill-primary-400/10"
            stroke="none"
          />
        </svg>
      )}
    </div>
  );
}

export function Providers() {
  const { lang, t } = useI18n();
  const config = useConfigStore((s) => s.config);
  const deleteProvider = useConfigStore((s) => s.deleteProvider);
  const testProvider = useConfigStore((s) => s.testProvider);
  const addProvider = useConfigStore((s) => s.addProvider);
  const updateProvider = useConfigStore((s) => s.updateProvider);
  const addToast = useToastStore((s) => s.addToast);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const resetProviderHealth = useGatewayStore((s) => s.resetProviderHealth);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const handleAdd = () => {
    setEditingProvider(null);
    setFormOpen(true);
  };

  const handleEdit = (p: Provider) => {
    setEditingProvider(p);
    setFormOpen(true);
  };

  const handleSave = async (data: ProviderFormData) => {
    try {
      if (editingProvider) {
        await updateProvider(
          editingProvider.id,
          data.name,
          data.api_base,
          data.api_key || null,
          data.priority,
          data.enabled,
          data.models,
          data.multimodal_models,
          data.auto_health_check
        );
        addToast("success", t("toast.providerUpdated"));
      } else {
        await addProvider(
          data.name,
          data.api_base,
          data.api_key,
          data.priority,
          data.enabled,
          data.models,
          data.multimodal_models,
          data.auto_health_check
        );
        addToast("success", t("toast.providerAdded"));
      }
    } catch (e) {
      addToast("error", editingProvider ? t("toast.providerUpdateFailed") : t("toast.providerAddFailed"));
      throw e;
    }
  };

  const handleResetHealth = async (id: string) => {
    try {
      await resetProviderHealth(id);
      addToast("success", t("toast.healthResetSuccess"));
    } catch (e) {
      addToast("error", t("toast.healthResetFailed"));
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await testProvider(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.success) {
        addToast("success", t("toast.testSuccess"));
      } else {
        addToast("error", result.message || t("toast.testFailed"));
      }
    } catch (e) {
      addToast("error", String(e));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t("provider.deleteConfirm"))) {
      try {
        await deleteProvider(id);
        addToast("success", t("toast.providerDeleted"));
      } catch (e) {
        addToast("error", t("toast.providerDeleteFailed"));
      }
    }
  };

  const priorityLabel = (p: number) => {
    const key = PRIORITY_LABELS[p];
    return key ? t(`priority.${key.toLowerCase()}`) : String(p);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t("provider.title")}
        </h1>
        <button onClick={handleAdd} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> {t("provider.add")}
        </button>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="table-header w-32">{t("provider.table.name")}</th>
              <th className="table-header">{t("provider.table.apiBase")}</th>
              <th className="table-header w-24">{t("provider.table.priority")}</th>
              <th className="table-header w-36">{t("provider.table.status")}</th>
              <th className="table-header w-36">{lang === "zh" ? "响应延迟" : "Latency"}</th>
              <th className="table-header w-40">{t("provider.table.models")}</th>
              <th className="table-header w-16">{t("provider.table.test")}</th>
              <th className="table-header w-20">{t("provider.table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {config?.providers.map((p) => (
              <tr
                key={p.id}
                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-850"
              >
                <td className="table-cell font-medium">{p.name}</td>
                <td className="table-cell text-gray-500 dark:text-gray-400 font-mono text-xs">
                  {p.api_base}
                </td>
                <td className="table-cell">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.priority >= 100
                        ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"
                        : p.priority >= 75
                          ? "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300"
                          : p.priority >= 50
                            ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-500"
                    }`}
                  >
                    {priorityLabel(p.priority)}
                  </span>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-2">
                    {p.enabled && gatewayStatus?.provider_health?.[p.id] && (
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${
                          gatewayStatus.provider_health[p.id].unhealthy
                            ? "bg-red-500 animate-pulse"
                            : gatewayStatus.provider_health[p.id].consecutive_failures > 0
                              ? "bg-yellow-500"
                              : "bg-green-500"
                        }`}
                        title={
                          gatewayStatus.provider_health[p.id].unhealthy
                            ? t("provider.healthUnhealthy")
                            : gatewayStatus.provider_health[p.id].consecutive_failures > 0
                              ? t("provider.healthDegraded")
                              : t("provider.healthHealthy")
                        }
                      />
                    )}
                    {!p.enabled || !gatewayStatus?.provider_health?.[p.id] ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.enabled
                            ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-500"
                        }`}
                      >
                        {p.enabled ? t("provider.enabled") : t("provider.disabled")}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            gatewayStatus.provider_health[p.id].unhealthy
                              ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"
                              : gatewayStatus.provider_health[p.id].consecutive_failures > 0
                                ? "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300"
                                : "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300"
                          }`}
                        >
                          {gatewayStatus.provider_health[p.id].unhealthy
                            ? t("provider.healthUnhealthy")
                            : gatewayStatus.provider_health[p.id].consecutive_failures > 0
                              ? t("provider.healthDegraded")
                              : t("provider.healthHealthy")}
                        </span>
                        {gatewayStatus.provider_health[p.id].unhealthy && (
                          <button
                            onClick={() => handleResetHealth(p.id)}
                            className="px-1.5 py-0.5 text-[10px] font-medium bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950 text-red-600 dark:text-red-400 rounded border border-red-200 dark:border-red-900 transition-colors"
                            title={t("provider.resetHealth")}
                          >
                            {t("provider.resetHealth")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>
                <td className="table-cell w-36">
                  <div className="flex items-center gap-2 min-w-0">
                    <LatencySparkline
                      history={gatewayStatus?.provider_health?.[p.id]?.latency_history || []}
                      avg={gatewayStatus?.provider_health?.[p.id]?.average_latency_ms}
                    />
                  </div>
                </td>
                <td className="table-cell">
                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {p.models.slice(0, 3).map((m) => (
                      <span
                        key={m}
                        className="px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      >
                        {m}
                      </span>
                    ))}
                    {p.models.length > 3 && (
                      <span className="text-xs text-gray-400">+{p.models.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTest(p.id)}
                      disabled={testingId === p.id}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-primary-600"
                      title={t("provider.testConnection")}
                    >
                      {testingId === p.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FlaskConical className="w-4 h-4" />
                      )}
                    </button>
                    {testResults[p.id] && (
                      testResults[p.id].success ? (
                        <span title={testResults[p.id].message}>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        </span>
                      ) : (
                        <span title={testResults[p.id].message}>
                          <XCircle className="w-4 h-4 text-red-500" />
                        </span>
                      )
                    )}
                  </div>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(p)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-primary-600"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(!config?.providers || config.providers.length === 0) && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                  {t("provider.noProviders")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ProviderForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        provider={editingProvider}
      />
    </div>
  );
}
