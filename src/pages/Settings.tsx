import { useEffect, useState, useMemo } from "react";
import { useConfigStore } from "../store/configStore";
import { useToastStore } from "../store/toastStore";
import { ThemeToggle } from "../components/ThemeToggle";
import { Save, Loader2, RefreshCw, X, Plus, Trash2 } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import type { Lang } from "../i18n/translations";

export function Settings() {
  const { t, lang, setLang, ready } = useI18n();
  const config = useConfigStore((s) => s.config);
  const loading = useConfigStore((s) => s.loading);
  const saveConfig = useConfigStore((s) => s.saveConfig);
  const addToast = useToastStore((s) => s.addToast);
  const [port, setPort] = useState(3000);
  const [logRetentionDays, setLogRetentionDays] = useState(7);
  const [autoStart, setAutoStart] = useState(false);
  const [gatewayOnStartup, setGatewayOnStartup] = useState(false);
  const [modelId, setModelId] = useState("localhost");
  const [clientApiKeys, setClientApiKeys] = useState<any[]>([]);
  const [modelPrices, setModelPrices] = useState<any[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const allAvailableModels = useMemo(() => {
    if (!config) return [];
    const set = new Set<string>();
    config.providers.forEach((p) => {
      p.models.forEach((m) => set.add(m));
      p.multimodal_models?.forEach((m) => set.add(m));
    });
    return Array.from(set).sort();
  }, [config]);

  useEffect(() => {
    if (config) {
      setPort(config.server.port);
      setLogRetentionDays(config.server.log_retention_days || 7);
      setAutoStart(config.auto_start);
      setGatewayOnStartup(config.gateway_on_startup);
      setModelId(config.server.default_model_id || "localhost");
      setClientApiKeys(config.client_api_keys || []);
      const prices = config.model_prices || [];
      if (prices.length === 0) {
        setModelPrices([
          { model_pattern: "*", input_price_per_1k: 0.01, output_price_per_1k: 0.01 }
        ]);
      } else {
        setModelPrices(prices);
      }
    }
  }, [config]);

  const toggleAutoStart = async (enabled: boolean) => {
    setAutoStart(enabled);
    try {
      const { enable, disable } = await import("@tauri-apps/plugin-autostart");
      if (enabled) {
        await enable();
      } else {
        await disable();
      }
    } catch (e) {
      addToast("error", String(e));
    }
  };

  const handleSave = async () => {
    if (!config) return;
    if (saving || loading) return;

    const portNum = port;
    if (portNum < 1024 || portNum > 65535) {
      addToast("error", t("settings.portInvalid"));
      return;
    }

    setSaving(true);
    try {
      await saveConfig({
        ...config,
        server: {
          ...config.server,
          port: portNum,
          log_retention_days: logRetentionDays,
          default_model_id: modelId,
          token_price_per_1k: config.server.token_price_per_1k ?? 0.01,
        },
        auto_start: autoStart,
        gateway_on_startup: gatewayOnStartup,
        api_key: config.api_key,
        client_api_keys: clientApiKeys,
        model_prices: modelPrices,
      });
      setSaved(true);
      addToast("success", t("settings.saved"));
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      addToast("error", String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (!config) return;
    setPort(config.server.port);
    setLogRetentionDays(config.server.log_retention_days || 7);
    setAutoStart(config.auto_start);
    setGatewayOnStartup(config.gateway_on_startup);
    setModelId(config.server.default_model_id || "localhost");
    setClientApiKeys(config.client_api_keys || []);
    const prices = config.model_prices || [];
    if (prices.length === 0) {
      setModelPrices([
        { model_pattern: "*", input_price_per_1k: 0.01, output_price_per_1k: 0.01 }
      ]);
    } else {
      setModelPrices(prices);
    }
    addToast("info", t("settings.cancel"));
  };

  const hasChanges = config && (
    port !== config.server.port ||
    logRetentionDays !== (config.server.log_retention_days || 7) ||
    autoStart !== config.auto_start ||
    gatewayOnStartup !== config.gateway_on_startup ||
    modelId !== (config.server.default_model_id || "localhost") ||
    JSON.stringify(clientApiKeys) !== JSON.stringify(config.client_api_keys || []) ||
    JSON.stringify(modelPrices) !== JSON.stringify(config.model_prices || [])
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("settings.title")}</h1>

      <div className="card space-y-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("settings.server")}
        </h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("settings.port")}
          </label>
          <input
            type="number"
            className="input-field w-32"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            min={1024}
            max={65535}
          />
          <p className="text-xs text-gray-400 mt-1">{t("settings.portDesc")}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("settings.modelId") || "Default Model ID"}
          </label>
          <input
            type="text"
            className="input-field w-64 font-mono"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="localhost"
          />
          <p className="text-xs text-gray-400 mt-1">{t("settings.modelIdDesc")}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("settings.logRetention")}
          </label>
          <select
            className="input-field w-32"
            value={logRetentionDays}
            onChange={(e) => setLogRetentionDays(Number(e.target.value))}
          >
            <option value={1}>{t("settings.logDays1")}</option>
            <option value={7}>{t("settings.logDays7")}</option>
            <option value={30}>{t("settings.logDays30")}</option>
            <option value={0}>{t("settings.logDaysForever")}</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">{t("settings.logRetentionDesc")}</p>
        </div>

      </div>

      {/* Client API Keys Card */}
      <div className="card space-y-6">
        <div className="flex items-center justify-between border-b pb-3 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {lang === "zh" ? "客户端 API 密钥管理" : "Client API Keys"}
            </h3>
            <p className="text-xs text-gray-400">
              {lang === "zh" ? "为不同的客户端或用户分配独立的 API 密钥" : "Assign unique API keys to different clients or users"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setClientApiKeys([
                ...clientApiKeys,
                { name: "", api_key: "sk-" + Math.random().toString(36).substring(2, 15), enabled: true }
              ]);
            }}
            className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {lang === "zh" ? "添加密钥" : "Add Key"}
          </button>
        </div>

        {clientApiKeys.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            {lang === "zh" ? "暂无自定义客户端密钥，仅默认主密钥可用" : "No client API keys. Only the main API key is active."}
          </p>
        ) : (
          <div className="space-y-4">
            {clientApiKeys.map((item, idx) => (
              <div key={idx} className="flex items-end gap-3 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-100 dark:border-gray-800">
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {lang === "zh" ? "名称 / 标识" : "Name / Identifier"}
                      </label>
                      <input
                        type="text"
                        className="input-field text-sm font-medium w-full"
                        value={item.name}
                        placeholder={lang === "zh" ? "本地测试、应用A" : "Client A"}
                        onChange={(e) => {
                          const newKeys = [...clientApiKeys];
                          newKeys[idx].name = e.target.value;
                          setClientApiKeys(newKeys);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        API Key
                      </label>
                      <input
                        type="text"
                        className="input-field text-sm font-mono w-full"
                        value={item.api_key}
                        onChange={(e) => {
                          const newKeys = [...clientApiKeys];
                          newKeys[idx].api_key = e.target.value;
                          setClientApiKeys(newKeys);
                        }}
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 pb-1">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => {
                        const newKeys = [...clientApiKeys];
                        newKeys[idx].enabled = e.target.checked;
                        setClientApiKeys(newKeys);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600" />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setClientApiKeys(clientApiKeys.filter((_, i) => i !== idx));
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom Model Prices Card */}
      <div className="card space-y-6">
        <div className="flex items-center justify-between border-b pb-3 dark:border-gray-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {lang === "zh" ? "模型定价配置" : "Custom Model Pricing"}
            </h3>
            <p className="text-xs text-gray-400">
              {lang === "zh" ? "为特定模型或通配符规则设置输入/输出单价" : "Configure token prices for specific models or wildcard patterns"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setModelPrices([
                ...modelPrices,
                { model_pattern: "", input_price_per_1k: 0.01, output_price_per_1k: 0.01 }
              ]);
            }}
            className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {lang === "zh" ? "添加规则" : "Add Rule"}
          </button>
        </div>

        {modelPrices.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            {lang === "zh" ? "暂无自定义定价，全部模型将使用全局计费价格" : "No custom prices. All models use the global default price."}
          </p>
        ) : (
          <div className="space-y-4">
            {modelPrices.map((item, idx) => (
              <div key={idx} className="flex items-end gap-3 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-100 dark:border-gray-800">
                <div className="flex-1 grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {lang === "zh" ? "模型匹配规则 (支持 *)" : "Model Pattern (gpt-*)"}
                    </label>
                    <input
                      type="text"
                      className="input-field text-sm font-mono w-full"
                      list="model-suggestions"
                      value={item.model_pattern}
                      placeholder="deepseek-*"
                      onChange={(e) => {
                        const newPrices = [...modelPrices];
                        newPrices[idx].model_pattern = e.target.value;
                        setModelPrices(newPrices);
                      }}
                    />
                    <datalist id="model-suggestions">
                      <option value="*" />
                      {allAvailableModels.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {lang === "zh" ? "输入单价 ($/1K)" : "Input Price ($/1K)"}
                    </label>
                    <input
                      type="number"
                      className="input-field text-sm w-full"
                      value={item.input_price_per_1k}
                      step={0.0001}
                      min={0}
                      onChange={(e) => {
                        const newPrices = [...modelPrices];
                        newPrices[idx].input_price_per_1k = Number(e.target.value);
                        setModelPrices(newPrices);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {lang === "zh" ? "输出单价 ($/1K)" : "Output Price ($/1K)"}
                    </label>
                    <input
                      type="number"
                      className="input-field text-sm w-full"
                      value={item.output_price_per_1k}
                      step={0.0001}
                      min={0}
                      onChange={(e) => {
                        const newPrices = [...modelPrices];
                        newPrices[idx].output_price_per_1k = Number(e.target.value);
                        setModelPrices(newPrices);
                      }}
                    />
                  </div>
                </div>

                <div className="pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      setModelPrices(modelPrices.filter((_, i) => i !== idx));
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("settings.preferences")}
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.appearance")}
            </p>
            <p className="text-xs text-gray-400">{t("settings.appearanceDesc")}</p>
          </div>
          <ThemeToggle />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.language")}
            </p>
            <p className="text-xs text-gray-400">{t("settings.languageDesc")}</p>
          </div>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="input-field w-28"
            disabled={!ready}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.autoStart")}
            </p>
            <p className="text-xs text-gray-400">{t("settings.autoStartDesc")}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => toggleAutoStart(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600" />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("settings.gatewayAutoStart")}
            </p>
            <p className="text-xs text-gray-400">{t("settings.gatewayAutoStartDesc")}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={gatewayOnStartup}
              onChange={(e) => setGatewayOnStartup(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600" />
          </label>
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("settings.updates") || "Updates"}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("settings.updatesDesc") || "Check for the latest version of SwitchAI."}
        </p>
        <button
          onClick={async () => {
            setChecking(true);
            try {
              const { check } = await import("@tauri-apps/plugin-updater");
              const update = await check();
              if (update) {
                addToast("info", `${t("settings.updateAvailable")}: ${update.version}`);
              } else {
                addToast("success", t("settings.upToDate") || "You are running the latest version");
              }
            } catch (e) {
              addToast("error", String(e));
            } finally {
              setChecking(false);
            }
          }}
          disabled={checking}
          className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {checking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {checking ? "..." : t("settings.checkUpdate") || "Check for Updates"}
        </button>
      </div>

      <div className="sticky bottom-0 z-40 -mx-4 px-4 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700 shadow-lg rounded-b-lg flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {t("settings.unsaved")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            disabled={saving || loading || !hasChanges}
            className="btn-secondary flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
            {t("settings.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "..." : t("settings.save")}
          </button>
          {saved && <span className="text-sm text-green-600">{t("settings.saved")}</span>}
        </div>
      </div>
    </div>
  );
}
