import { Sun, Moon, Monitor } from "lucide-react";
import { useConfigStore } from "../store/configStore";

const themes = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
] as const;

export function ThemeToggle() {
  const config = useConfigStore((s) => s.config);
  const saveConfig = useConfigStore((s) => s.saveConfig);

  const current = config?.theme || "system";

  const cycle = async () => {
    if (!config) return;
    const idx = themes.findIndex((t) => t.value === current);
    const next = themes[(idx + 1) % themes.length].value;
    await saveConfig({ ...config, theme: next });
  };

  const Icon = themes.find((t) => t.value === current)?.icon || Monitor;

  return (
    <button
      onClick={cycle}
      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      title={`Theme: ${current}`}
    >
      <Icon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
    </button>
  );
}
