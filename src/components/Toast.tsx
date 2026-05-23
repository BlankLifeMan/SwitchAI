import { useToastStore } from "../store/toastStore";
import { CheckCircle, XCircle, Info, X } from "lucide-react";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border animate-slide-in ${
            toast.type === "success"
              ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
              : toast.type === "error"
                ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
                : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
          ) : toast.type === "error" ? (
            <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          )}
          <p className="text-sm flex-1 text-gray-800 dark:text-gray-200">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
