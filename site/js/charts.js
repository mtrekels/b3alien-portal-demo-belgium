/* global Plotly */

const COLORS = {
  observed: "#1f2933",
  fit: "#c2410c",
  band: "rgba(194, 65, 12, 0.18)",
  bars: "#f59e0b",
  barsOut: "#d6d3d1",
  observers: "#6a51a3",
  occurrences: "#0c7c8c",
  window: "rgba(15, 23, 42, 0.05)",
};

const FONT = { family: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif", size: 13, color: "#334155" };

function layout(extra) {
  return {
    font: FONT,
    margin: { l: 64, r: 24, t: 48, b: 48 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    hovermode: "x unified",
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", font: { size: 12 } },
    xaxis: { gridcolor: "#e2e8f0", zeroline: false },
    yaxis: { gridcolor: "#e2e8f0", zeroline: false },
    ...extra,
  };
}

function config(filename) {
  return {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
    toImageButtonOptions: { format: "png", filename, scale: 2 },
  };
}

function band(x, lower, upper, name, color) {
  return [
    { x, y: upper, mode: "lines", line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    {
      x, y: lower, mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: color,
      name, hoverinfo: "skip",
    },
  ];
}

/**
 * Cumulative discoveries with the Solow-Costello fit and bootstrap 95% CI.
 * `ts` is one subset of timeseries.json plus `window` and `noun` (e.g. "alien species").
 * Without bootstrap results (too few discoveries), the plain model fit is shown.
 */
export function plotCumulative(el, ts) {
  const x = ts.years;
  const b = ts.bootstrap ? ts.bootstrap.cumulative : null;
  const traces = [
    ...(b ? band(x, b.lower, b.upper, "95% confidence interval (bootstrap)", COLORS.band) : []),
    {
      x, y: b ? b.mean : ts.fit.cumulative,
      name: b ? "Solow-Costello model (bootstrap mean)" : "Solow-Costello model", mode: "lines",
      line: { color: COLORS.fit, width: 2.5, dash: "dash" },
      hovertemplate: "%{y:.0f}",
    },
    {
      x, y: ts.cumulative, name: "Observed first records", mode: "lines+markers",
      line: { color: COLORS.observed, width: 2 }, marker: { size: 4 },
      hovertemplate: "%{y:.0f}",
    },
  ];
  Plotly.react(el, traces, layout({
    yaxis: { title: `Cumulative number of ${ts.noun}`, gridcolor: "#e2e8f0", rangemode: "tozero" },
    xaxis: { title: "Year", gridcolor: "#e2e8f0" },
  }), config("cumulative_discoveries"));
}

/** New species per year (bars) with the fitted annual rate. */
export function plotAnnual(el, ts) {
  const [start, end] = ts.window;
  const all = ts.all_years;
  const inWindow = all.years.map((y) => y >= start && y <= end);
  const b = ts.bootstrap ? ts.bootstrap.annual : null;
  const fitted = b ? b.mean : ts.fit.annual;
  const traces = [
    {
      x: all.years.filter((_, i) => inWindow[i]), y: all.discoveries.filter((_, i) => inWindow[i]),
      type: "bar", name: `New ${ts.noun} first recorded`, marker: { color: COLORS.bars },
      hovertemplate: "%{y:.0f}<extra>first recorded</extra>",
    },
    {
      x: all.years.filter((_, i) => !inWindow[i]), y: all.discoveries.filter((_, i) => !inWindow[i]),
      type: "bar", name: "Outside the analysis window", marker: { color: COLORS.barsOut },
      hovertemplate: "%{y:.0f}<extra>first recorded</extra>", visible: "legendonly",
    },
    ...(b ? band(ts.years, b.lower, b.upper, "95% confidence interval (bootstrap)", COLORS.band) : []),
    {
      x: ts.years, y: fitted, name: "Fitted rate of establishment", mode: "lines",
      line: { color: COLORS.fit, width: 2.5 }, hovertemplate: "%{y:.1f} per year<extra>fitted</extra>",
    },
  ];
  // Scale the y-axis to the analysis window (early years can have many first records).
  const yMax = Math.max(1, ...all.discoveries.filter((_, i) => inWindow[i]), ...(b ? b.upper : fitted)) * 1.1;
  Plotly.react(el, traces, layout({
    bargap: 0.15,
    yaxis: { title: "Species per year", gridcolor: "#e2e8f0", range: [0, yMax] },
    xaxis: { title: "Year", gridcolor: "#e2e8f0", range: [start - 0.5, end + 0.5] },
  }), config("annual_rate"));
}

/** Sampling effort over time (log scale), with the analysis window shaded. */
export function plotEffort(el, ts) {
  const e = ts.effort;
  const [start, end] = ts.window;
  const traces = [
    {
      x: e.years, y: e.distinct_observers, name: "Observers (summed per species and month)", mode: "lines",
      line: { color: COLORS.observers, width: 2 }, hovertemplate: "%{y:,.0f}",
    },
    {
      x: e.years, y: e.occurrences, name: "Occurrences (all taxa)", mode: "lines",
      line: { color: COLORS.occurrences, width: 2 }, hovertemplate: "%{y:,.0f}",
    },
  ];
  Plotly.newPlot(el, traces, layout({
    yaxis: { title: "Sampling effort (log scale)", type: "log", dtick: 1, gridcolor: "#e2e8f0" },  // one label per factor 10
    // The last year of the cube is usually incomplete: end the default view one year earlier.
    xaxis: { title: "Year", gridcolor: "#e2e8f0", range: [1950, e.years[e.years.length - 1] - 1] },
    shapes: [{
      type: "rect", xref: "x", yref: "paper", x0: start, x1: end, y0: 0, y1: 1,
      fillcolor: COLORS.window, line: { width: 0 }, layer: "below",
    }],
    annotations: [{
      x: (start + end) / 2, y: 0.98, xref: "x", yref: "paper", yanchor: "top", showarrow: false,
      text: `analysis window ${start}–${end}`, font: { size: 11, color: "#64748b" },
    }],
  }), config("sampling_effort"));
}
