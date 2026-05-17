"use client";

import { useEffect, useState } from "react";

export type PlotlyTemplate = "plotly_white" | "plotly_dark";

function readTheme(): PlotlyTemplate {
  if (typeof document === "undefined") return "plotly_white";
  return document.documentElement.classList.contains("dark")
    ? "plotly_dark"
    : "plotly_white";
}

export function usePlotlyTheme(): PlotlyTemplate {
  const [template, setTemplate] = useState<PlotlyTemplate>(readTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTemplate(readTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  return template;
}
