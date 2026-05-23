import { create } from "zustand";
import type { GatewayStatus } from "../types";

const getInvoke = async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
};

interface GatewayState {
  status: GatewayStatus | null;
  loading: boolean;
  operating: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
  startGateway: () => Promise<void>;
  stopGateway: () => Promise<void>;
}

export const useGatewayStore = create<GatewayState>((set) => ({
  status: null,
  loading: false,
  operating: false,
  error: null,

  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const status = await invoke<GatewayStatus>("gateway_status");
      set({ status, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  startGateway: async () => {
    set({ operating: true, error: null });
    try {
      const invoke = await getInvoke();
      const status = await invoke<GatewayStatus>("start_gateway");
      set({ status, operating: false });
    } catch (e) {
      set({ error: String(e), operating: false });
      throw e;
    }
  },

  stopGateway: async () => {
    set({ operating: true, error: null });
    try {
      const invoke = await getInvoke();
      const status = await invoke<GatewayStatus>("stop_gateway");
      set({ status, operating: false });
    } catch (e) {
      set({ error: String(e), operating: false });
      throw e;
    }
  },
}));
