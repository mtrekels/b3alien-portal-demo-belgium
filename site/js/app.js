import { GridMap, LAYERS, BASEMAPS, renderLegend } from "./map.js";
import { plotCumulative, plotAnnual, plotEffort } from "./charts.js";
import { SpeciesTable } from "./species.js";

const DATA = "data/";
const params = new URLSearchParams(location.search);
const embed = params.get("embed");

const SUBSETS = {
  all: { noun: "alien species", label: "all alien species" },
  invasive: { noun: "invasive species", label: "invasive species only" },
};
let subset = params.get("subset") in SUBSETS ? params.get("subset") : "all";

const fmt = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }));
const signed = (v, d = 1) => (v == null ? "–" : `${v > 0 ? "+" : ""}${fmt(v, d)}`);

async function getJson(name) {
  const r = await fetch(DATA + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

function setText(sel, text) {
  document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
}

/** Keep the URL in sync with the UI state (without reloading; the map hash is preserved). */
function updateUrl(changes) {
  const url = new URL(location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === "") url.searchParams.delete(k); else url.searchParams.set(k, v);
  }
  history.replaceState(null, "", url);
}

// ---------------------------------------------------------------------------
// Indicator cards and trend charts (per subset)
// ---------------------------------------------------------------------------

function renderIndicators(summary) {
  const ind = summary.indicators[subset];
  const cl = summary.checklist;
  const [start, end] = summary.window;
  const noun = SUBSETS[subset].noun;
  const invasive = subset === "invasive";
  const rateCi = ind.fitted_rate_last_year_ci || [];
  const trendCi = ind.annual_change_pct_ci;
  const cards = [
    invasive ? {
      value: fmt(cl.invasive),
      label: "Invasive species on the national checklist",
      sub: `of ${fmt(cl.species)} alien species (assessed as invasive in the checklist)`,
    } : {
      value: fmt(cl.species),
      label: "Alien species on the national checklist",
      sub: `${fmt(cl.records)} checklist taxa; ${fmt(cl.unmatched)} names not matched to the GBIF backbone`,
    },
    {
      value: fmt(ind.observed),
      label: "Recorded in GBIF occurrence data",
      sub: invasive
        ? `${fmt((100 * ind.observed) / Math.max(1, cl.invasive))}% of the invasive species on the checklist`
        : `${fmt(cl.invasive_observed)} of them assessed as invasive`,
    },
    {
      value: fmt(ind.discoveries_in_window),
      label: `New ${noun} ${start}–${end}`,
      sub: "first records in the occurrence cube",
    },
    {
      value: `${fmt(ind.fitted_rate_last_year, 1)}<small> /yr</small>`,
      label: `Fitted rate of establishment in ${end}`,
      sub: rateCi[0] != null
        ? `95% CI ${fmt(rateCi[0], 1)} – ${fmt(rateCi[1], 1)} species per year`
        : "no bootstrap interval (too few discoveries)",
    },
    {
      value: `${signed(ind.annual_change_pct)}<small> %/yr</small>`,
      label: "Trend in the rate of establishment",
      sub: trendCi
        ? `95% CI ${signed(trendCi[0])} to ${signed(trendCi[1])} % (β₁ = ${fmt(ind.beta1, 4)})`
        : `β₁ = ${fmt(ind.beta1, 4)}; no bootstrap interval`,
      accent: !trendCi ? "" : trendCi[0] > 0 ? "up" : trendCi[1] < 0 ? "down" : "",
    },
  ];
  document.getElementById("indicator-cards").innerHTML = cards.map((c) => `
    <div class="kpi ${c.accent ? `kpi-${c.accent}` : ""}">
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join("");
  setText("[data-subset-note]", invasive
    ? `Only the ${fmt(cl.invasive)} checklist species assessed as invasive are included` +
      `${cl.invasive_definition ? ` (${cl.invasive_definition})` : ""}. With fewer species, the uncertainty is larger.`
    : `All ${fmt(cl.species)} alien species of the national checklist are included.`);
}

function subsetSeries(ts) {
  return { ...ts.subsets[subset], window: ts.window, noun: SUBSETS[subset].noun };
}

function renderTrends(ts, show) {
  const series = subsetSeries(ts);
  if (show("cumulative")) plotCumulative(document.getElementById("chart-cumulative"), series);
  if (show("annual")) plotAnnual(document.getElementById("chart-annual"), series);
}

function initSubsetSwitches(onChange) {
  const buttons = document.querySelectorAll(".subset-switch button");
  const sync = () => {
    buttons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.subset === subset)));
    setText("[data-subset-label]", SUBSETS[subset].label);
  };
  buttons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.subset === subset) return;
    subset = b.dataset.subset;
    updateUrl({ subset: subset === "all" ? null : subset });
    sync();
    onChange();
  }));
  sync();
}

// ---------------------------------------------------------------------------
// Sources and embed snippets
// ---------------------------------------------------------------------------

function renderSources(summary) {
  const { cube, checklist, backbone } = summary.sources;
  const link = (doi) => (doi ? `<a href="https://doi.org/${doi}">https://doi.org/${doi}</a>` : "");
  const cubeCitation = cube.citation ? cube.citation.replace(`https://doi.org/${cube.doi}`, link(cube.doi)) : link(cube.doi);
  const clCitation = checklist.citation ? checklist.citation.replace(`https://doi.org/${checklist.doi}`, link(checklist.doi)) : "";
  document.getElementById("sources").innerHTML = `
    <li><strong>Occurrence data.</strong> ${cubeCitation}.
      ${cube.license ? `Licensed under <a href="${cube.license_url}">${cube.license}</a>.` : ""}
      ${fmt(summary.cube.records)} cube records on the ${summary.cube.grid} (${fmt(summary.cube.resolution_m / 1000)} km),
      ${summary.cube.period[0]} – ${summary.cube.period[1]}.</li>
    <li><strong>Checklist.</strong> ${clCitation}</li>
    <li><strong>Taxonomy.</strong> ${backbone}.</li>
    <li><strong>Software.</strong> b3alien ${summary.b3alien_version}
      (<a href="https://github.com/mtrekels/b3alien">github.com/mtrekels/b3alien</a>), data generated on ${summary.generated}.</li>`;
}

function renderEmbedSnippets(exampleSpecies) {
  const base = location.href.split(/[?#]/)[0];
  const snippets = [
    ["Interactive map", `${base}?embed=map&layer=alien_richness`, 520],
    ["Invasive species map", `${base}?embed=map&layer=invasive_richness`, 520],
    ["Rate of establishment (invasive species)", `${base}?embed=annual&subset=invasive`, 420],
    ["Headline indicator", `${base}?embed=indicators`, 260],
  ];
  if (exampleSpecies) {
    snippets.splice(2, 0, [`Spread of ${exampleSpecies.name}`,
      `${base}?embed=map&layer=species&species=${exampleSpecies.key}&color=year`, 520]);
  }
  document.getElementById("embed-snippets").innerHTML = snippets.map(([title, url, h]) => `
    <div class="snippet">
      <div class="snippet-head"><span>${title}</span><a href="${url}" target="_blank" rel="noopener">open</a></div>
      <pre><code>${`<iframe src="${url}"\n        width="100%" height="${h}" style="border:0" loading="lazy"\n        title="${title}"></iframe>`.replace(/</g, "&lt;")}</code></pre>
    </div>`).join("");
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function initMap(coarse) {
  const $ = (id) => document.getElementById(id);
  const layerSelect = $("layer-select");
  const basemapSelect = $("basemap-select");
  const legend = $("legend");
  const help = $("layer-help");
  const speciesControls = $("species-controls");
  const speciesSelect = $("species-select");
  const colorSelect = $("color-select");
  const yearSlider = $("year-slider");
  const yearOutput = $("year-output");
  const playButton = $("year-play");

  layerSelect.innerHTML =
    Object.entries(LAYERS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join("") +
    `<option value="species">One invasive species…</option>`;
  basemapSelect.innerHTML = Object.entries(BASEMAPS).map(([k, b]) => `<option value="${k}">${b.label}</option>`).join("");

  const requested = params.get("layer");
  const layer = requested in LAYERS || requested === "species" ? requested : "alien_richness";
  const basemap = params.get("basemap") in BASEMAPS ? params.get("basemap") : "light";
  layerSelect.value = layer;
  basemapSelect.value = basemap;

  const map = new GridMap($("map"), {
    coarse,
    loadFine: () => getJson("grid_1km.json"),
    layer: layer === "species" ? "invasive_richness" : layer,
    basemap,
    cooperativeGestures: !embed,
    hash: true,
    onResolution: (info) => renderLegend(legend, info),
  });

  // --- single species mode
  let cells = null;
  let timer = null;
  const loadCells = async () => {
    if (!cells) {
      cells = await getJson("invasive_species_cells.json");
      const entries = Object.entries(cells.species).sort((a, b) => b[1].occurrences - a[1].occurrences);
      speciesSelect.innerHTML = entries
        .map(([k, s]) => `<option value="${k}">${s.name} (${fmt(s.cells)} km²)</option>`).join("");
    }
    return cells;
  };

  const stop = () => {
    clearInterval(timer);
    timer = null;
    playButton.textContent = "▶ Play";
  };

  const setYear = (year) => {
    yearSlider.value = year;
    yearOutput.textContent = year;
    map.setSpeciesOptions({ upToYear: Number(year) });
  };

  const showSpecies = async (key, opts = {}) => {
    stop();
    const data = await loadCells();
    if (!(key in data.species)) key = speciesSelect.options[0].value;
    speciesSelect.value = key;
    const entry = data.species[key];
    if (opts.color) colorSelect.value = opts.color;
    await map.ready;
    const { minYear, maxYear } = map.setSpecies(key, entry, data.resolution, { colorBy: colorSelect.value });
    yearSlider.min = minYear;
    yearSlider.max = maxYear;
    const year = opts.year && opts.year >= minYear && opts.year <= maxYear ? opts.year : maxYear;
    setYear(year);
    help.textContent = `Grid cells with occurrences of ${entry.name}: ${fmt(entry.occurrences)} occurrences in ` +
      `${fmt(entry.cells)} cells of 1 km², first recorded in ${entry.first_year}.`;
    updateUrl({ layer: "species", species: key, color: colorSelect.value === "year" ? "year" : null,
      year: year < maxYear ? year : null });
  };

  const showLayer = async (value) => {
    const speciesMode = value === "species";
    speciesControls.hidden = !speciesMode;
    if (speciesMode) {
      await showSpecies(params.get("species") || speciesSelect.value, {
        color: params.get("color"), year: Number(params.get("year")) || null,
      });
    } else {
      stop();
      await map.ready;
      map.setLayer(value);
      help.textContent = LAYERS[value].help;
      updateUrl({ layer: value === "alien_richness" ? null : value, species: null, color: null, year: null });
    }
  };

  layerSelect.addEventListener("change", () => showLayer(layerSelect.value));
  speciesSelect.addEventListener("change", () => showSpecies(speciesSelect.value));
  colorSelect.addEventListener("change", () => {
    map.setSpeciesOptions({ colorBy: colorSelect.value });
    updateUrl({ color: colorSelect.value === "year" ? "year" : null });
  });
  yearSlider.addEventListener("input", () => { stop(); setYear(yearSlider.value); });
  yearSlider.addEventListener("change", () => {
    updateUrl({ year: Number(yearSlider.value) < Number(yearSlider.max) ? yearSlider.value : null });
  });
  playButton.addEventListener("click", () => {
    if (timer) { stop(); return; }
    const min = Number(yearSlider.min);
    const max = Number(yearSlider.max);
    const step = Math.max(1, Math.ceil((max - min) / 60));   // about 60 frames
    let year = Number(yearSlider.value) >= max ? min : Number(yearSlider.value);
    playButton.textContent = "❚❚ Pause";
    setYear(year);
    timer = setInterval(() => {
      year = Math.min(max, year + step);
      setYear(year);
      if (year >= max) stop();
    }, 200);
  });
  basemapSelect.addEventListener("change", () => map.setBasemap(basemapSelect.value));
  $("opacity").addEventListener("input", () => map.setOpacity(Number($("opacity").value)));

  showLayer(layer);
  return map;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function applyEmbed() {
  if (!embed) return;
  const target = document.querySelector(`[data-embed~="${embed}"]`);
  if (!target) return;
  document.body.classList.add("embed");
  target.classList.add("embed-target");
  // Hide everything that is not the target or one of its ancestors.
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    for (const sib of el.parentElement.children) {
      if (sib !== el && !["SCRIPT", "LINK", "STYLE"].includes(sib.tagName)) sib.classList.add("embed-hidden");
    }
  }
}

function showError(message) {
  const el = document.getElementById("load-error");
  el.hidden = false;
  el.textContent = el.textContent ? `${el.textContent} ${message}` : message;
}

/** Run one component; a failure is reported but does not stop the others. */
async function component(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(name, err);
    showError(`The ${name} could not be shown (${err.message}).`);
  }
}

async function main() {
  applyEmbed();
  let summary, ts;
  try {
    [summary, ts] = await Promise.all([getJson("summary.json"), getJson("timeseries.json")]);
  } catch (err) {
    console.error(err);
    showError(`The data could not be loaded (${err.message}). Serve the site over HTTP, ` +
      `e.g. "python -m http.server" in the site folder.`);
    return;
  }
  setText("[data-region]", summary.region);
  setText("[data-window]", `${summary.window[0]}–${summary.window[1]}`);
  document.title = `Alien species establishment · ${summary.region}`;

  const show = (name) => !embed || embed === name;
  initSubsetSwitches(() => {
    component("indicators", () => renderIndicators(summary));
    component("trend charts", () => renderTrends(ts, show));
  });
  await component("indicators", () => renderIndicators(summary));
  await component("data sources", () => renderSources(summary));
  await component("trend charts", () => renderTrends(ts, show));
  if (show("effort")) await component("sampling effort chart", () => plotEffort(document.getElementById("chart-effort"), ts));
  if (show("map")) await component("map", async () => initMap(await getJson("grid_10km.json")));
  let species = [];
  if (show("species") || !embed) {
    await component("species table", async () => {
      species = await getJson("species.json");
      if (show("species")) new SpeciesTable(document.getElementById("species"), species);
    });
  }
  const example = species.filter((s) => s.invasive && s.observed).sort((a, b) => b.cells - a.cells)[0];
  await component("embed examples", () => renderEmbedSnippets(example));
}

main();
