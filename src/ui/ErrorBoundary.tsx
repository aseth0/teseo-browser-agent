import { Component, type ReactNode } from 'react';

// If rendering fails, show the error instead of leaving the panel blank.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('[ui] render error', error);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <strong>The interface crashed</strong>
        <pre>{error.message}{'\n\n'}{error.stack}</pre>
        <button onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
