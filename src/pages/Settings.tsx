import { useEffect, useState } from "react";
import { useConfigStore } from "../store/configStore";
import { useToastStore } from "../store/toastStore";
import { ThemeToggle } from "../components/ThemeToggle";
import { Save, Loader2, RefreshCw, X } from "lucide-react";
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
  const [tokenPrice, setTokenPrice] = useState(0.01);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (config) {
      setPort(config.server.port);
      setLogRetentionDays(config.server.log_retention_days || 7);
      setAutoStart(config.auto_start);
      setGatewayOnStartup(config.gateway_on_startup);
      setModelId(config.server.default_model_id || "localhost");
      setTokenPrice(config.server.token_price_per_1k ?? 0.01);
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
          token_price_per_1k: tokenPrice,
        },
        auto_start: autoStart,
        gateway_on_startup: gatewayOnStartup,
        api_key: config.api_key,
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
    setTokenPrice(config.server.token_price_per_1k ?? 0.01);
    addToast("info", t("settings.cancel"));
  };

  const hasChanges = config && (
    port !== config.server.port ||
    logRetentionDays !== (config.server.log_retention_days || 7) ||
    autoStart !== config.auto_start ||
    gatewayOnStartup !== config.gateway_on_startup ||
    modelId !== (config.server.default_model_id || "localhost") ||
    Math.abs(tokenPrice - (config.server.token_price_per_1k ?? 0.01)) > 0.000001
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

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t("settings.tokenPrice")}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">$</span>
            <input
              type="number"
              className="input-field w-28"
              value={tokenPrice}
              onChange={(e) => setTokenPrice(Number(e.target.value))}
              min={0}
              step={0.001}
            />
            <span className="text-gray-400 text-sm">{t("settings.per1kTokens")}</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">{t("settings.tokenPriceDesc")}</p>
        </div>
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
