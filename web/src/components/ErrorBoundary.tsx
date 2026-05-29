// Top-level error boundary. Without this, an uncaught error during render
// unmounts the entire React tree to a blank page with no in-app feedback —
// and the user has to refresh + open DevTools to find out what broke. With
// this in place, the same crash now shows an error panel with the message
// and stack, plus a "Reload" button.
import { Component, type ErrorInfo, type ReactNode } from 'react';

type State = { error: Error | null; info: ErrorInfo | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep both in state so the panel can show stack + componentStack.
    this.setState({ error, info });
    // Re-log so it still appears in the browser console.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 880, margin: '40px auto' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong.</h1>
        <p style={{ color: '#475569', marginBottom: 16 }}>
          The page crashed while rendering. The details below help diagnose; reload to try again.
        </p>
        <pre style={{
          background: '#0f172a', color: '#fef2f2', padding: 12, borderRadius: 6,
          overflowX: 'auto', fontSize: 12, lineHeight: 1.5,
        }}>
{String(this.state.error?.message)}
{this.state.error?.stack ? '\n\n' + this.state.error.stack : ''}
{this.state.info?.componentStack ? '\n\nComponent stack:' + this.state.info.componentStack : ''}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16, padding: '8px 16px', background: '#4f46e5', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
