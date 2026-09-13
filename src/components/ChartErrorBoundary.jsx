import {Component} from "react";

export default class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="hybrid-plot-error" role="alert">
        <p>{this.props.message || "Chart failed to render."}</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          {this.props.retryLabel || "Reload chart"}
        </button>
      </div>
    );
  }
}
