import { create } from "zustand";
import type { PaginatedLogs, LogFilter, StatsSummary, DailyStats } from "../types";

const getInvoke = async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
};

interface StatsState {
  logs: PaginatedLogs | null;
  stats: StatsSummary | null;
  dailyStats: DailyStats[];
  loading: boolean;
  error: string | null;
  fetchLogs: (page: number, pageSize: number, filter?: LogFilter) => Promise<void>;
  fetchStats: (days?: number) => Promise<void>;
  fetchDailyStats: (days?: number) => Promise<void>;
  exportLogs: (format?: string) => Promise<string>;
}

export const useStatsStore = create<StatsState>((set) => ({
  logs: null,
  stats: null,
  dailyStats: [],
  loading: false,
  error: null,

  fetchLogs: async (page: number, pageSize: number, filter?: LogFilter) => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const result = await invoke<PaginatedLogs>("get_logs", {
        page,
        pageSize,
        filter: filter || null,
      });
      set({ logs: result, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchStats: async (days?: number) => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const stats = await invoke<StatsSummary>("get_stats", {
        days: days ?? null,
      });
      set({ stats, loading: false });
    } catch (e) {
      console.error("[statsStore] fetchStats failed:", e);
      set({ error: String(e), loading: false });
    }
  },

  exportLogs: async (format?: string) => {
    try {
      const invoke = await getInvoke();
      return await invoke<string>("export_logs", {
        format: format || "csv",
      });
    } catch (e) {
      throw e;
    }
  },

  fetchDailyStats: async (days?: number) => {
    set({ loading: true, error: null });
    try {
      const invoke = await getInvoke();
      const dailyStats = await invoke<DailyStats[]>("get_daily_stats", {
        days: days ?? null,
      });
      set({ dailyStats, loading: false });
    } catch (e) {
      console.error("[statsStore] fetchDailyStats failed:", e);
      set({ error: String(e), loading: false });
    }
  },
}));
