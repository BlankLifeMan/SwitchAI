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

export function Providers() {
  const { t } = useI18n();
  const config = useConfigStore((s) => s.config);
  const deleteProvider = useConfigStore((s) => s.deleteProvider);
  const testProvider = useConfigStore((s) => s.testProvider);
  const addProvider = useConfigStore((s) => s.addProvider);
  const updateProvider = useConfigStore((s) => s.updateProvider);
  const addToast = useToastStore((s) => s.addToast);
  const gatewayStatus = useGatewayStore((s) => s.status);
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
          data.multimodal_models
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
          data.multimodal_models
        );
        addToast("success", t("toast.providerAdded"));
      }
    } catch (e) {
      addToast("error", editingProvider ? t("toast.providerUpdateFailed") : t("toast.providerAddFailed"));
      throw e;
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
              <th className="table-header">{t("provider.table.name")}</th>
              <th className="table-header">{t("provider.table.apiBase")}</th>
              <th className="table-header">{t("provider.table.priority")}</th>
              <th className="table-header">{t("provider.table.status")}</th>
              <th className="table-header">{t("provider.table.models")}</th>
              <th className="table-header">{t("provider.table.test")}</th>
              <th className="table-header">{t("provider.table.actions")}</th>
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
                    )}
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
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
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
