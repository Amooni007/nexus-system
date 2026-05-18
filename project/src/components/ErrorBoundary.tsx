// src/components/ErrorBoundary.tsx
// RISK-04 FIX: Wrap the app in an ErrorBoundary so unhandled component errors
// show a recovery screen instead of a blank white page.
// React error boundaries MUST be class components — hooks cannot catch render errors.

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production: send to Sentry / LogRocket
    console.error('[Nexus ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="w-full max-w-md text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle size={32} className="text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                An unexpected error occurred. Your data is safe — please refresh to continue.
              </p>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <pre className="mt-3 text-left text-xs text-red-400 bg-red-950/40 border border-red-500/20 rounded-xl p-3 overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              )}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
              <RefreshCw size={15} /> Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}