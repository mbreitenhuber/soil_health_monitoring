/* =====================================================
   dashboard.js  —  grouped field view (OC in g/kg)
===================================================== */

/* ── Formatting helpers ─────────────────────────── */

function formatOcGkg(value) {
  return `${Number(value).toFixed(2)} g/kg`;
}

function roundOc(value) {
  return +Number(value).toFixed(2);
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function relativeTrendPct(firstVal, latestVal) {
  const first  = Number(firstVal);
  const latest = Number(latestVal);
  if (!first || !Number.isFinite(first) || !Number.isFinite(latest)) return null;
  return ((latest - first) / first) * 100;
}

/* ── Y-axis: 30 % padding above + below data range ── */
function ocYAxisOptions(values, { dark = true } = {}) {
  const nums  = values.filter(v => v != null && Number.isFinite(v));
  const dMin  = nums.length ? Math.min(...nums) : 0;
  const dMax  = nums.length ? Math.max(...nums) : 10;
  const range = Math.max(dMax - dMin, 0.5);
  const pad   = Math.max(range * 0.30, 0.5);

  return {
    min:  parseFloat(Math.max(0, dMin - pad).toFixed(2)),
    max:  parseFloat((dMax + pad).toFixed(2)),
    grid:  { color: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)" },
    ticks: {
      color:    dark ? "#9ca3af" : undefined,
      callback: v => Number(v).toFixed(1) + " g/kg",
    },
  };
}

/* ── X-axis: add one null-padded entry on each side ──
   Guarantees visual breathing room (~1 category width)
   regardless of how many data points are shown.       */
function padChart(labels, datasets) {
  const pLabels = ["", ...labels, ""];
  const pDatasets = datasets.map(ds => ({
    ...ds,
    data: [null, ...ds.data, null],
    spanGaps: false,
  }));
  return { labels: pLabels, datasets: pDatasets };
}

/* ── Shared x-axis options for line charts ────────── */
function xAxisOpts({ dark = true } = {}) {
  return {
    grid: { display: false },
    ticks: {
      color: dark ? "#9ca3af" : undefined,
      // suppress the empty padding labels
      callback: (val, idx, ticks) => {
        if (idx === 0 || idx === ticks.length - 1) return "";
        return ticks[idx].label ?? val;
      },
    },
  };
}

/* ── Config ─────────────────────────────────────── */
function readDashboardConfig() {
  const el = document.getElementById("dashboard-config");
  if (!el) return { analyses: [], apiUrl: "http://127.0.0.1:8000" };
  try { return JSON.parse(el.textContent); }
  catch { return { analyses: [], apiUrl: "http://127.0.0.1:8000" }; }
}

const dashboardConfig  = readDashboardConfig();
const ocClassification = dashboardConfig.ocClassification || null;

/* ── Zone colour (LUCAS tiers, mirrors map.js) ──── */
const OC_TIER_COLORS = FieldGradientOverlay.TIER_COLORS;

function ocTier(value) {
  const c = ocClassification;
  if (!c) return "medium";
  if (value < c.threshold_low_gkg) return "low";
  if (value < c.threshold_high_gkg) return "medium";
  return "high";
}

function valueToColor(value) {
  const c = ocClassification;
  const tier = ocTier(value);
  return (c && c.colors && c.colors[tier]) || OC_TIER_COLORS[tier] || OC_TIER_COLORS.medium;
}

let allAnalyses        = dashboardConfig.analyses || [];
let selectedForCompare = new Set();
let currentItem        = null;
let currentFieldName   = null;
let qualityChart       = null;
let fieldLineChart     = null;
let compareChart       = null;
let detailMap          = null;
let fieldIndexMap = {};

const API_URL        = dashboardConfig.apiUrl || "http://127.0.0.1:8000";
const TREND_FLAT_PCT = 1;

const COLORS = {
  min:     "#ef4444",
  avg:     "#f59e0b",
  max:     "#22c55e",
  compare: ["#C94F4F","#f59e0b","#22c55e","#3b82f6","#a855f7","#ec4899"],
};


function parseOc(value) {
  if (value == null) return null;

  const n = parseFloat(
    String(value)
      .replace(",", ".")
      .replace(/[^0-9.-]/g, "")
  );

  return Number.isFinite(n) ? n : null;
}

document.addEventListener("click", (e) => {
  const el = e.target.closest(".kpi-link");
  if (!el) return;

  const field = el.dataset.field;
  if (field) openFieldModal(field);
});

function renderKpiField(elId, fieldName, value, indexMap, type = "") {
  const el = document.getElementById(elId);
  if (!el || !fieldName) return;

  const id = indexMap[fieldName];

  const safeValue =
    Number.isFinite(value) ? `${value.toFixed(2)} g/kg` : "–";

  el.innerHTML = `
    <div class="kpi-main kpi-card-hover">
      <span class="kpi-link kpi-chip" data-field="${fieldName}">
        #${id ?? "–"}
      </span>

      <span class="kpi-unit">
        ${safeValue}
      </span>
    </div>
  `;
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".kpi-card");
  if (!card) return;

  const field = card.querySelector(".kpi-link")?.dataset.field;
  if (field) openFieldModal(field);
});

/* ══════════════════════════════════════════════════
   GROUPING
══════════════════════════════════════════════════ */

function groupByField(analyses) {
  const groups = {};

  analyses.forEach(a => {
    if (!a || !a.field_name) return;

    const key = a.field_name.trim();
    if (!groups[key]) groups[key] = [];

    groups[key].push(a);
  });

  Object.values(groups).forEach(g => {
    g.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  });

  return groups;
}

function buildFieldIndexMap(groups) {
  const map = {};
  let idx = 1;

  Object.keys(groups)
    .sort((a, b) => a.localeCompare(b))
    .forEach(fieldName => {
      map[fieldName] = idx++;
    });

  return map;
}

function fieldKey(a) { return (a.field_name || "Unnamed Field").trim(); }

function updateDashboardKPIs(analyses = allAnalyses) {

  const groups = groupByField(analyses);
  const sortedEntries = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));

  fieldIndexMap = buildFieldIndexMap(groups);

  const totalFields = sortedEntries.length;
  const totalAnalyses = analyses.length;

  let bestField = null;
  let bestValue = null;

  let worstField = null;
  let worstValue = null;

  const latestValues = [];

  sortedEntries.forEach(([fieldName, items]) => {

    const latest = items[items.length - 1]; // garantiert neueste (weil vorher sortiert)
    const val = parseOc(latest?.avg_value);

    if (val === null) return;

    latestValues.push(val);

    if (bestField === null || val > bestValue) {
      bestValue = val;
      bestField = fieldName;
    }

    if (worstField === null || val < worstValue) {
      worstValue = val;
      worstField = fieldName;
    }
  });

  const avgOC = latestValues.length
    ? latestValues.reduce((a, b) => a + b, 0) / latestValues.length
    : null;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("kpi-total-fields", totalFields);
  set("kpi-total-analyses", totalAnalyses);

  document.getElementById("kpi-average-oc").innerHTML =
    avgOC !== null
      ? `${avgOC.toFixed(2)} <span class="kpi-unit">g/kg</span>`
      : "–";

  renderKpiField("kpi-best-field", bestField, bestValue, fieldIndexMap, "best");
  renderKpiField("kpi-worst-field", worstField, worstValue, fieldIndexMap, "worst");

    // reset old states (important for filter updates)
  document.querySelectorAll(".kpi-card").forEach(c => {
    c.classList.remove("kpi-card--best", "kpi-card--worst");
  });

  // best card
  const bestEl = document.getElementById("kpi-best-field");
  if (bestEl) {
    const card = bestEl.closest(".kpi-card");
    if (card) card.classList.add("kpi-card--best");
  }

  // worst card
  const worstEl = document.getElementById("kpi-worst-field");
  if (worstEl) {
    const card = worstEl.closest(".kpi-card");
    if (card) card.classList.add("kpi-card--worst");
  }
}

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  renderDashboard(allAnalyses, { filtered: false });
  updateDashboardKPIs(allAnalyses);
  populateCropFilter();

  document.getElementById("download-csv-btn")
    ?.addEventListener("click", () =>
      window.open(`${API_URL}/api/analyses/csv`, "_blank"));
  document.getElementById("compare-btn")
    ?.addEventListener("click", showCompareChart);
  document.getElementById("end-compare-btn")
    ?.addEventListener("click", endComparison);
  document.getElementById("save-details")
    ?.addEventListener("click", saveDetails);

  document.getElementById("filter-name")
    ?.addEventListener("input", applyFilters);
  document.getElementById("filter-crop")
    ?.addEventListener("change", applyFilters);
  document.getElementById("filter-date-from")
    ?.addEventListener("change", applyFilters);
  document.getElementById("filter-date-to")
    ?.addEventListener("change", applyFilters);
  document.getElementById("filter-reset")
    ?.addEventListener("click", resetFilters);

  const container = document.getElementById("dashboard-container");
  container?.addEventListener("click",  onCardClick);
  container?.addEventListener("change", onCardChange);

  document.getElementById("field-modal")
    ?.addEventListener("click", e => {
      if (e.target.id === "field-modal") closeFieldModal();
    });
  document.getElementById("detail-modal")
    ?.addEventListener("click", e => {
      if (e.target.id === "detail-modal") closeDetailModal();
    });

  updateEndCompareBtn();
});

/* ══════════════════════════════════════════════════
   END COMPARISON
══════════════════════════════════════════════════ */

function endComparison() {
  if (compareChart) { compareChart.destroy(); compareChart = null; }
  const wrapper = document.getElementById("compare-chart-wrapper");
  if (wrapper) wrapper.remove();
  selectedForCompare.clear();
  document.querySelectorAll(".compare-checkbox")
    .forEach(cb => (cb.checked = false));
  updateEndCompareBtn();
}

function updateEndCompareBtn() {
  const btn = document.getElementById("end-compare-btn");
  if (!btn) return;
  btn.style.display =
    (selectedForCompare.size > 0 || compareChart) ? "inline-flex" : "none";
}

/* ══════════════════════════════════════════════════
   RENDER — one card per unique field name
══════════════════════════════════════════════════ */

function renderDashboard(analyses, { filtered = false } = {}) {
  const container = document.getElementById("dashboard-container");
  if (!container) return;

  if (!allAnalyses.length) {
    container.innerHTML =
      "<p style='color:#888;padding:16px 0'>No saved analyses yet.</p>";
    return;
  }
  if (!analyses || analyses.length === 0) {
    container.innerHTML = filtered
      ? "<p style='color:#888;padding:16px 0'>No fields match your filters.</p>"
      : "<p style='color:#888;padding:16px 0'>No saved analyses yet.</p>";
    return;
  }

  const groups = groupByField(analyses);
  fieldIndexMap = buildFieldIndexMap(groups);
  container.innerHTML = Object.entries(groups)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([fieldName, items]) => {
    const latest    = items[items.length - 1];
    const first     = items[0];
    const dateRange = items.length > 1
      ? `${escapeHtml(first.date)} – ${escapeHtml(latest.date)}`
      : escapeHtml(latest.date || "–");

    const firstVal  = parseOc(first.avg_value);
    const latestVal = parseOc(latest.avg_value);

    const trend = (firstVal != null && latestVal != null && firstVal !== 0)
      ? ((latestVal - firstVal) / firstVal) * 100
      : null;
    const trendHTML = trend !== null
      ? `<span class="field-trend ${
          trend >  TREND_FLAT_PCT ? "trend-up"   :
          trend < -TREND_FLAT_PCT ? "trend-down" : "trend-flat"
        }">${
          trend >  TREND_FLAT_PCT ? "↑" :
          trend < -TREND_FLAT_PCT ? "↓" : "→"
        } ${Math.abs(trend).toFixed(1)}%</span>` : "";

    const checked   = selectedForCompare.has(fieldName) ? "checked" : "";
    const safeField = encodeURIComponent(fieldName);

    return `
      <div class="analysis-card field-group-card" data-field="${safeField}">
        <div class="field-group-header">
          <div class="analysis-title">
            ${fieldIndexMap[fieldName] ?? "–"}. ${escapeHtml(fieldName)}
          </div>
          <span class="field-count-badge"
                title="${items.length} ${items.length === 1 ? "analysis" : "analyses"}">
            ${items.length}
          </span>
        </div>
        <div class="analysis-meta">
          📅 ${dateRange}<br>
          ${latest.crop          ? `🌾 ${escapeHtml(latest.crop)}<br>`          : ""}
          ${latest.location_name ? `📍 ${escapeHtml(latest.location_name)}<br>` : ""}
          📊 Latest Avg: <b>${formatOcGkg(latest.avg_value)}</b>
          ${trendHTML}
        </div>
        <label class="compare-label"
               style="display:flex;gap:8px;align-items:center;cursor:pointer;
                      font-size:0.8rem;color:var(--text-dim);">
          <input type="checkbox" class="compare-checkbox"
                 data-field="${safeField}" ${checked}>
          Select for comparison
        </label>
        <div class="field-group-footer">
          <span class="field-analyses-hint">
            ${items.length === 1 ? "1 analysis" : `${items.length} analyses`}
            &nbsp;— click to explore
          </span>
          <span class="field-chevron">›</span>
        </div>
      </div>
    `;
  }).join("");
}

/* ══════════════════════════════════════════════════
   EVENT DELEGATION
══════════════════════════════════════════════════ */

function onCardClick(e) {
  if (e.target.closest(".compare-label") ||
      e.target.closest(".compare-checkbox")) return;
  const card = e.target.closest(".field-group-card");
  if (!card) return;
  openFieldModal(decodeURIComponent(card.dataset.field));
}

function onCardChange(e) {
  const cb = e.target.closest(".compare-checkbox");
  if (!cb || !cb.dataset.field) return;
  const field = decodeURIComponent(cb.dataset.field);
  if (cb.checked) selectedForCompare.add(field);
  else            selectedForCompare.delete(field);
  updateEndCompareBtn();
}

/* ══════════════════════════════════════════════════
   FIELD MODAL
══════════════════════════════════════════════════ */

function updateFieldModalStats(items) {
  const latest = items[items.length - 1];
  const allMin = Math.min(...items.map(a => a.min_value));
  const allMax = Math.max(...items.map(a => a.max_value));
  document.getElementById("field-stat-count").textContent  = items.length;
  document.getElementById("field-stat-min").textContent    = formatOcGkg(allMin);
  document.getElementById("field-stat-max").textContent    = formatOcGkg(allMax);
  document.getElementById("field-stat-latest").textContent = formatOcGkg(latest.avg_value);
}

function openFieldModal(fieldName) {
  currentFieldName = fieldName;

  const items = allAnalyses
    .filter(a => fieldKey(a) === fieldName)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (!items.length) return;

  const latest = items[items.length - 1];

  document.getElementById("field-modal-name").textContent = fieldName;
  const metaParts = [
    latest.location_name ? `📍 ${latest.location_name}` : null,
    latest.crop          ? `🌾 ${latest.crop}`           : null,
  ].filter(Boolean);
  document.getElementById("field-modal-meta").textContent =
    metaParts.join("  ·  ");

  updateFieldModalStats(items);
  renderFieldLineChart(items);
  renderFieldAnalysesList(items);

  // "+ New Analysis" — hands the EXACT polygon of the latest analysis
  // to map.js via sessionStorage, so the field is already drawn on the map
  document.getElementById("field-new-analysis-btn").onclick = () => {
    const prefill = {
      polygon:       latest.polygon       || [],
      field_name:    latest.field_name    || fieldName,
      location_name: latest.location_name || "",
      crop:          latest.crop          || "",
    };
    sessionStorage.setItem("dashboard_prefill", JSON.stringify(prefill));

    // Also store simple params for the save-popup fields
    const p = new URLSearchParams();
    p.set("field", fieldName);
    if (latest.location_name) p.set("location", latest.location_name);
    if (latest.crop)          p.set("crop",     latest.crop);
    window.location.href = `/analyse?${p.toString()}`;
  };

  document.getElementById("field-modal").style.display = "flex";
}

window.closeFieldModal = function () {
  document.getElementById("field-modal").style.display = "none";
  if (fieldLineChart) { fieldLineChart.destroy(); fieldLineChart = null; }
};

/* ── Field line chart (Min / Avg / Max over time) ── */

function renderFieldLineChart(items) {
  const ctx = document.getElementById("field-line-chart").getContext("2d");
  if (fieldLineChart) fieldLineChart.destroy();

  const rawLabels = items.map(a => a.date || "–");
  const maxData   = items.map(a => roundOc(a.max_value));
  const avgData   = items.map(a => roundOc(a.avg_value));
  const minData   = items.map(a => roundOc(a.min_value));
  const allY      = [...maxData, ...avgData, ...minData];

  const sharedOpts = {
    tension: 0.35,
    pointRadius:      items.length === 1 ? 7 : 5,
    pointHoverRadius: 8,
    borderWidth:      2.5,
    fill:             false,
  };

  // pad labels + data for x-axis breathing room
  const { labels, datasets } = padChart(rawLabels, [
    { ...sharedOpts, label: "Maximum", data: maxData,
      borderColor: COLORS.max, pointBackgroundColor: COLORS.max },
    { ...sharedOpts, label: "Average", data: avgData,
      borderColor: COLORS.avg, pointBackgroundColor: COLORS.avg },
    { ...sharedOpts, label: "Minimum", data: minData,
      borderColor: COLORS.min, pointBackgroundColor: COLORS.min },
  ]);

  fieldLineChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: "#9ca3af", font: { size: 12 }, boxWidth: 16 },
        },
        tooltip: {
          filter: item => item.parsed.y !== null,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} g/kg`,
          },
        },
      },
      scales: {
        y: ocYAxisOptions(allY, { dark: true }),
        x: xAxisOpts({ dark: true }),
      },
    },
  });
}

/* ── Analyses list ────────────────────────────── */

function renderFieldAnalysesList(items) {
  const list   = document.getElementById("field-analyses-list");
  const sorted = [...items].reverse();

  list.innerHTML = sorted.map(a => `
    <div class="field-analysis-row">
      <div class="field-analysis-row-info">
        <span class="row-date">${escapeHtml(a.date || "–")}</span>
        <div class="row-badges">
          <span class="badge-min" title="Min">${formatOcGkg(a.min_value)}</span>
          <span class="badge-avg" title="Avg">${formatOcGkg(a.avg_value)}</span>
          <span class="badge-max" title="Max">${formatOcGkg(a.max_value)}</span>
        </div>
      </div>
      <div class="field-analysis-row-actions">
        <button class="btn-secondary field-detail-btn"   data-id="${a.id}">Details</button>
        <button class="btn-secondary field-download-btn" data-id="${a.id}">⬇</button>
        <button class="btn-danger    field-delete-btn"   data-id="${a.id}">Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".field-detail-btn").forEach(btn =>
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const item = allAnalyses.find(a => String(a.id) === btn.dataset.id);
      if (item) openDetailModal(item);
    })
  );
  list.querySelectorAll(".field-download-btn").forEach(btn =>
    btn.addEventListener("click", e => {
      e.stopPropagation();
      downloadAnalysis(btn.dataset.id);
    })
  );
  list.querySelectorAll(".field-delete-btn").forEach(btn =>
    btn.addEventListener("click", e => {
      e.stopPropagation();
      deleteAnalysisFromField(btn.dataset.id);
    })
  );
}

async function deleteAnalysisFromField(id) {
  if (!confirm("Delete this analysis?")) return;
  try {
    const res = await fetch(`${API_URL}/api/analyses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    allAnalyses = allAnalyses.filter(a => String(a.id) !== id);
    applyFilters();
    refreshCropFilter();

    const remaining = allAnalyses
      .filter(a => fieldKey(a) === currentFieldName)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    if (remaining.length === 0) {
      selectedForCompare.delete(currentFieldName);
      closeFieldModal();
    } else {
      updateFieldModalStats(remaining);
      renderFieldLineChart(remaining);
      renderFieldAnalysesList(remaining);
    }
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

/* ══════════════════════════════════════════════════
   CROP FILTER
══════════════════════════════════════════════════ */

function populateCropFilter() {
  const select = document.getElementById("filter-crop");
  if (!select) return;
  const crops = [...new Set(
    allAnalyses.map(a => (a.crop || "").trim()).filter(Boolean)
  )].sort();
  crops.forEach(crop => {
    const opt       = document.createElement("option");
    opt.value       = crop.toLowerCase();
    opt.textContent = crop.charAt(0).toUpperCase() + crop.slice(1);
    select.appendChild(opt);
  });
}

function refreshCropFilter() {
  const select = document.getElementById("filter-crop");
  if (!select) return;
  const currentVal = select.value;
  while (select.options.length > 1) select.remove(1);
  const crops = [...new Set(
    allAnalyses.map(a => (a.crop || "").trim()).filter(Boolean)
  )].sort();
  crops.forEach(crop => {
    const opt       = document.createElement("option");
    opt.value       = crop.toLowerCase();
    opt.textContent = crop.charAt(0).toUpperCase() + crop.slice(1);
    select.appendChild(opt);
  });
  select.value = currentVal;
}

/* ══════════════════════════════════════════════════
   FILTERS
══════════════════════════════════════════════════ */

function applyFilters() {
  const name     = document.getElementById("filter-name").value.trim().toLowerCase();
  const crop     = document.getElementById("filter-crop").value.toLowerCase();
  const dateFrom = document.getElementById("filter-date-from").value;
  const dateTo   = document.getElementById("filter-date-to").value;
  const hasFilters = Boolean(name || crop || dateFrom || dateTo);

  let filtered = [...allAnalyses];
  if (name)     filtered = filtered.filter(a => (a.field_name || "").toLowerCase().includes(name));
  if (crop)     filtered = filtered.filter(a => (a.crop || "").toLowerCase() === crop);
  if (dateFrom) filtered = filtered.filter(a => a.date >= dateFrom);
  if (dateTo)   filtered = filtered.filter(a => a.date <= dateTo);

  renderDashboard(filtered, { filtered: hasFilters });
  updateDashboardKPIs(filtered);
  updateFilterSummary(filtered, name, crop, dateFrom, dateTo);
}

function resetFilters() {
  document.getElementById("filter-name").value      = "";
  document.getElementById("filter-crop").value      = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value   = "";
  renderDashboard(allAnalyses, { filtered: false });
  updateDashboardKPIs(allAnalyses);
  document.getElementById("filter-summary").style.display = "none";
}

function updateFilterSummary(filtered, name, crop, from, to) {
  const el     = document.getElementById("filter-summary");
  const active = [name, crop, from, to].some(Boolean);
  if (!active) { el.style.display = "none"; return; }

  const filteredFields = Object.keys(groupByField(filtered)).length;
  const totalFields    = Object.keys(groupByField(allAnalyses)).length;
  const parts = [];
  if (name) parts.push(`name contains "<b>${escapeHtml(name)}</b>"`);
  if (crop) parts.push(`crop = "<b>${escapeHtml(crop)}</b>"`);
  if (from) parts.push(`from <b>${escapeHtml(from)}</b>`);
  if (to)   parts.push(`to <b>${escapeHtml(to)}</b>`);

  el.innerHTML     =
    `Showing <b>${filteredFields}</b> of <b>${totalFields}</b> fields — ${parts.join(", ")}`;
  el.style.display = "block";
}

/* ══════════════════════════════════════════════════
   DOWNLOAD
══════════════════════════════════════════════════ */

function downloadAnalysis(id) {
  window.open(`${API_URL}/api/analyses/${id}/csv`, "_blank");
}

/* ══════════════════════════════════════════════════
   COMPARE CHART — one line per selected field
══════════════════════════════════════════════════ */

function showCompareChart() {
  if (selectedForCompare.size < 2) {
    alert("Please select at least 2 fields for comparison.");
    return;
  }

  const old = document.getElementById("compare-chart-wrapper");
  if (old) old.remove();
  if (compareChart) { compareChart.destroy(); compareChart = null; }

  const wrapper  = document.createElement("div");
  wrapper.id     = "compare-chart-wrapper";
  const title    = document.createElement("p");
  title.style.cssText =
    "font-weight:700;font-size:0.95rem;margin:0 0 16px;color:#333;";
  title.textContent = "Field Comparison — Average OC (g/kg) over Time";
  wrapper.appendChild(title);

  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);
  document.getElementById("dashboard-container")
    .parentNode.insertBefore(wrapper, document.getElementById("dashboard-container"));

  const groups  = groupByField(allAnalyses);
  const dateSet = new Set();
  selectedForCompare.forEach(name => {
    (groups[name] || []).forEach(a => { if (a.date) dateSet.add(a.date); });
  });
  const rawDates = [...dateSet].sort();

  const rawDatasets = [...selectedForCompare].map((fieldName, i) => {
    const items  = groups[fieldName] || [];
    const byDate = Object.fromEntries(items.map(a => [a.date, a]));
    const color  = COLORS.compare[i % COLORS.compare.length];
    return {
      label:                fieldName,
      data:                 rawDates.map(d => byDate[d] ? roundOc(byDate[d].avg_value) : null),
      borderColor:          color,
      pointBackgroundColor: color,
      tension:              0.35,
      pointRadius:          5,
      pointHoverRadius:     7,
      borderWidth:          2.5,
      fill:                 false,
    };
  });

  const { labels, datasets } = padChart(rawDates, rawDatasets);
  const allY = rawDatasets.flatMap(ds => ds.data).filter(v => v != null);

  compareChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { font: { size: 12 }, boxWidth: 16 } },
        tooltip: {
          filter: item => item.parsed.y !== null,
          callbacks: {
            label: ctx =>
              ` ${ctx.dataset.label}: ${
                ctx.parsed.y !== null ? ctx.parsed.y + " g/kg" : "–"
              }`,
          },
        },
      },
      scales: {
        y: ocYAxisOptions(allY, { dark: false }),
        x: xAxisOpts({ dark: false }),
      },
    },
  });

  updateEndCompareBtn();
  wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ══════════════════════════════════════════════════
   DETAIL MODAL — single analysis edit + map
══════════════════════════════════════════════════ */

function openDetailModal(item) {
  currentItem = item;

  document.getElementById("edit-field-name").value = item.field_name    || "";
  document.getElementById("edit-location").value   = item.location_name || "";
  document.getElementById("edit-crop").value       = item.crop          || "";
  document.getElementById("edit-notes").value      = item.notes         || "";

  document.getElementById("detail-avg").textContent = formatOcGkg(item.avg_value);
  document.getElementById("detail-min").textContent = formatOcGkg(item.min_value);
  document.getElementById("detail-max").textContent = formatOcGkg(item.max_value);

  document.getElementById("detail-modal").style.display = "flex";
  renderDetailChart(item);

  if (typeof L !== "undefined") renderDetailMap(item);
}

window.closeDetailModal = function () {
  document.getElementById("detail-modal").style.display = "none";
  if (qualityChart) { qualityChart.destroy(); qualityChart = null; }
  if (detailMap)    { detailMap.remove();     detailMap    = null; }
};

/* ── Save edits ─────────────────────────────────── */

async function saveDetails() {
  if (!currentItem) return;
  const newFieldName = document.getElementById("edit-field-name").value.trim();
  const payload = {
    ...currentItem,
    field_name:    newFieldName || currentItem.field_name,
    location_name: document.getElementById("edit-location").value,
    crop:          document.getElementById("edit-crop").value,
    notes:         document.getElementById("edit-notes").value,
  };
  try {
    const res = await fetch(`${API_URL}/api/update-analysis/${currentItem.id}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const idx = allAnalyses.findIndex(
      a => String(a.id) === String(currentItem.id)
    );
    if (idx !== -1) allAnalyses[idx] = { ...allAnalyses[idx], ...payload };

    const oldFieldName = fieldKey(currentItem);
    const renamed = newFieldName && fieldKey({ field_name: newFieldName }) !== oldFieldName;
    if (renamed) {
      if (selectedForCompare.has(oldFieldName)) {
        selectedForCompare.delete(oldFieldName);
        selectedForCompare.add(fieldKey(payload));
      }
      if (currentFieldName === oldFieldName) currentFieldName = fieldKey(payload);
    }

    closeDetailModal();
    applyFilters();
    refreshCropFilter();

    if (document.getElementById("field-modal").style.display === "flex") {
      openFieldModal(currentFieldName);
    }
  } catch (err) {
    alert("Save failed: " + err.message);
  }
}

/* ── Detail bar chart ───────────────────────────── */

function renderDetailChart(item) {
  const ctx = document.getElementById("quality-chart").getContext("2d");
  if (qualityChart) qualityChart.destroy();

  const barData = [
    roundOc(item.min_value),
    roundOc(item.avg_value),
    roundOc(item.max_value),
  ];

  qualityChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Minimum", "Average", "Maximum"],
      datasets: [{
        label:           "OC (g/kg)",
        data:            barData,
        backgroundColor: [COLORS.min, COLORS.avg, COLORS.max],
        borderRadius:    8,
        borderSkipped:   false,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} g/kg` } },
      },
      scales: {
        y: ocYAxisOptions(barData, { dark: true }),
        x: {
          // offset adds visual space on both ends of a bar chart's x-axis
          offset: true,
          grid:   { display: false },
          ticks:  { color: "#9ca3af" },
        },
      },
    },
  });
}

/* ── Mini satellite map ──────────────────────────── */

function renderDetailMap(item) {
  const container = document.getElementById("detail-map");
  if (!container) return;

  if (detailMap) { detailMap.remove(); detailMap = null; }

  detailMap = L.map("detail-map", {
    zoomControl:        true,
    attributionControl: false,
    scrollWheelZoom:    true,
  });

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri" }
  ).addTo(detailMap);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { opacity: 0.8 }
  ).addTo(detailMap);

  const zones   = item.zones   || [];
  const polygon = item.polygon || [];

  if (!polygon.length && !zones.length) {
    container.parentElement.style.display = "none";
    return;
  }
  container.parentElement.style.display = "";

  const bounds = [];

  const viz = FieldGradientOverlay.addFieldVisualization({
    map: detailMap,
    polygon,
    zones,
    classification: ocClassification,
    valueToColor,
    formatTooltip: (zone) =>
      `<b>${zone.label || "–"}</b><br>OC: ${Number(zone.value).toFixed(1)} g/kg`,
  });

  if (viz.borderLayer) bounds.push(viz.borderLayer.getBounds());
  else if (polygon.length >= 3) {
    bounds.push(L.latLngBounds(polygon.map(p => [p.lat, p.lng])));
  }

  if (bounds.length) {
    const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0].pad(0));
    detailMap.fitBounds(combined, { padding: [24, 24] });
  }

  setTimeout(() => detailMap && detailMap.invalidateSize(), 120);
}