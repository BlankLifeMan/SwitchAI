import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onReload }: { error: Error | null; onReload: () => void }) {
  const { t } = useI18n();
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {t("error.title")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t("error.message")}
        </p>
        {error && (
          <details className="mb-6 text-left">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
              {error.message}
            </summary>
            <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs text-gray-600 dark:text-gray-400 overflow-auto max-h-32">
              {error.stack}
            </pre>
          </details>
        )}
        <button
          onClick={onReload}
          className="btn-primary inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          {t("error.reload")}
        </button>
      </div>
    </div>
  );
}

export function ErrorBoundary({ children }: Props) {
  return <ErrorBoundaryInner key="error-boundary">{children}</ErrorBoundaryInner>;
}
