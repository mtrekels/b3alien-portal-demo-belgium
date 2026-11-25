// Searchable, sortable table of the checklist species, with CSV export.

const COLUMNS = [
  { key: "name", label: "Species", type: "text" },
  { key: "kingdom", label: "Kingdom", type: "text" },
  { key: "invasive", label: "Invasive", type: "bool" },
  { key: "habitat", label: "Habitat", type: "text" },
  { key: "first_year", label: "First GBIF record", type: "num" },
  { key: "cells", label: "1 km cells", type: "num" },
  { key: "occurrences", label: "Occurrences", type: "num" },
];

const FILTERS = {
  all: () => true,
  observed: (s) => s.observed,
  not_observed: (s) => s.matched && !s.observed,
  invasive: (s) => s.invasive,
  unmatched: (s) => !s.matched,
};

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class SpeciesTable {
  constructor(root, species) {
    this.species = species;
    this.root = root;
    this.sort = { key: "occurrences", dir: -1 };
    this.query = "";
    this.filter = "all";
    this.habitat = "";

    const habitats = [...new Set(species.flatMap((s) => (s.habitat || "").split("|")).filter(Boolean))].sort();
    root.querySelector("#species-habitat").innerHTML =
      `<option value="">All habitats</option>` + habitats.map((h) => `<option>${escapeHtml(h)}</option>`).join("");

    root.querySelector("#species-search").addEventListener("input", (e) => { this.query = e.target.value.trim().toLowerCase(); this.render(); });
    root.querySelector("#species-filter").addEventListener("change", (e) => { this.filter = e.target.value; this.render(); });
    root.querySelector("#species-habitat").addEventListener("change", (e) => { this.habitat = e.target.value; this.render(); });
    root.querySelector("#species-csv").addEventListener("click", () => this.downloadCsv());

    const thead = root.querySelector("thead");
    thead.innerHTML = `<tr>${COLUMNS.map((c) => `<th data-key="${c.key}" class="${c.type}" tabindex="0" aria-sort="none">${c.label}</th>`).join("")}</tr>`;
    thead.querySelectorAll("th").forEach((th) => {
      const handler = () => {
        const key = th.dataset.key;
        this.sort = { key, dir: this.sort.key === key ? -this.sort.dir : (key === "name" ? 1 : -1) };
        this.render();
      };
      th.addEventListener("click", handler);
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); } });
    });
    this.render();
  }

  rows() {
    const { key, dir } = this.sort;
    return this.species
      .filter(FILTERS[this.filter])
      .filter((s) => !this.habitat || (s.habitat || "").split("|").includes(this.habitat))
      .filter((s) => !this.query || (s.name || "").toLowerCase().includes(this.query))
      .sort((a, b) => {
        const va = a[key], vb = b[key];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * dir;
      });
  }

  render() {
    const rows = this.rows();
    this.root.querySelectorAll("thead th").forEach((th) => {
      const active = th.dataset.key === this.sort.key;
      th.setAttribute("aria-sort", active ? (this.sort.dir > 0 ? "ascending" : "descending") : "none");
    });
    const body = rows.map((s) => {
      const status = !s.matched ? '<span class="tag tag-warn" title="Not matched to the GBIF backbone at species level">unmatched</span>'
        : !s.observed ? '<span class="tag" title="Not recorded in the GBIF occurrence cube">not in cube</span>' : "";
      return `<tr>
        <td><em>${escapeHtml(s.name || "")}</em> ${s.authorship ? `<span class="muted">${escapeHtml(s.authorship)}</span>` : ""} ${status}</td>
        <td>${escapeHtml(s.kingdom || "")}</td>
        <td>${s.invasive ? '<span class="tag tag-invasive">invasive</span>' : ""}</td>
        <td>${escapeHtml((s.habitat || "").replaceAll("|", ", "))}</td>
        <td class="num">${s.first_year ?? ""}</td>
        <td class="num">${s.cells ? s.cells.toLocaleString("en-GB") : ""}</td>
        <td class="num">${s.occurrences ? s.occurrences.toLocaleString("en-GB") : ""}</td>
      </tr>`;
    }).join("");
    this.root.querySelector("tbody").innerHTML = body || `<tr><td colspan="${COLUMNS.length}" class="empty">No species match the filters.</td></tr>`;
    this.root.querySelector("#species-count").textContent = `${rows.length.toLocaleString("en-GB")} of ${this.species.length.toLocaleString("en-GB")} taxa`;
  }

  downloadCsv() {
    const cols = ["name", "authorship", "kingdom", "key", "matched", "observed", "invasive", "habitat", "first_year", "cells", "occurrences"];
    const quote = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [cols.join(","), ...this.rows().map((s) => cols.map((c) => quote(s[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "alien_species.csv" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
