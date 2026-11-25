/* global maplibregl */
import { gridToGeoJSON, bounds, resolutionLabel } from "./eea.js";

// Zoom level at which the map switches from the 10 km to the 1 km grid.
const FINE_ZOOM = 8;

const RAMPS = {
  alien: ["#ffffb2", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#b10026"],
  invasive: ["#feebe2", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177"],
  richness: ["#ffffcc", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#0c2c84"],
  effort: ["#f2f0f7", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"],
  // Year of first record: old = dark, recent = bright (viridis)
  years: ["#440154", "#46327e", "#365c8d", "#277f8e", "#1fa187", "#4ac16d", "#a0da39", "#fde725"],
};

export const LAYERS = {
  alien_richness: {
    label: "Alien species (checklist)",
    unit: "alien species",
    ramp: RAMPS.alien,
    help: "Number of species of the GRIIS checklist recorded in the cell.",
  },
  alien_occurrences: {
    label: "Alien species occurrences",
    unit: "occurrences of alien species",
    ramp: RAMPS.alien,
    help: "Number of occurrences of checklist species in the cell.",
  },
  invasive_richness: {
    label: "Invasive species",
    unit: "invasive species",
    ramp: RAMPS.invasive,
    help: "Number of checklist species assessed as invasive recorded in the cell.",
  },
  invasive_occurrences: {
    label: "Invasive species occurrences",
    unit: "occurrences of invasive species",
    ramp: RAMPS.invasive,
    help: "Number of occurrences of invasive species in the cell.",
  },
  richness: {
    label: "All species",
    unit: "species",
    ramp: RAMPS.richness,
    help: "Observed species richness: number of species recorded in the cell (all taxa).",
  },
  observers: {
    label: "Sampling effort: observers",
    unit: "observers (summed per species and month)",
    ramp: RAMPS.effort,
    help: "Sum of the distinct observers per species and month: a proxy for sampling effort.",
  },
  occurrences: {
    label: "Sampling effort: occurrences",
    unit: "occurrences",
    ramp: RAMPS.effort,
    help: "Total number of GBIF occurrences in the cell (all taxa).",
  },
};

// Place names drawn above the grid (keyless Esri reference layer).
const LABELS = {
  tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
  attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
};

export const BASEMAPS = {
  light: {
    label: "Light grey (Esri)",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    maxzoom: 16,
  },
  osm: {
    label: "OpenStreetMap",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    label: "Satellite (Esri)",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
};

const SPECIES_FIELDS = ["e", "n", "occurrences", "first_year"];

function baseStyle(active) {
  const sources = {};
  const layers = [];
  for (const [id, b] of Object.entries(BASEMAPS)) {
    sources[`base-${id}`] = { type: "raster", tiles: b.tiles, tileSize: 256, attribution: b.attribution, maxzoom: b.maxzoom ?? 19 };
    layers.push({
      id: `base-${id}`, type: "raster", source: `base-${id}`,
      layout: { visibility: id === active ? "visible" : "none" },
    });
  }
  sources.labels = { type: "raster", tiles: LABELS.tiles, tileSize: 256, maxzoom: 16, attribution: LABELS.attribution };
  return { version: 8, sources, layers };
}

function logColor(field, max, ramp) {
  const top = Math.log10(1 + Math.max(max, 1));
  const stops = [];
  ramp.forEach((c, i) => stops.push((top * i) / (ramp.length - 1), c));
  return ["interpolate", ["linear"], ["log10", ["+", 1, ["to-number", ["get", field], 0]]], ...stops];
}

function yearColor(minYear, maxYear, ramp) {
  if (maxYear <= minYear) return ramp[ramp.length - 1];
  const stops = [];
  ramp.forEach((c, i) => stops.push(minYear + ((maxYear - minYear) * i) / (ramp.length - 1), c));
  return ["interpolate", ["linear"], ["get", "first_year"], ...stops];
}

function format(v) {
  return v == null ? "–" : Number(v).toLocaleString("en-GB");
}

const EMPTY = { type: "FeatureCollection", features: [] };

/** Aggregate per-species 1 km rows [e, n, occurrences, first_year] to a coarser grid. */
function aggregateSpecies(rows, fromRes, toRes) {
  const f = toRes / fromRes;
  const cells = new Map();
  for (const [e, n, occ, year] of rows) {
    const ce = Math.floor(e / f);
    const cn = Math.floor(n / f);
    const key = ce * 1e7 + cn;
    const c = cells.get(key);
    if (c) {
      c[2] += occ;
      c[3] = Math.min(c[3], year);
    } else {
      cells.set(key, [ce, cn, occ, year]);
    }
  }
  return [...cells.values()];
}

export class GridMap {
  /**
   * @param {HTMLElement} container
   * @param {object} opts {coarse: grid json, loadFine: () => Promise<grid json>, layer, basemap, onResolution}
   */
  constructor(container, opts) {
    this.opts = opts;
    this.field = opts.layer in LAYERS ? opts.layer : "alien_richness";
    this.basemap = opts.basemap in BASEMAPS ? opts.basemap : "light";
    this.opacity = 0.8;
    this.mode = "grid";       // "grid" or "species"
    this.species = null;      // {key, name, coarse, fine, colorBy, upToYear, minYear, maxYear}
    this.grids = { coarse: opts.coarse, fine: null };
    this.coarseGeo = gridToGeoJSON(opts.coarse);

    this.map = new maplibregl.Map({
      container,
      style: baseStyle(this.basemap),
      bounds: bounds(this.coarseGeo),
      fitBoundsOptions: { padding: 20 },
      maxZoom: 16,
      hash: opts.hash ?? false,  // #zoom/lat/lon in the URL: shareable and embeddable views
      attributionControl: { compact: true },
      cooperativeGestures: opts.cooperativeGestures ?? false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    this.map.addControl(new maplibregl.FullscreenControl(), "top-right");
    this.map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "280px" });
    this.ready = new Promise((resolve) => this.map.on("load", () => { this._init(); resolve(); }));
  }

  _addLayer(id, geojson, minzoom, maxzoom) {
    const m = this.map;
    m.addSource(id, { type: "geojson", data: geojson, tolerance: 0.05, buffer: 16 });
    m.addLayer({
      id: `${id}-fill`, type: "fill", source: id, minzoom, maxzoom,
      paint: { "fill-color": "#000", "fill-opacity": this.opacity, "fill-antialias": false },
    }, "labels");
    m.on("mousemove", `${id}-fill`, (e) => this._hover(e));
    m.on("mouseleave", `${id}-fill`, () => this._unhover());
  }

  _init() {
    const m = this.map;
    m.addLayer({ id: "labels", type: "raster", source: "labels" });
    this._addLayer("coarse", this.coarseGeo, 0, 24);
    this._addLayer("sp-coarse", EMPTY, 0, FINE_ZOOM);
    this._addLayer("sp-fine", EMPTY, FINE_ZOOM, 24);
    m.addSource("highlight", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "highlight", type: "line", source: "highlight", paint: { "line-color": "#111", "line-width": 2 } });
    this._style();
    m.on("zoomend", () => this._changed());
    this._changed();

    // Load the 1 km grid in the background, after the first render.
    if (this.opts.loadFine) {
      this.opts.loadFine().then((fine) => {
        this.grids.fine = fine;
        this._addLayer("fine", gridToGeoJSON(fine), FINE_ZOOM, 24);
        m.setLayerZoomRange("coarse-fill", 0, FINE_ZOOM);
        this._style();
        this._changed();
      }).catch((err) => console.error("Could not load the fine grid", err));
    }
  }

  _setVisible(id, visible) {
    if (this.map.getLayer(`${id}-fill`)) {
      this.map.setLayoutProperty(`${id}-fill`, "visibility", visible ? "visible" : "none");
    }
  }

  _style() {
    const m = this.map;
    const gridMode = this.mode === "grid";
    for (const id of ["coarse", "fine"]) this._setVisible(id, gridMode);
    for (const id of ["sp-coarse", "sp-fine"]) this._setVisible(id, !gridMode);

    if (gridMode) {
      const cfg = LAYERS[this.field];
      for (const id of ["coarse", "fine"]) {
        if (!m.getLayer(`${id}-fill`)) continue;
        const max = this.grids[id].max[this.field];
        m.setPaintProperty(`${id}-fill`, "fill-color", logColor(this.field, max, cfg.ramp));
        m.setPaintProperty(`${id}-fill`, "fill-opacity", this.opacity);
        m.setFilter(`${id}-fill`, [">", ["to-number", ["get", this.field], 0], 0]);
      }
      return;
    }

    const sp = this.species;
    for (const id of ["sp-coarse", "sp-fine"]) {
      const data = id === "sp-coarse" ? sp.coarse : sp.fine;
      const color = sp.colorBy === "year"
        ? yearColor(sp.minYear, sp.maxYear, RAMPS.years)
        : logColor("occurrences", data.max, RAMPS.invasive);
      m.setPaintProperty(`${id}-fill`, "fill-color", color);
      m.setPaintProperty(`${id}-fill`, "fill-opacity", Math.max(this.opacity, 0.85));
      m.setFilter(`${id}-fill`, ["<=", ["get", "first_year"], sp.upToYear]);
    }
  }

  _changed() {
    if (!this.opts.onResolution) return;
    const fineZoom = this.map.getZoom() >= FINE_ZOOM;
    if (this.mode === "species") {
      const sp = this.species;
      const data = fineZoom ? sp.fine : sp.coarse;
      this.opts.onResolution({
        mode: "species",
        title: sp.name,
        colorBy: sp.colorBy,
        ramp: sp.colorBy === "year" ? RAMPS.years : RAMPS.invasive,
        max: data.max,
        minYear: sp.minYear,
        maxYear: sp.maxYear,
        upToYear: sp.upToYear,
        label: resolutionLabel(data.resolution).replace("km", " km"),
        fineZoom: FINE_ZOOM,
        fineAvailable: true,
      });
      return;
    }
    const grid = fineZoom && this.grids.fine ? this.grids.fine : this.grids.coarse;
    this.opts.onResolution({
      mode: "grid",
      title: LAYERS[this.field].label,
      unit: LAYERS[this.field].unit,
      ramp: LAYERS[this.field].ramp,
      max: grid.max[this.field],
      label: resolutionLabel(grid.resolution).replace("km", " km"),
      fineAvailable: Boolean(this.grids.fine),
      fineZoom: FINE_ZOOM,
    });
  }

  _hover(e) {
    const f = e.features && e.features[0];
    if (!f) return;
    this.map.getCanvas().style.cursor = "crosshair";
    this.map.getSource("highlight").setData({ type: "FeatureCollection", features: [f] });
    const p = f.properties;
    let rows;
    if (this.mode === "species") {
      rows = `<tr class="active"><th>Occurrences</th><td>${format(p.occurrences)}</td></tr>
              <tr><th>First record in this cell</th><td>${p.first_year}</td></tr>`;
    } else {
      rows = Object.entries(LAYERS)
        .map(([k, c]) => `<tr${k === this.field ? ' class="active"' : ""}><th>${c.label}</th><td>${format(p[k])}</td></tr>`)
        .join("");
    }
    const title = this.mode === "species" ? `<div class="popup-species">${this.species.name}</div>` : "";
    this.popup.setLngLat(e.lngLat)
      .setHTML(`<div class="popup">${title}<div class="popup-code">${p.code}</div><table>${rows}</table></div>`)
      .addTo(this.map);
  }

  _unhover() {
    this.map.getCanvas().style.cursor = "";
    this.map.getSource("highlight").setData(EMPTY);
    this.popup.remove();
  }

  /** Show one of the grid layers (see LAYERS). */
  setLayer(field) {
    this.mode = "grid";
    this.field = field;
    this._style();
    this._changed();
  }

  /**
   * Show the distribution of one species.
   * @param {object} entry {name, rows: [[e, n, occurrences, first_year], ...]} on the 1 km grid
   * @param {number} resolution resolution of the rows (metres)
   */
  setSpecies(key, entry, resolution, { colorBy = "occurrences", upToYear = null } = {}) {
    const coarseRes = Math.max(resolution, 10000);
    const coarseRows = aggregateSpecies(entry.rows, resolution, coarseRes);
    const toGeo = (rows, res) => gridToGeoJSON({ resolution: res, fields: SPECIES_FIELDS, rows });
    const maxOcc = (rows) => rows.reduce((m, r) => Math.max(m, r[2]), 0);
    const years = entry.rows.map((r) => r[3]);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    this.species = {
      key,
      name: entry.name,
      colorBy,
      minYear,
      maxYear,
      upToYear: upToYear ?? maxYear,
      coarse: { resolution: coarseRes, max: maxOcc(coarseRows) },
      fine: { resolution, max: maxOcc(entry.rows) },
    };
    this.map.getSource("sp-coarse").setData(toGeo(coarseRows, coarseRes));
    this.map.getSource("sp-fine").setData(toGeo(entry.rows, resolution));
    this.mode = "species";
    this._style();
    this._changed();
    return { minYear, maxYear };
  }

  setSpeciesOptions({ colorBy, upToYear }) {
    if (!this.species) return;
    if (colorBy) this.species.colorBy = colorBy;
    if (upToYear != null) this.species.upToYear = upToYear;
    this._style();
    this._changed();
  }

  setBasemap(id) {
    this.basemap = id;
    for (const b of Object.keys(BASEMAPS)) {
      this.map.setLayoutProperty(`base-${b}`, "visibility", b === id ? "visible" : "none");
    }
  }

  setOpacity(value) {
    this.opacity = value;
    this._style();
  }
}

/** Render the legend for the active layer (log scale, or years for a species). */
export function renderLegend(el, info) {
  const gradient = `linear-gradient(to right, ${info.ramp.join(", ")})`;
  let unit;
  let tickHtml;
  if (info.mode === "species" && info.colorBy === "year") {
    unit = "year of first record in the cell";
    const span = Math.max(1, info.maxYear - info.minYear);
    const ticks = [info.minYear, Math.round((info.minYear + info.maxYear) / 2), info.maxYear];
    tickHtml = [...new Set(ticks)]
      .map((t) => `<span style="left:${((t - info.minYear) / span) * 100}%">${t}</span>`).join("");
  } else {
    unit = info.mode === "species" ? "occurrences per cell (log scale)" : `${info.unit} per cell (log scale)`;
    const max = info.max;
    const top = Math.log10(1 + Math.max(max, 1));
    const ticks = [];
    for (let p = 0; Math.pow(10, p) <= max; p++) ticks.push(Math.pow(10, p));
    // Drop a power of ten that would overlap the maximum label.
    if (ticks.length && Math.log10(1 + max) - Math.log10(1 + ticks[ticks.length - 1]) < 0.12 * top) ticks.pop();
    ticks.push(max);
    tickHtml = ticks
      .map((t) => `<span style="left:${(Math.log10(1 + t) / top) * 100}%">${t >= 1000 ? `${Math.round(t / 1000)}k` : t}</span>`)
      .join("");
  }
  const res = info.fineAvailable
    ? `Grid: <strong>${info.label}</strong> cells (switches at zoom ${info.fineZoom})`
    : `Grid: <strong>${info.label}</strong> cells (loading 1 km grid…)`;
  const upTo = info.mode === "species" && info.upToYear < info.maxYear
    ? `<div class="legend-res">Cells first recorded up to <strong>${info.upToYear}</strong></div>` : "";
  el.innerHTML = `
    <div class="legend-title">${info.mode === "species" ? `<em>${info.title}</em>` : info.title}</div>
    <div class="legend-unit">${unit}</div>
    <div class="legend-bar" style="background:${gradient}"></div>
    <div class="legend-ticks">${tickHtml}</div>
    ${upTo}
    <div class="legend-res">${res}</div>`;
}
