import { Component, type ReactNode } from 'react';

/** Shows what went wrong (and ways to recover) instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const reset = (window as unknown as { __pilotResetAppFiles?: () => void }).__pilotResetAppFiles;
    return (
      <main className="page" role="alert">
        <div className="page-head">
          <h1>Something went wrong</h1>
        </div>
        <div className="stack">
          <p className="muted">Your data is safe. Try reloading; if that doesn’t help, reset the app files (this keeps your check-ins).</p>
          <pre className="error-details">{`${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(0, 6).join('\n')}`}</pre>
          <button type="button" className="button primary" onClick={() => location.reload()}>Reload</button>
          {reset && (
            <button type="button" className="button" onClick={reset}>Reset app files</button>
          )}
        </div>
      </main>
    );
  }
}
