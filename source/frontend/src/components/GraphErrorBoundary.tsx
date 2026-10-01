import { Component, type ErrorInfo, type ReactNode } from "react";

type GraphErrorBoundaryProps = {
  children: ReactNode;
};

type GraphErrorBoundaryState = {
  error: Error | null;
};

export class GraphErrorBoundary extends Component<
  GraphErrorBoundaryProps,
  GraphErrorBoundaryState
> {
  state: GraphErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): GraphErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("3D graph unavailable", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="graph-stage graph-fallback" aria-label="Knowledge graph fallback">
          <p className="graph-empty">The 3D graph is unavailable. Search results remain usable.</p>
        </section>
      );
    }
    return this.props.children;
  }
}
