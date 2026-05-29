import { useEffect, useState, useRef } from "react";
import { useStatsStore } from "../store/statsStore";
import { useToastStore } from "../store/toastStore";
import type { LogFilter, RequestLog } from "../types";
import { Download, Search, ChevronLeft, ChevronRight, XCircle, CheckCircle, RefreshCw, Loader2, AlertCircle, Trash2, X, Copy, CopyCheck, ChevronDown, ChevronUp } from "lucide-react";
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
  const { t, lang } = useI18n();
  const logs = useStatsStore((s) => s.logs);
  const loading = useStatsStore((s) => s.loading);
  const fetchError = useStatsStore((s) => s.error);
  const fetchLogs = useStatsStore((s) => s.fetchLogs);
  const exportLogs = useStatsStore((s) => s.exportLogs);
  const addToast = useToastStore((s) => s.addToast);
  const [page, setPage] = useState(1);
  const [modelFilter, setModelFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [exporting, setExporting] = useState(false);
  const didMount = useRef(false);
  const pageSize = 20;
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  useEffect(() => {
    if (selectedLog) {
      const isAuthFailed = selectedLog.status_code === 401;
      const hasError = !selectedLog.success;
      if (isAuthFailed) {
        setExpandedStep("proxy-receive");
      } else if (hasError && !selectedLog.status_code) {
        setExpandedStep("proxy-forward");
      } else if (hasError && selectedLog.status_code && selectedLog.status_code >= 400) {
        setExpandedStep("upstream-respond");
      } else {
        setExpandedStep("upstream-respond");
      }
    } else {
      setExpandedStep(null);
    }
  }, [selectedLog]);

  const getTimelineSteps = (log: RequestLog) => {
    const isAuthFailed = log.status_code === 401;
    const hasError = !log.success;
    const errMessage = log.error_message;

    return [
      {
        id: "client-send",
        title: t("logs.timeline.clientSend") || "客户端 发送请求",
        description: t("logs.timeline.clientSendDesc")
          ? t("logs.timeline.clientSendDesc")
              .replace("{key}", log.client_key_name || "Default")
              .replace("{model}", log.model)
          : `客户端使用密钥 [${log.client_key_name || "Default"}] 发起对模型 [${log.model}] 的请求`,
        status: "success",
        time: new Date(log.timestamp).toLocaleTimeString(),
        details: (
          <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <div><strong>{t("logs.endpoint") || "请求地址"}:</strong> <code className="font-mono text-[11px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{log.endpoint || "/v1/chat/completions"}</code></div>
            <div><strong>{t("logs.table.type") || "类型"}:</strong> {log.is_streaming ? (t("logs.streaming") || "流式传输") : (t("logs.nonStreaming") || "普通传输")}</div>
          </div>
        )
      },
      {
        id: "proxy-receive",
        title: t("logs.timeline.proxyReceive") || "本地代理 (SwitchAI) 接收与解析",
        description: isAuthFailed 
          ? (t("logs.timeline.authFailed") || "鉴权失败：无效的网关 API Key") 
          : (t("logs.timeline.authSuccess") || "鉴权成功，已接收并解析客户端请求体"),
        status: isAuthFailed ? "error" : "success",
        details: (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400 font-medium">{t("logs.requestBody") || "请求体"} (Request Body):</span>
              {log.request_body && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(formatBody(log.request_body), "request");
                  }}
                  className="flex items-center gap-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                >
                  {copiedField === "request" ? <CopyCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === "request" ? t("logs.copied") : "复制"}
                </button>
              )}
            </div>
            <pre className="text-[11px] font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950 rounded-lg p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all border border-gray-100 dark:border-gray-800">
              {log.request_body ? formatBody(log.request_body) : "-"}
            </pre>
          </div>
        )
      },
      {
        id: "proxy-forward",
        title: t("logs.timeline.proxyForward") || "路由转发至云端供应商",
        description: isAuthFailed 
          ? (t("logs.timeline.skipped") || "已跳过") 
          : (hasError && !log.status_code 
              ? (t("logs.timeline.forwardFailed") || "转发请求失败（路由选择错误或全部通道异常）") 
              : t("logs.timeline.forwardSuccess")
                ? t("logs.timeline.forwardSuccess").replace("{provider}", log.provider)
                : `智能路由成功，将请求转发至供应商 [${log.provider}]`),
        status: isAuthFailed ? "skipped" : (hasError && !log.status_code ? "error" : "success"),
        details: (
          <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
            <div><strong>{t("logs.table.provider") || "提供商"}:</strong> {log.provider}</div>
            {hasError && !log.status_code && errMessage && (
              <div className="mt-1 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs">
                <strong>{t("error.title") || "错误信息"}:</strong> {errMessage}
              </div>
            )}
          </div>
        )
      },
      {
        id: "upstream-respond",
        title: t("logs.timeline.upstreamRespond") || "收到云端响应",
        description: isAuthFailed 
          ? (t("logs.timeline.skipped") || "已跳过") 
          : (hasError && !log.status_code 
              ? (t("logs.timeline.noResponse") || "未收到云端供应商的有效响应") 
              : `云端状态码: ${log.status_code || "未知"}`),
        status: isAuthFailed ? "skipped" : (hasError && !log.status_code ? "skipped" : (log.status_code && log.status_code >= 400 ? "error" : "success")),
        details: (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400 font-medium">{t("logs.responseBody") || "响应体"} (Response Body):</span>
              {log.response_body && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(formatBody(log.response_body), "response");
                  }}
                  className="flex items-center gap-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                >
                  {copiedField === "response" ? <CopyCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === "response" ? t("logs.copied") : "复制"}
                </button>
              )}
            </div>
            <pre className="text-[11px] font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950 rounded-lg p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all border border-gray-100 dark:border-gray-800">
              {log.response_body ? formatBody(log.response_body) : "-"}
            </pre>
            {hasError && log.status_code && log.status_code >= 400 && errMessage && (
              <div className="mt-1 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs">
                <strong>{t("error.title") || "错误信息"}:</strong> {errMessage}
              </div>
            )}
          </div>
        )
      },
      {
        id: "proxy-metrics",
        title: t("logs.timeline.proxyMetrics") || "本地代理 记录指标",
        description: isAuthFailed 
          ? (t("logs.timeline.skipped") || "已跳过") 
          : t("logs.timeline.metricsLogged")
            ? t("logs.timeline.metricsLogged").replace("{duration}", String(log.duration_ms))
            : `计算耗时 (${log.duration_ms}ms) 与 Token 消耗并写入本地 SQLite`,
        status: isAuthFailed ? "skipped" : "success",
        details: (
          <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <div><strong>{t("logs.table.duration") || "总耗时"}:</strong> {log.duration_ms} ms</div>
            <div><strong>{t("logs.table.inputTokens") || "输入"} Token:</strong> {log.input_tokens ?? 0}</div>
            <div><strong>{t("logs.table.outputTokens") || "输出"} Token:</strong> {log.output_tokens ?? 0}</div>
          </div>
        )
      },
      {
        id: "client-return",
        title: t("logs.timeline.clientReturn") || "返回响应给客户端",
        description: log.success 
          ? (t("logs.timeline.returnSuccess")
              ? t("logs.timeline.returnSuccess").replace("{status}", String(log.status_code))
              : `请求成功，向客户端返回状态码 ${log.status_code}`)
          : (t("logs.timeline.returnFailed")
              ? t("logs.timeline.returnFailed").replace("{status}", String(log.status_code || "ERR"))
              : `请求异常结束，向客户端返回错误状态码 ${log.status_code || "ERR"}`),
        status: log.success ? "success" : "error",
        details: (
          <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <div><strong>{t("logs.table.status") || "最终状态"}:</strong> {log.success ? "Success" : "Failed"} ({log.status_code || "ERR"})</div>
            <div><strong>{t("logs.table.type") || "传输类型"}:</strong> {log.is_streaming ? (t("logs.streaming") || "流式传输") : (t("logs.nonStreaming") || "普通传输")}</div>
          </div>
        )
      }
    ];
  };

  const buildFilter = (): LogFilter | undefined => {
    const f: LogFilter = {};
    if (modelFilter) f.model = modelFilter;
    if (statusFilter === "success") f.success = true;
    if (statusFilter === "failed") f.success = false;
    if (searchText.trim()) f.search_text = searchText.trim();
    if (!modelFilter && statusFilter === "all" && !searchText.trim()) return undefined;
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
  }, [modelFilter, statusFilter, searchText]);

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
        <div className="flex flex-col md:flex-row items-center gap-4 mb-4">
          <div className="flex-1 w-full relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input-field pl-9" placeholder={lang === "zh" ? "模糊全局搜索 (错误信息、请求体、客户端密钥等)..." : "Fuzzy global search (errors, bodies, keys...)"}
              value={searchText} onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
          </div>
          <div className="w-full md:w-56">
            <input className="input-field" placeholder={t("logs.filterModel")}
              value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
          </div>
          <select value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="input-field w-full md:w-36">
            <option value="all">{t("logs.allStatus")}</option>
            <option value="success">{t("logs.success")}</option>
            <option value="failed">{t("logs.failed")}</option>
          </select>
          <button onClick={handleSearch} disabled={loading} className="btn-primary text-sm w-full md:w-auto disabled:opacity-50">{t("logs.search")}</button>
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
                    <th className="table-header">Client</th>
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
                      <td className="table-cell text-xs font-medium text-gray-700 dark:text-gray-300">{log.client_key_name || "Default"}</td>
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
          <div className="fixed z-50 inset-0 lg:inset-auto lg:right-0 lg:top-0 lg:h-full lg:w-[32rem] bg-white dark:bg-gray-900 shadow-2xl overflow-auto border-l border-gray-150 dark:border-gray-800">
            <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("logs.detail")}</h2>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-6">
              <div className="relative border-l-2 border-gray-250 dark:border-gray-700 ml-3 pl-5 space-y-6">
                {getTimelineSteps(selectedLog).map((step) => {
                  const isExpanded = expandedStep === step.id;
                  let icon = <CheckCircle className="w-5 h-5 text-green-500" />;
                  let dotBg = "bg-green-50 dark:bg-green-950/50 ring-green-100 dark:ring-green-900/50";
                  if (step.status === "error") {
                    icon = <XCircle className="w-5 h-5 text-red-500" />;
                    dotBg = "bg-red-50 dark:bg-red-950/50 ring-red-100 dark:ring-red-900/50";
                  } else if (step.status === "skipped") {
                    icon = <AlertCircle className="w-5 h-5 text-gray-400" />;
                    dotBg = "bg-gray-50 dark:bg-gray-800 ring-gray-100 dark:ring-gray-900/50";
                  }

                  return (
                    <div key={step.id} className="relative group pl-2">
                      {/* Step Indicator Dot */}
                      <span className={`absolute -left-[31px] top-0.5 rounded-full p-0.5 ring-4 ${dotBg} bg-white dark:bg-gray-900 z-10 flex items-center justify-center transition-all duration-200 group-hover:scale-110`}>
                        {icon}
                      </span>
                      
                      {/* Step Card */}
                      <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">
                        {/* Header (Clickable to Toggle) */}
                        <div 
                          onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                          className="px-4 py-3 flex items-start justify-between gap-3 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-850/30 transition-colors"
                        >
                          <div className="space-y-0.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                {step.title}
                              </h3>
                              {step.time && (
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono shrink-0 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                                  {step.time}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate pr-2">
                              {step.description}
                            </p>
                          </div>
                          
                          <div className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </div>

                        {/* Collapsible Details */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-900/40 text-xs">
                            {step.details}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
