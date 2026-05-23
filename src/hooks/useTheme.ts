import { useEffect } from "react";
import { useConfigStore } from "../store/configStore";

export function useTheme() {
  const config = useConfigStore((s) => s.config);

  useEffect(() => {
    const theme = config?.theme || "system";
    const root = document.documentElement;

    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
      };
      if (media.matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
  }, [config?.theme]);
}
