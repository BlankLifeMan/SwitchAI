import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Boxes,
  ScrollText,
  Settings,
  Power,
  PowerOff,
  Loader2,
  Play,
} from "lucide-react";
import { useEffect } from "react";
import { useGatewayStore } from "../store/gatewayStore";
import { useToastStore } from "../store/toastStore";
import { useI18n } from "../i18n/I18nContext";

export function Sidebar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: "/", label: t("sidebar.dashboard"), icon: LayoutDashboard },
    { path: "/providers", label: t("sidebar.providers"), icon: Server },
    { path: "/models", label: t("sidebar.models"), icon: Boxes },
    { path: "/logs", label: t("sidebar.logs"), icon: ScrollText },
    { path: "/playground", label: t("sidebar.playground"), icon: Play },
    { path: "/settings", label: t("sidebar.settings"), icon: Settings },
  ];

  return (
    <aside className="w-60 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-screen">
      <div className="p-5 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            {t("app.title")}
          </span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-gray-200 dark:border-gray-800">
        <GatewayToggle />
      </div>
    </aside>
  );
}

function GatewayToggle() {
  const { t } = useI18n();
  const status = useGatewayStore((s) => s.status);
  const fetchStatus = useGatewayStore((s) => s.fetchStatus);
  const startGateway = useGatewayStore((s) => s.startGateway);
  const stopGateway = useGatewayStore((s) => s.stopGateway);
  const operating = useGatewayStore((s) => s.operating);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const isRunning = status?.running;
  const address = status ? `http://${status.host}:${status.port}/v1` : "";

  const handleToggle = async () => {
    try {
      if (isRunning) {
        await stopGateway();
      } else {
        await startGateway();
      }
    } catch (e) {
      addToast("error", String(e));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? "bg-green-500" : "bg-gray-400"}`}
        />
        <span className="truncate">
          {isRunning ? address : t("sidebar.gatewayStopped")}
        </span>
      </div>
      <button
        onClick={handleToggle}
        disabled={operating}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isRunning
            ? "bg-red-50 dark:bg-red-950 text-red-600 hover:bg-red-100 dark:hover:bg-red-900"
            : "bg-green-50 dark:bg-green-950 text-green-600 hover:bg-green-100 dark:hover:bg-green-900"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {operating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isRunning ? (
          <PowerOff className="w-4 h-4" />
        ) : (
          <Power className="w-4 h-4" />
        )}
        {operating
          ? "..."
          : isRunning
            ? t("sidebar.stop")
            : t("sidebar.start")}
      </button>
    </div>
  );
}
