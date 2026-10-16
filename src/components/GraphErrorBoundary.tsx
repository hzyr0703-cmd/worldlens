"use client";

import React from "react";

/** 图谱渲染错误边界：任何 JS 异常都显示具体错误，而不是白屏 */
export default class GraphErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[GraphCanvas] render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty">
          <p className="text-[15px] font-medium">图谱渲染出错</p>
          <p className="mono mt-3 max-w-[60ch] mx-auto text-left text-[12px] leading-relaxed text-red-600 break-all">
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="btn-solid mt-6"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
