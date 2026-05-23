import { useEffect, useState, useRef } from "react";
import { useStatsStore } from "../store/statsStore";
import { useToastStore } from "../store/toastStore";
import type { LogFilter, RequestLog } from "../types";
import { Download, Search, ChevronLeft, ChevronRight, XCircle, CheckCircle, RefreshCw, Loader2, AlertCircle, Trash2, X, Copy, CopyCheck } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";

function formatBody(body: string | undefined): string {
  if (!body) return "";
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function Logs() {
  const { t } = useI18n();
  const logs = useStatsStore((s) => s.logs);
  const loading = useStatsStore((s) => s.loading);
  const fetchError = useStatsStore((s) => s.error);
  const fetchLogs = useStatsStore((s) => s.fetchLogs);
  const exportLogs = useStatsStore((s) => s.exportLogs);
  const addToast = useToastStore((s) => s.addToast);
  const [page, setPage] = useState(1);
  const [modelFilter, setModelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [exporting, setExporting] = useState(false);
  const didMount = useRef(false);
  const pageSize = 20;
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const buildFilter = (): LogFilter | undefined => {
    const f: LogFilter = {};
    if (modelFilter) f.model = modelFilter;
    if (statusFilter === "success") f.success = true;
    if (statusFilter === "failed") f.success = false;
    if (!modelFilter && statusFilter === "all") return undefined;
    return f;
  };

  const load = (p: number) => {
    fetchLogs(p, pageSize, buildFilter());
  };

  useEffect(() => {
    load(page);
  }, [page]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      load(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [modelFilter, statusFilter]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (fetchError) {
      addToast("error", fetchError);
    }
  }, [fetchError]);

  const handleSearch = () => {
    setPage(1);
    load(1);
  };

  const handleRefresh = () => {
    load(page);
  };

  const handleClearLogs = async () => {
    if (!window.confirm(t("logs.clearConfirm"))) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_logs");
      load(page);
    } catch (e) {
      addToast("error", String(e));
    }
  };

  const handleExport = async (format: string) => {
    setExporting(true);
    try {
      const data = await exportLogs(format);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const ext = format === "json" ? "json" : "csv";
      const path = await save({
        defaultPath: `switchai-logs.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (path) {
        await writeTextFile(path, data);
        addToast("success", `${t("logs.exportedTo")} ${path}`);
      }
    } catch (e) {
      addToast("error", String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      addToast("error", "Failed to copy");
    }
  };

  const totalPages = logs ? Math.max(1, Math.ceil(logs.total / pageSize)) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("logs.title")}</h1>
        <div className="flex gap-2">
          <button onClick={handleRefresh} disabled={loading} className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t("logs.refresh")}
          </button>
          <button onClick={() => handleExport("csv")} disabled={exporting || !logs?.logs?.length}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t("logs.exportCsv")}
          </button>
          <button onClick={() => handleExport("json")} disabled={exporting || !logs?.logs?.length}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t("logs.exportJson")}
          </button>
          <button onClick={handleClearLogs} disabled={loading || !logs?.logs?.length}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950">
            <Trash2 className="w-4 h-4" />
            {t("logs.clear")}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input-field pl-9" placeholder={t("logs.filterModel")}
              value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
          </div>
          <select value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="input-field w-36">
            <option value="all">{t("logs.allStatus")}</option>
            <option value="success">{t("logs.success")}</option>
            <option value="failed">{t("logs.failed")}</option>
          </select>
          <button onClick={handleSearch} disabled={loading} className="btn-primary text-sm disabled:opacity-50">{t("logs.search")}</button>
        </div>

        {loading && !logs && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span>{t("logs.loading") || "Loading..."}</span>
          </div>
        )}

        {fetchError && logs && (
          <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700 dark:text-red-300 break-all">{fetchError}</p>
          </div>
        )}

        {logs && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="table-header">{t("logs.table.time")}</th>
                    <th className="table-header">{t("logs.table.model")}</th>
                    <th className="table-header">{t("logs.table.provider")}</th>
                    <th className="table-header">{t("logs.table.status")}</th>
                    <th className="table-header">{t("logs.table.inputTokens")}</th>
                    <th className="table-header">{t("logs.table.outputTokens")}</th>
                    <th className="table-header">{t("logs.table.duration")}</th>
                    <th className="table-header">{t("logs.table.type")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.logs.map((log, i) => (
                    <tr key={i}
                      onClick={() => setSelectedLog(log)}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-850 cursor-pointer">
                      <td className="table-cell text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="table-cell font-medium">{log.model}</td>
                      <td className="table-cell text-gray-500 text-xs font-mono">{log.provider.slice(0, 12)}</td>
                      <td className="table-cell">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.success ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"}`}>
                          {log.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {log.status_code || "ERR"}
                        </span>
                      </td>
                      <td className="table-cell">{log.input_tokens ?? "-"}</td>
                      <td className="table-cell">{log.output_tokens ?? "-"}</td>
                      <td className="table-cell text-gray-500">{log.duration_ms}ms</td>
                      <td className="table-cell text-xs text-gray-400">{log.is_streaming ? t("logs.streaming") : t("logs.nonStreaming")}</td>
                    </tr>
                  ))}
                  {logs.logs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center">
                        <p className="text-gray-400 mb-2">{t("logs.noLogs")}</p>
                        <p className="text-xs text-gray-300 dark:text-gray-600">{t("logs.noLogsHint") || "Requests proxied through the gateway will appear here"}</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-500">
                {t("logs.pagination", { total: logs?.total || 0, page, totalPages })}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}
                  className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
                  <ChevronLeft className="w-4 h-4" /> {t("logs.prev")}
                </button>
                <span className="text-sm text-gray-500 px-2">{page}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}
                  className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
                  {t("logs.next")} <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Detail Panel */}
      {selectedLog && (
        <>
          {/* Backdrop - mobile only */}
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSelectedLog(null)} />

          {/* Panel */}
          <div className="fixed z-50 inset-0 lg:inset-auto lg:right-0 lg:top-0 lg:h-full lg:w-[28rem] bg-white dark:bg-gray-900 shadow-2xl overflow-auto">
            <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("logs.detail")}</h2>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.time")}</p>
                  <p className="text-sm text-gray-900 dark:text-white">{new Date(selectedLog.timestamp).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.model")}</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedLog.model}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.provider")}</p>
                  <p className="text-sm font-mono text-gray-700 dark:text-gray-300">{selectedLog.provider}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.status")}</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    selectedLog.success ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"}`}>
                    {selectedLog.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {selectedLog.status_code || "ERR"}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.duration")}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{selectedLog.duration_ms}ms</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.type")}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{selectedLog.is_streaming ? t("logs.streaming") : t("logs.nonStreaming")}</p>
                </div>
              </div>

              {/* Token Info */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.inputTokens")}</p>
                  <p className="text-sm font-mono text-gray-900 dark:text-white">{selectedLog.input_tokens ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.table.outputTokens")}</p>
                  <p className="text-sm font-mono text-gray-900 dark:text-white">{selectedLog.output_tokens ?? "-"}</p>
                </div>
              </div>

              {/* Error Message */}
              {selectedLog.error_message && (
                <div>
                  <p className="text-xs text-red-400 dark:text-red-400 mb-1">Error</p>
                  <p className="text-sm text-red-600 dark:text-red-400 break-all">{selectedLog.error_message}</p>
                </div>
              )}

              {/* Endpoint URL */}
              {selectedLog.endpoint && (
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t("logs.endpoint")}</p>
                  <p className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all bg-gray-50 dark:bg-gray-800 rounded p-2">{selectedLog.endpoint}</p>
                </div>
              )}

              {/* Request Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t("logs.requestBody")}</p>
                  {selectedLog.request_body && (
                    <button
                      onClick={() => handleCopy(formatBody(selectedLog.request_body), "request")}
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                    >
                      {copiedField === "request" ? <CopyCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedField === "request" ? t("logs.copied") : "Copy"}
                    </button>
                  )}
                </div>
                <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                  {selectedLog.request_body ? formatBody(selectedLog.request_body) : "-"}
                </pre>
              </div>

              {/* Response Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t("logs.responseBody")}</p>
                  {selectedLog.response_body && (
                    <button
                      onClick={() => handleCopy(formatBody(selectedLog.response_body), "response")}
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                    >
                      {copiedField === "response" ? <CopyCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedField === "response" ? t("logs.copied") : "Copy"}
                    </button>
                  )}
                </div>
                <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                  {selectedLog.response_body ? formatBody(selectedLog.response_body) : "-"}
                </pre>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
