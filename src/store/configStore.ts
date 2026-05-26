import { create } from "zustand";
import type { Config, Provider, ModelRouting, ServerConfig, TestProviderResult } from "../types";

const getInvoke = async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
};

interface ConfigState {
  config: Config | null;
  loading: boolean;
  error: string | null;
  fetchConfig: () => Promise<void>;
  reloadConfig: () => Promise<void>;
  saveConfig: (config: Config) => Promise<Config | void>;
  addProvider: (
    name: string,
    apiBase: string,
    apiKey: string,
    priority: number,
    enabled: boolean,
    models: string[],
    multimodalModels: string[]
  ) => Promise<void>;
  updateProvider: (
    id: string,
    name: string,
    apiBase: string,
    apiKey: string | null,
    priority: number,
    enabled: boolean,
    models: string[],
    multimodalModels: string[]
  ) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  testProvider: (providerId: string) => Promise<TestProviderResult>;
  testProviderDirect: (apiBase: string, apiKey: string) => Promise<TestProviderResult>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  loading: false,
  error: null,

  fetchConfig: async () => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const config = await invoke<Config>("get_config");
      set({ config, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  reloadConfig: async () => {
    try {
      const invoke = await getInvoke();
      const config = await invoke<Config>("get_config");
      set({ config });
    } catch (e) {
      console.error("Failed to reload config:", e);
    }
  },

  saveConfig: async (config: Config) => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const result = await invoke<Config>("save_config", {
        port: config.server.port,
        logRetentionDays: config.server.log_retention_days,
        apiKey: config.api_key,
        theme: config.theme,
        language: config.language,
        autoStart: config.auto_start,
        gatewayOnStartup: config.gateway_on_startup,
        defaultModelId: config.server.default_model_id,
        tokenPricePer1k: config.server.token_price_per_1k ?? 0.01,
        providers: config.providers,
        routing: config.routing,
        modelMappings: config.model_mappings,
      });
      set({ config: result, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  addProvider: async (name, apiBase, apiKey, priority, enabled, models, multimodalModels) => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const result = await invoke<Config>("add_provider", {
        name,
        apiBase,
        apiKey,
        priority,
        enabled,
        models,
        multimodalModels,
      });
      set({ config: result, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  updateProvider: async (id, name, apiBase, apiKey, priority, enabled, models, multimodalModels) => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const result = await invoke<Config>("update_provider", {
        id,
        name,
        apiBase,
        apiKey,
        priority,
        enabled,
        models,
        multimodalModels,
      });
      set({ config: result, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  deleteProvider: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const result = await invoke<Config>("delete_provider", { id });
      set({ config: result, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  testProvider: async (providerId: string) => {
    try {
      const invoke = await getInvoke();
      return await invoke<TestProviderResult>("test_provider", {
        id: providerId,
      });
    } catch (e) {
      return { success: false, message: String(e) };
    }
  },

  testProviderDirect: async (apiBase: string, apiKey: string) => {
    try {
      const invoke = await getInvoke();
      return await invoke<TestProviderResult>("test_provider_direct", {
        apiBase,
        apiKey,
      });
    } catch (e) {
      return { success: false, message: String(e) };
    }
  },
}));
