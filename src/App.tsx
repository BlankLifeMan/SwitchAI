import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Dashboard } from "./pages/Dashboard";
import { Providers } from "./pages/Providers";
import { Models } from "./pages/Models";
import { Logs } from "./pages/Logs";
import { Settings } from "./pages/Settings";
import { ToastContainer } from "./components/Toast";
import { useTheme } from "./hooks/useTheme";
import { I18nProvider } from "./i18n/I18nContext";
import { useConfigStore } from "./store/configStore";

export default function App() {
  useTheme();
  const fetchConfig = useConfigStore((s) => s.fetchConfig);

  useEffect(() => {
    fetchConfig();
  }, []);

  return (
    <I18nProvider>
      <ErrorBoundary>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/models" element={<Models />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
        <ToastContainer />
      </ErrorBoundary>
    </I18nProvider>
  );
}
