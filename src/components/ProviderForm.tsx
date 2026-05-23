import { useState, useEffect, useCallback, type FormEvent } from "react";
import { X, FlaskConical, Loader2, CheckCircle, XCircle, Plus, AlertCircle, Image, ShieldCheck } from "lucide-react";
import type { Provider } from "../types";
import { useI18n } from "../i18n/I18nContext";
import { PROVIDER_PRESETS, PRIORITY_OPTIONS } from "../providers/presets";
import { useConfigStore } from "../store/configStore";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: ProviderFormData) => Promise<void>;
  provider?: Provider | null;
}

export interface ProviderFormData {
  name: string;
  api_base: string;
  api_key: string;
  priority: number;
  enabled: boolean;
  models: string[];
  multimodal_models: string[];
}

export function ProviderForm({ open, onClose, onSave, provider }: Props) {
  const { t } = useI18n();
  const testProviderDirect = useConfigStore((s) => s.testProviderDirect);

  const [presetKey, setPresetKey] = useState("");
  const [name, setName] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(50);
  const [enabled, setEnabled] = useState(true);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [multimodalModels, setMultimodalModels] = useState<Set<string>>(new Set());
  const [modelInput, setModelInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "fail">("idle");
  const [testMessage, setTestMessage] = useState("");
  const testing = testState === "testing";

  const currentPreset = PROVIDER_PRESETS.find((p) => p.key === presetKey);

  useEffect(() => {
    if (provider) {
      const matched = PROVIDER_PRESETS.find(
        (p) => p.api_base === provider.api_base
      );
      setPresetKey(matched?.key || "");
      setName(provider.name);
      setApiBase(provider.api_base);
      setApiKey("");
      setPriority(provider.priority);
      setEnabled(provider.enabled);
      setSelectedModels(new Set(provider.models));
      setMultimodalModels(new Set(provider.multimodal_models || []));
      setModelInput("");
      setError("");
      setTestState("idle");
      setTestMessage("");
    } else {
      setPresetKey("");
      setName("");
      setApiBase("");
      setApiKey("");
      setPriority(50);
      setEnabled(true);
      setSelectedModels(new Set());
      setMultimodalModels(new Set());
      setModelInput("");
      setError("");
      setTestState("idle");
      setTestMessage("");
    }
  }, [provider, open]);

  const handlePresetChange = (key: string) => {
    setPresetKey(key);
    const preset = PROVIDER_PRESETS.find((p) => p.key === key);
    if (preset) {
      setName(preset.name);
      setApiBase(preset.api_base);
      setSelectedModels(new Set(preset.models));
    } else {
      setName("");
      setApiBase("");
      setSelectedModels(new Set());
      setMultimodalModels(new Set());
    }
    setModelInput("");
  };

  const toggleModel = (model: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) {
        next.delete(model);
        setMultimodalModels((mm) => {
          const nextMm = new Set(mm);
          nextMm.delete(model);
          return nextMm;
        });
      } else {
        next.add(model);
      }
      return next;
    });
  };

  const toggleMultimodal = (model: string) => {
    if (!selectedModels.has(model)) return;
    setMultimodalModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  const presetModels = currentPreset?.models || [];
  const isPresetModel = (m: string) => presetModels.includes(m);
  const allPresetSelected = presetModels.length > 0 && presetModels.every((m) => selectedModels.has(m));

  const toggleAll = useCallback(() => {
    if (presetModels.length === 0) return;
    if (allPresetSelected) {
      setSelectedModels((prev) => {
        const next = new Set(prev);
        presetModels.forEach((m) => next.delete(m));
        return next;
      });
    } else {
      setSelectedModels((prev) => {
        const next = new Set(prev);
        presetModels.forEach((m) => next.add(m));
        return next;
      });
    }
  }, [presetModels, allPresetSelected]);

  const addCustomModel = () => {
    const trimmed = modelInput.trim();
    if (!trimmed) return;
    const names = trimmed.split(/[,，\s]+/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (names.length === 0) return;
    setSelectedModels((prev) => {
      const next = new Set(prev);
      names.forEach((n) => next.add(n));
      return next;
    });
    setModelInput("");
  };

  const handleModelInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); addCustomModel(); }
  };

  const removeCustomModel = (model: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      next.delete(model);
      return next;
    });
  };

  const validateUrl = (url: string): string | null => {
    if (!url) return t("providerForm.validateUrlEmpty");
    if (!/^https?:\/\/.+/.test(url)) return t("providerForm.validateUrlFormat");
    return null;
  };

  const handleTest = async () => {
    if (!apiBase || !apiKey) return;
    const urlErr = validateUrl(apiBase);
    if (urlErr) { setTestState("fail"); setTestMessage(urlErr); return; }
    setTestState("testing");
    setTestMessage("");
    try {
      const result = await testProviderDirect(apiBase, apiKey);
      setTestState(result.success ? "success" : "fail");
      setTestMessage(result.message);
    } catch (e) {
      setTestState("fail");
      setTestMessage(String(e));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (selectedModels.size === 0) return;
    const urlErr = validateUrl(apiBase);
    if (urlErr) { setError(urlErr); return; }
    setError("");
    setSaving(true);
    try {
      await onSave({
        name, api_base: apiBase, api_key: apiKey, priority, enabled,
        models: Array.from(selectedModels),
        multimodal_models: Array.from(multimodalModels),
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const customModels = Array.from(selectedModels).filter((m) => !isPresetModel(m));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {provider ? t("providerForm.titleEdit") : t("providerForm.title")}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-4 py-3 space-y-2.5 overflow-y-auto">
          {error && (
            <div className="p-2 rounded bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-300 break-all">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">{t("providerForm.providerType")}</label>
              <select value={presetKey} onChange={(e) => handlePresetChange(e.target.value)}
                className="input-field text-xs py-1.5" disabled={!!provider}>
                <option value="">{t("providerForm.custom")}</option>
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">{t("providerForm.name")}</label>
              <input className="input-field text-xs py-1.5" value={name}
                onChange={(e) => setName(e.target.value)} placeholder={t("providerForm.namePlaceholder")} required />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">{t("providerForm.apiBase")}</label>
            <input className="input-field font-mono text-xs py-1.5" value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder={t("providerForm.apiBasePlaceholder")} required />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">
              {t("providerForm.apiKey")}
              {provider && <span className="text-gray-400 font-normal"> {t("providerForm.apiKeyKeep")}</span>}
            </label>
            {provider?.has_api_key && !apiKey && (
              <div className="flex items-center gap-1 mb-1 text-xs text-green-600 dark:text-green-400">
                <ShieldCheck className="w-3 h-3 shrink-0" />
                {t("providerForm.keyStored")}
              </div>
            )}
            <div className="flex gap-1.5">
              <input type="password" value={apiKey}
                className={`input-field flex-1 text-xs py-1.5 ${provider?.has_api_key && !apiKey ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-950/20" : ""}`}
                onChange={(e) => { setApiKey(e.target.value); if (testState !== "idle") setTestState("idle"); }}
                placeholder={provider?.has_api_key ? t("providerForm.apiKeyPlaceholderEdit") : t("providerForm.apiKeyPlaceholder")}
                required={!provider} />
              <button type="button" onClick={handleTest} disabled={testing || !apiBase || !apiKey}
                className={`shrink-0 px-2 py-1.5 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                  testState === "success" ? "bg-green-100 dark:bg-green-950 text-green-700" :
                  testState === "fail" ? "bg-red-100 dark:bg-red-950 text-red-700" :
                  "bg-gray-100 dark:bg-gray-700 text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600"
                } disabled:opacity-50 disabled:cursor-not-allowed`}>
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> :
                 testState === "success" ? <CheckCircle className="w-3 h-3" /> :
                 testState === "fail" ? <XCircle className="w-3 h-3" /> :
                 <FlaskConical className="w-3 h-3" />}
                {testing ? t("providerForm.testing") : t("providerForm.test")}
              </button>
            </div>
            {testState !== "idle" && testMessage && (
              <p className={`text-xs mt-0.5 ${testState === "success" ? "text-green-600" : "text-red-600"}`}>{testMessage}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">{t("providerForm.priority")}</label>
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="input-field text-xs py-1.5">
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center pt-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t("providerForm.enabled")}</span>
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("providerForm.models")} <span className="text-gray-400 font-normal">({selectedModels.size})</span>
              </label>
              {presetModels.length > 0 && (
                <button type="button" onClick={toggleAll} className="text-xs text-primary-600 hover:text-primary-700">
                  {allPresetSelected ? t("providerForm.deselectAll") : t("providerForm.selectAll")}
                </button>
              )}
            </div>

            <div className="border border-gray-300 dark:border-gray-600 rounded-lg max-h-28 overflow-y-auto">
              {presetModels.length > 0 && (
                <div className="p-1 space-y-0.5">
                  {presetModels.map((m) => (
                    <label key={m}
                      className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer text-xs transition-colors ${
                        selectedModels.has(m) ? "bg-primary-50 dark:bg-primary-950 text-primary-700" : "hover:bg-gray-50 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300"}`}>
                      <input type="checkbox" checked={selectedModels.has(m)} onChange={() => toggleModel(m)}
                        className="w-3 h-3 rounded border-gray-300 text-primary-600" />
                      <span className="flex-1 truncate">{m}</span>
                      {selectedModels.has(m) && (
                        <button type="button" onClick={(e) => { e.preventDefault(); toggleMultimodal(m); }}
                          title={t("providerForm.multimodalToggle")}
                          className={`shrink-0 flex items-center gap-0.5 px-1 rounded text-[10px] font-medium transition-colors ${
                            multimodalModels.has(m)
                              ? "text-purple-600 bg-purple-100 dark:bg-purple-900/50 ring-1 ring-purple-300 dark:ring-purple-700"
                              : "text-gray-300 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                          }`}>
                          <Image className="w-3 h-3" />
                          {multimodalModels.has(m) && <span>{t("providerForm.multimodal")}</span>}
                        </button>
                      )}
                    </label>
                  ))}
                </div>
              )}
              {customModels.length > 0 && (
                <div className={`p-1 flex flex-wrap gap-1 ${presetModels.length > 0 ? "border-t border-gray-200 dark:border-gray-700" : ""}`}>
                  {customModels.map((m) => (
                    <span key={m} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900 text-primary-700">
                      {m}
                      <button type="button" onClick={(e) => { e.preventDefault(); toggleMultimodal(m); }}
                        title={t("providerForm.multimodalToggle")}
                        className={`shrink-0 flex items-center gap-0.5 px-0.5 rounded text-[10px] font-medium transition-colors ${
                          multimodalModels.has(m)
                            ? "text-purple-600 bg-purple-200 dark:bg-purple-800 ring-1 ring-purple-400 dark:ring-purple-600"
                            : "text-primary-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                        }`}>
                        <Image className="w-2.5 h-2.5" />
                        {multimodalModels.has(m) && <span>{t("providerForm.multimodal")}</span>}
                      </button>
                      <button type="button" onClick={() => removeCustomModel(m)} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                </div>
              )}
              {presetModels.length === 0 && customModels.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-2.5 text-center">{t("providerForm.modelsHint")}</p>
              )}
            </div>

            <div className="flex gap-1.5 mt-1.5">
              <input className="input-field flex-1 text-xs py-1.5" value={modelInput}
                onChange={(e) => setModelInput(e.target.value)} onKeyDown={handleModelInputKeyDown}
                placeholder={t("providerForm.addModelPlaceholder")} />
              <button type="button" onClick={addCustomModel} disabled={!modelInput.trim()}
                className="px-2 py-1.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-xs py-1.5 px-4">{t("providerForm.cancel")}</button>
            <button type="submit" disabled={saving || selectedModels.size === 0}
              className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5">
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              {saving ? t("providerForm.saving") : t("providerForm.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
