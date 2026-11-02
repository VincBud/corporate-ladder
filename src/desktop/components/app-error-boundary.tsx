"use client";

import { Component, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  appTitle: string;
  children: ReactNode;
}

/**
 * Contains a crash to the app's own window, so one failing app never blanks
 * the whole desktop. Verified progress lives on the server and is unaffected.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[${this.props.appTitle}] crashed`, error);
  }

  render() {
    if (!this.state.failed) return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
    return (
      <div role="alert" className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm font-semibold">{this.props.appTitle} stopped working.</p>
          <p className="mt-1 text-xs text-fg-muted">
            Something unexpected happened in this window. Verified progress is saved on the server. Try again, or close the window and open it again.
          </p>
          <button
            type="button"
            onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}
            className="mt-4 rounded-lg bg-accent-strong px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
