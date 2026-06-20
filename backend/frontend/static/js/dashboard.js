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

// Chart.js global konfigurieren, um Standard-Farben zu eliminieren
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.elements.line.borderWidth = 2;
Chart.defaults.elements.point.radius = 3;
Chart.defaults.elements.point.hoverRadius = 5;
Chart.defaults.elements.point.borderWidth = 2;
Chart.defaults.elements.point.borderColor = "rgba(107, 114, 128, 0.55)";
Chart.defaults.elements.point.backgroundColor = "transparent";
Chart.defaults.elements.point.hoverBackgroundColor = "rgba(107, 114, 128, 0.55)";
Chart.defaults.elements.point.hoverBorderColor = "rgba(107, 114, 128, 0.55)";
Chart.defaults.elements.point.hoverBorderWidth = 2;

/* ── X-axis: add one null-padded entry on each side ──
   Guarantees visual breathing room (~1 category width)
   regardless of how many data points are shown.       */
function padChart(labels, datasets) {
  const pLabels = ["", ...labels, ""];
  const pDatasets = datasets.map(ds => ({
    ...ds,
    data: [null, ...ds.data, null],
    spanGaps: true,
  }));
  return { labels: pLabels, datasets: pDatasets };
}

/* ── Shared x-axis options for line charts ────────── */
function xAxisOpts({ dark = true } = {}) {
  return {
    grid: { display: false },
    ticks: {
      color: dark ? "#9ca3af" : undefined,
      maxRotation: 30,
      callback: function(val) {
        const label = this.getLabelForValue(val);
        if (!label) return "";
        return label; // komplettes Datum: YYYY-MM-DD
      }
    },
  };
}

/**
 * Findet den Dataset-Index dessen letzter sichtbarer Punkt
 * der Maus am nächsten liegt (X+Y-Distanz).
 * Funktioniert zuverlässig auch bei sich kreuzenden Linien.
 */
function getNearestDatasetIndex(chart, event) {
  const rect   = chart.canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
 
  let bestIdx  = null;
  let bestDist = Infinity;
 
  chart.data.datasets.forEach((ds, i) => {
    const meta = chart.getDatasetMeta(i);
    if (!meta || !meta.data) return;
 
    meta.data.forEach(point => {
      if (point.x == null || point.y == null) return;
      const dx   = point.x - mouseX;
      const dy   = point.y - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx  = i;
      }
    });
  });
 
  // Nur reagieren wenn Maus innerhalb 32px eines Punktes
  return bestDist <= 32 ? bestIdx : null;
}
 
// Alias für Rückwärtskompatibilität (falls noch irgendwo genutzt)
function getDatasetHoverIndex(chart, event) {
  return getNearestDatasetIndex(chart, event);
}

function toggleDatasetLock(chart, idx) {
  if (idx === null || idx === undefined) return;
  chart._lockedDataset = (chart._lockedDataset === idx) ? null : idx;
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
const ui = dashboardConfig.ui || {};

function uiText(key, vars = {}) {
  let s = ui[key] || key;
  Object.entries(vars).forEach(([k, v]) => {
    s = s.replace(`{${k}}`, v);
  });
  return s;
}

/* ── Zone colour (LUCAS tiers, mirrors map.js) ──── */
const OC_TIER_COLORS = FieldGradientOverlay.TIER_COLORS;

function ocTier(value) {
  const c = ocClassification;
  if (!c) return "medium";
  if (value < c.threshold_low_gkg) return "low";
  if (value < c.threshold_high_gkg) return "medium";
  return "high";
}

function valueToColor(value, classification) {
  return FieldGradientOverlay.valueToColorPlasmaDiscrete(
    value,
    classification || ocClassification
  );
}

let allAnalyses        = dashboardConfig.analyses || [];
let selectedForCompare = new Set();
let currentItem        = null;
let currentFieldName   = null;
let qualityChart       = null;
let fieldLineChart     = null;
let compareChart       = null;
let detailMap                 = null;
let detailMapInvalidateTimer = null;
let fieldIndexMap = {};
let activeDatasetIndex = null;

const API_URL        = dashboardConfig.apiUrl || "http://127.0.0.1:8000";
const TREND_FLAT_PCT = 1;

const COLORS = {
  active:   "#111827",   // aktive / einzelne Linie  (Dark-Mode: wird per CSS-Var überschrieben)
  dimmed:   "rgba(156, 163, 175, 0.25)",  // gedimmte Linien
  grid:     "rgba(255,255,255,0.07)",
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

window.addEventListener("click", (e) => {
  if (!e.target.closest("canvas")) {
    [compareChart, fieldLineChart].forEach(c => {
      if (c && c._lockedDataset !== null) {
        c._lockedDataset = null;
        c._hoveredDataset = null;
        c.update("none");
      }
    });
  }
});

const unifiedChartPlugin = {
  id: "unifiedChartPlugin",
 
  /* Vor dem Zeichnen: Stile setzen */
  beforeDatasetsDraw(chart) {
    const locked   = chart._lockedDataset;
    const hovered  = chart._hoveredDataset;
    const focused  = locked ?? hovered;       // Lock hat Vorrang vor Hover
    const hasFocus = focused !== null && focused !== undefined;
 
    // Dark-Mode-safe Vordergrundfarbe auslesen
    const fgColor  = getComputedStyle(chart.canvas)
      .getPropertyValue("--color-text-primary").trim() || "#111827";
 
    chart.data.datasets.forEach((ds, i) => {
      const isActive = (focused === i);
      const isDimmed = hasFocus && !isActive;
 
      if (!hasFocus) {
        ds.borderColor          = "rgba(107, 114, 128, 0.55)";
        ds.borderWidth          = 1.5;
        ds.pointRadius          = 3;
        ds.pointHoverRadius     = 5;
        ds.pointBackgroundColor = "transparent";
        ds.pointBorderColor     = "rgba(107, 114, 128, 0.55)";
        ds.pointBorderWidth     = 2;
        ds.pointHoverBackgroundColor = "rgba(107, 114, 128, 0.55)";
        ds.pointHoverBorderColor     = "rgba(107, 114, 128, 0.55)";
        ds.pointHoverBorderWidth     = 2;
      } else if (isActive) {
        ds.borderColor          = fgColor;
        ds.borderWidth          = 2.5;
        ds.pointRadius          = 4;
        ds.pointHoverRadius     = 6;
        ds.pointBackgroundColor = "transparent";
        ds.pointBorderColor     = fgColor;
        ds.pointBorderWidth     = 2;
        ds.pointHoverBackgroundColor = fgColor;
        ds.pointHoverBorderColor     = fgColor;
        ds.pointHoverBorderWidth     = 2;
      } else {
        ds.borderColor          = "rgba(107, 114, 128, 0.55)";
        ds.borderWidth          = 1.5;
        ds.pointRadius          = 3;
        ds.pointHoverRadius     = 5;
        ds.pointBackgroundColor = "transparent";
        ds.pointBorderColor     = "rgba(107, 114, 128, 0.55)";
        ds.pointBorderWidth     = 2;
        ds.pointHoverBackgroundColor = "rgba(107, 114, 128, 0.55)";
        ds.pointHoverBorderColor     = "rgba(107, 114, 128, 0.55)";
        ds.pointHoverBorderWidth     = 2;
      }
    });
  },
 
  /* Nach dem Zeichnen: Dataset-Label am Linienende */
  afterDatasetsDraw(chart) {
    const { ctx }  = chart;
    const locked   = chart._lockedDataset;
    const hovered  = chart._hoveredDataset;
    const focused  = locked ?? hovered;
    const hasFocus = focused !== null && focused !== undefined;
 
    const fgColor  = getComputedStyle(chart.canvas)
      .getPropertyValue("--color-text-primary").trim() || "#111827";
 
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.font         = "500 11px system-ui, sans-serif";
 
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (!meta?.data?.length) return;
 
      // Letzten sichtbaren Punkt finden
      let lastPoint = null;
      for (let j = ds.data.length - 1; j >= 0; j--) {
        if (ds.data[j] != null) { lastPoint = meta.data[j]; break; }
      }
      if (!lastPoint) return;
 
      const isActive = (focused === i);
      const isDimmed = hasFocus && !isActive;
 
      // Labels: nur sichtbar wenn kein Focus, oder wenn aktiv
      if (hasFocus && isDimmed) {
        ctx.fillStyle = "rgba(107, 114, 128, 0.6)";
      } else if (!hasFocus) {
        ctx.fillStyle = "rgba(107, 114, 128, 0.6)";
      } else {
        ctx.fillStyle = fgColor;
      }
 
      ctx.fillText(ds.label || "", lastPoint.x + 10, lastPoint.y);
    });
 
    ctx.restore();
  },
};

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

function computeFieldMetrics(items) {
  const sorted = [...items].sort((a, b) =>
    new Date(a.date || 0) - new Date(b.date || 0)
  );

  const values = sorted
    .map(i => parseFloat(String(i.avg_value).replace(",", ".")))
    .filter(v => Number.isFinite(v));

  if (!values.length) return null;

  const latest = values[values.length - 1];
  const first  = values[0];

  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const trend = first ? ((latest - first) / first) * 100 : 0;

  return { latest, avg, trend };
}

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

function fieldKey(a) { return (a.field_name || uiText("unnamed_field")).trim(); }

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

    const latest = items[items.length - 1];
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

  document.querySelectorAll(".kpi-card").forEach(c => {
    c.classList.remove("kpi-card--best", "kpi-card--worst");
  });

  const bestEl = document.getElementById("kpi-best-field");
  if (bestEl) {
    const card = bestEl.closest(".kpi-card");
    if (card) card.classList.add("kpi-card--best");
  }

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
  renderGlobalOverviewMap(allAnalyses);
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

  document.getElementById("sort-fields")
  ?.addEventListener("change", () => {
    renderDashboard(allAnalyses, { filtered: false });
  });

  const toggleBtn = document.getElementById("toggle-filters");
  const panel = document.getElementById("filter-panel");

  toggleBtn?.addEventListener("click", () => {
    const isOpen = panel.style.display === "block";

    panel.style.display = isOpen ? "none" : "block";
    toggleBtn.textContent = isOpen ? uiText("filters_open") : uiText("filters");
  });

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

  // Nur verstecken, nicht entfernen — sonst ist Canvas weg
  const wrapper = document.getElementById("compare-chart-wrapper");
  if (wrapper) wrapper.style.display = "none";

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
   NEW LAYOUT: 3-column sketch design
══════════════════════════════════════════════════ */

function getCropDisplay(cropName) {
    if (!cropName) return "";
    
    // Alles in Kleinbuchstaben, damit "Mais" und "mais" gleich behandelt werden
    const name = cropName.toLowerCase().trim();
    
    // Mapping der Standard-Crops (Englisch + Deutsch)
    const icons = {
        // Weizen
        'wheat': '🌾', 'weizen': '🌾',
        
        // Mais
        'corn': '🌽', 'mais': '🌽',
        
        // Gerste
        'barley': '🌾', 'gerste': '🌾',
        
        // Kartoffel
        'potato': '🥔', 'kartoffel': '🥔',
        
        // Sojabohne
        'soybean': '🫘', 'soja': '🫘', 'sojabohne': '🫘',
        
        // Reis
        'rice': '🌾', 'reis': '🌾'
    };

    // Wählt das Icon aus, oder default 🌱
    const icon = icons[name] || '🌱';
    
    return `${icon} ${escapeHtml(cropName)}`;
}

function formatMonthYear(dateString) {
    if (!dateString || dateString === "–") return "–";
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; 

    // Holt sich das Attribut direkt aus dem HTML-Tag (<html lang="de">)
    // Wenn nichts gesetzt ist, wird 'en' als Standard genommen
    const langAttr = document.documentElement.lang || 'en';
    
    // Wir schauen: Startet der Wert mit 'de'? Dann 'de-DE', sonst 'en-US'
    const locale = (langAttr.startsWith('de')) ? 'de-DE' : 'en-US';

    const month = date.toLocaleString(locale, { month: 'long' });
    const year = date.getFullYear();
    
    return `${month} ${year}`;
}

function renderDashboard(analyses, { filtered = false } = {}) {
  const container = document.getElementById("dashboard-container");
  if (!container) return;

  if (!allAnalyses.length) {
    container.innerHTML =
      `<p style='color:#888;padding:16px 0'>${uiText("no_analyses")}</p>`;
    return;
  }
  if (!analyses || analyses.length === 0) {
    container.innerHTML = filtered
      ? `<p style='color:#888;padding:16px 0'>${uiText("no_match")}</p>`
      : `<p style='color:#888;padding:16px 0'>${uiText("no_analyses")}</p>`;
    return;
  }

  const groups = groupByField(analyses);
  fieldIndexMap = buildFieldIndexMap(groups);

  const sortMode = document.getElementById("sort-fields")?.value || "latest";
  const sortedGroups = sortGroups(groups, sortMode);

  container.innerHTML = sortedGroups.map(({ name, items }) => {
    const latest   = items[items.length - 1];
    const first    = items[0];
    const prev     = items.length >= 2 ? items[items.length - 2] : null;

    const firstVal  = parseOc(first.avg_value);
    const latestVal = parseOc(latest.avg_value);
    const prevVal   = prev ? parseOc(prev.avg_value) : null;

    // All-time change (first → latest)
    const trendAllTime = (firstVal != null && latestVal != null && firstVal !== 0)
      ? ((latestVal - firstVal) / firstVal) * 100
      : null;

    // Previous-analysis change (prev → latest)
    const trendPrev = (prevVal != null && latestVal != null && prevVal !== 0)
      ? ((latestVal - prevVal) / prevVal) * 100
      : null;

    function trendBadge(pct, label) {
      if (pct === null) return "";
      const cls = pct >  0.2 ? "trend-up" : pct < -0.2 ? "trend-down" : "trend-flat";
      const arrow = pct > 0.2 ? "↑" : pct < -0.2 ? "↓" : "→";
      return `<span class="fgc-trend-row">
        <span class="fgc-trend-label">${label}</span>
        <span class="field-trend ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>
      </span>`;
    }

    const currentLang = typeof lang !== 'undefined' ? lang : 'en';

    const dateRange = items.length > 1
      ? `${formatMonthYear(first.date, currentLang)} – ${formatMonthYear(latest.date, currentLang)}`
      : formatMonthYear(latest.date || "–", currentLang);

    const checked   = selectedForCompare.has(name) ? "checked" : "";
    const safeField = encodeURIComponent(name);

    // Sparkline data
    const sparkItems = items.filter(i => parseOc(i.avg_value) != null);
    const sparkData  = sparkItems.map(i => parseOc(i.avg_value));
    const sparkDates = sparkItems.map(i => i.date || "");

    return `
      <div class="analysis-card field-group-card" data-field="${safeField}">
        <div class="fgc-info">
          <div class="analysis-title">
            ${fieldIndexMap[name] ?? "–"}. ${escapeHtml(name)}
          </div>
          <div class="fgc-meta-list">
            <span>📅 ${dateRange}</span>
            ${latest.crop ? `<span>${getCropDisplay(latest.crop)}</span>` : ""}
            ${latest.location_name ? `<span>📍 ${escapeHtml(latest.location_name)}</span>` : ""}
          </div>
          <div class="fgc-count">
            ${items.length === 1 ? uiText("one_analysis") : uiText("n_analyses", { n: items.length })}
          </div>
        </div>

        <!-- COL 2: Sparkline chart (avg only, coloured segments) -->
        <div class="fgc-chart">
          <canvas class="fgc-sparkline"
                  data-values="${sparkData.join(",")}"
                  data-labels="${sparkDates.join("|")}"></canvas>
        </div>

        <!-- COL 3: Latest value + actions -->
        <div class="fgc-actions">
          <div class="fgc-latest">
            <span class="fgc-latest-label">${uiText("latest_avg_oc")}</span>
            <span class="fgc-latest-value">${formatOcGkg(latest.avg_value)}</span>
            <span class="fgc-latest-label">${uiText("current_vs")}</span>
            ${trendBadge(trendAllTime, uiText("first_sample"))}
            ${trendBadge(trendPrev, uiText("recent_sample"))}
          </div>
          <div class="fgc-buttons">
            <label class="compare-label"
                   style="cursor:pointer; font-size:0.78rem; color:var(--text-dim);
                          display:flex; gap:7px; align-items:center; user-select:none;">
              <input type="checkbox" class="compare-checkbox"
                     data-field="${safeField}" ${checked}>
              ${uiText("select_compare")}
            </label>
            <button class="fgc-explore-btn" data-field="${safeField}">
              ${uiText("click_explore")}
            </button>
          </div>
        </div>

      </div>
    `;
  }).join("");

  // Draw sparklines after DOM update
  requestAnimationFrame(() => drawSparklines());
}

/* ── Draw mini sparkline on each .fgc-sparkline canvas ──
   • Y-axis labels fully visible (wider left pad)
   • Chart title drawn inside canvas top-left
   • Line segments coloured: green=rise, red=fall, black=flat (±0.2 abs)
   • Hover tooltip showing exact value + date                           */
function drawSparklines() {
  document.querySelectorAll(".fgc-sparkline").forEach(canvas => {
    if (canvas._sparklineInit) return; // already set up
    canvas._sparklineInit = true;

    const raw    = canvas.dataset.values || "";
    const labels = (canvas.dataset.labels || "").split("|").map(s => s.trim());
    const values = raw.split(",").map(v => parseFloat(v)).filter(v => Number.isFinite(v));
    if (!values.length) return;

    function redraw(hoverIdx) {
      const W = canvas.offsetWidth  || 220;
      const H = canvas.offsetHeight || 120;
      if (W === 0 || H === 0) return;

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // ── Layout ────────────────────────────────────────────
      const TICK_COLOR = "#9ca3af";
      const GRID_COLOR = "rgba(255,255,255,0.08)";
      const FONT_SM    = "9.5px system-ui,sans-serif";
      const FONT_TITLE = "bold 9px system-ui,sans-serif";
      const Y_LABEL_W  = 52;   // enough for "XX.XX g/kg"
      const X_LABEL_H  = 15;
      const TITLE_H    = 14;   // space reserved at top for title

      const pad = { top: TITLE_H + 4, right: 8, bottom: X_LABEL_H, left: Y_LABEL_W };
      const iW  = W - pad.left - pad.right;
      const iH  = H - pad.top  - pad.bottom;

      // ── Y range (30 % padding) ─────────────────────────────
      const dMin  = Math.min(...values);
      const dMax  = Math.max(...values);
      const range = Math.max(dMax - dMin, 0.5);
      const rPad  = Math.max(range * 0.30, 0.5);
      const yMin  = Math.max(0, dMin - rPad);
      const yMax  = dMax + rPad;
      const yRange = yMax - yMin;

      const toX = i => {
        const X_PAD = 12; // inner margin on each side so line doesn't touch edge
        if (values.length === 1) return pad.left + iW / 2;
        return pad.left + X_PAD + (i / (values.length - 1)) * (iW - X_PAD * 2);
      };
      const toY = v => pad.top + iH - ((v - yMin) / yRange) * iH;

      // ── Chart title (centred over plot area) ──────────────
      ctx.font      = FONT_TITLE;
      ctx.fillStyle = TICK_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(uiText("oc_over_time"), pad.left + iW / 2, 3);

      // ── Y gridlines + labels ───────────────────────────────
      ctx.font = FONT_SM;
      const yTicks = [yMin + yRange * 0.2, yMin + yRange * 0.8];
      yTicks.forEach(tv => {
        const y = toY(tv);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + iW, y);
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth   = 1;
        ctx.stroke();

        ctx.textAlign    = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle    = TICK_COLOR;
        ctx.fillText(tv.toFixed(2) + " g/kg", pad.left - 3, y);
      });

      // ── X baseline ────────────────────────────────────────
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top + iH);
      ctx.lineTo(pad.left + iW, pad.top + iH);
      ctx.strokeStyle = "rgba(156,163,175,0.25)";
      ctx.lineWidth   = 1;
      ctx.stroke();

      // ── X date labels (first + last) ──────────────────────
      if (labels.length >= values.length && values.length >= 1) {
        ctx.font         = FONT_SM;
        ctx.textBaseline = "top";
        ctx.fillStyle    = TICK_COLOR;
        const fmt = s => s ? s.slice(5) : ""; // "MM-DD"
        ctx.textAlign = "left";
        ctx.fillText(fmt(labels[0]), pad.left, pad.top + iH + 3);
        if (values.length > 1) {
          ctx.textAlign = "right";
          ctx.fillText(fmt(labels[values.length - 1]), pad.left + iW, pad.top + iH + 3);
        }
      }

      // ── Gradient fill (neutral green) ─────────────────────
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + iH);
      grad.addColorStop(0, "rgba(95,167,100,0.18)");
      grad.addColorStop(1, "rgba(95,167,100,0.00)");
      ctx.beginPath();
      values.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
      ctx.lineTo(toX(values.length - 1), pad.top + iH);
      ctx.lineTo(toX(0), pad.top + iH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // ── Coloured line segments ─────────────────────────────
      // Threshold: 0.2 absolute change → flat (black)
      const FLAT_ABS = 0.2;
      for (let i = 0; i < values.length - 1; i++) {
        const diff  = values[i + 1] - values[i];
        const color = diff >  FLAT_ABS ? "#22c55e"
                    : diff < -FLAT_ABS ? "#ef4444"
                    : "#6b7280";

        ctx.beginPath();
        ctx.moveTo(toX(i),     toY(values[i]));
        ctx.lineTo(toX(i + 1), toY(values[i + 1]));
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2.5;
        ctx.lineJoin    = "round";
        ctx.lineCap     = "round";
        ctx.stroke();
      }

      // ── Dots ──────────────────────────────────────────────
      values.forEach((v, i) => {
        const isHover = (i === hoverIdx);
        ctx.beginPath();
        ctx.arc(toX(i), toY(v), isHover ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle   = "transparent";
        ctx.fill();
        ctx.strokeStyle = isHover ? "rgba(107, 114, 128, 0.9)" : "rgba(107, 114, 128, 0.55)";
        ctx.lineWidth   = 2;
        ctx.stroke();
      });

      // ── Hover tooltip ──────────────────────────────────────
      if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < values.length) {
        const tx   = toX(hoverIdx);
        const ty   = toY(values[hoverIdx]);
        const text = `${values[hoverIdx].toFixed(2)} g/kg`;
        const dateText = labels[hoverIdx] || "";
        const fullText = dateText ? `${dateText}: ${text}` : text;

        ctx.font = "bold 10px system-ui,sans-serif";
        const tw = ctx.measureText(fullText).width;
        const bPad = 5;
        const bW = tw + bPad * 2;
        const bH = 18;
        let bx = tx - bW / 2;
        let by = ty - bH - 8;
        // keep inside canvas
        bx = Math.max(pad.left, Math.min(bx, W - pad.right - bW));
        by = Math.max(2, by);

        ctx.fillStyle = "rgba(31,41,55,0.92)";
        ctx.beginPath();
        ctx.roundRect(bx, by, bW, bH, 4);
        ctx.fill();

        ctx.fillStyle    = "#f9fafb";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fullText, bx + bW / 2, by + bH / 2);
      }
    }

    // Initial draw
    redraw(null);

    // ── Hover interaction ──────────────────────────────────────
    function getHoverIndex(e) {
      const rect   = canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const W      = canvas.offsetWidth  || 220;
      const Y_LABEL_W = 52;
      const X_LABEL_H = 15;
      const TITLE_H   = 14;
      const X_PAD     = 12;
      const pad = { left: Y_LABEL_W, right: 8, top: TITLE_H + 4, bottom: X_LABEL_H };
      const iW  = W - pad.left - pad.right;

      let closest = null, minDist = Infinity;
      values.forEach((_, i) => {
        const x = values.length > 1
          ? pad.left + X_PAD + (i / (values.length - 1)) * (iW - X_PAD * 2)
          : pad.left + iW / 2;
        const d = Math.abs(mx - x);
        if (d < minDist) { minDist = d; closest = i; }
      });
      return minDist < 24 ? closest : null;
    }

    canvas.addEventListener("mousemove", e => {
      const idx = getHoverIndex(e);
      canvas.style.cursor = idx != null ? "crosshair" : "default";
      redraw(idx);
    });
    canvas.addEventListener("mouseleave", () => {
      canvas.style.cursor = "default";
      redraw(null);
    });
  });
}

/* ══════════════════════════════════════════════════
   EVENT DELEGATION
══════════════════════════════════════════════════ */

function onCardClick(e) {
  // Only the "Click to explore" button opens the field modal
  const exploreBtn = e.target.closest(".fgc-explore-btn");
  if (exploreBtn) {
    e.stopPropagation();
    openFieldModal(decodeURIComponent(exploreBtn.dataset.field));
    return;
  }
  // Checkbox / label — handled by onCardChange, no modal
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

  const fieldArea = `${latest.field_area_ha.toFixed(2)} ha`;

  const datapoints =
    Array.isArray(latest.zones)
      ? latest.zones.length
      : 0;

  document.getElementById("field-stat-count").textContent  = items.length;

  document.getElementById("field-stat-min").textContent =
    fieldArea;

  document.getElementById("field-stat-max").textContent =
    datapoints;

  document.getElementById("field-stat-latest").textContent =
    formatOcGkg(latest.avg_value);
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

  document.getElementById("field-new-analysis-btn").onclick = () => {
    const prefill = {
      polygon:       latest.polygon       || [],
      field_name:    latest.field_name    || fieldName,
      location_name: latest.location_name || "",
      crop:          latest.crop          || "",
    };
    sessionStorage.setItem("dashboard_prefill", JSON.stringify(prefill));

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
  const canvas = document.getElementById("field-line-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (fieldLineChart) fieldLineChart.destroy();
 
  const rawLabels = items.map(a => a.date || "");
  const { labels, datasets } = padChart(rawLabels, [
    { label: "Max", data: items.map(a => roundOc(a.max_value)), tension: 0,
      borderColor: "rgba(107,114,128,0.55)", backgroundColor: "transparent",
      pointBorderColor: "rgba(107,114,128,0.55)", pointBackgroundColor: "transparent", pointBorderWidth: 2 },
    { label: "Avg", data: items.map(a => roundOc(a.avg_value)), tension: 0,
      borderColor: "rgba(107,114,128,0.55)", backgroundColor: "transparent",
      pointBorderColor: "rgba(107,114,128,0.55)", pointBackgroundColor: "transparent", pointBorderWidth: 2 },
    { label: "Min", data: items.map(a => roundOc(a.min_value)), tension: 0,
      borderColor: "rgba(107,114,128,0.55)", backgroundColor: "transparent",
      pointBorderColor: "rgba(107,114,128,0.55)", pointBackgroundColor: "transparent", pointBorderWidth: 2 },
  ]);
 
  fieldLineChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      animation: false,
      interaction: {
        mode:      "nearest",   // ← nur das nächste Dataset
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              // Datum + Feldname als Titel
              const item = items[0];
              const date = item?.label || "";
              const field = item?.dataset?.label || "";
              return `${field}  ·  ${date}`;
            },
            label: (item) =>
              ` ${item.raw != null ? Number(item.raw).toFixed(2) + " g/kg" : "–"}`,
          },
        },
      },
      scales: {
        y: ocYAxisOptions(datasets.flatMap(d => d.data)),
        x: xAxisOpts(),
      },
      onHover: (event, _elements, chart) => {
        if (chart._lockedDataset !== null && chart._lockedDataset !== undefined) return;
        const idx = getNearestDatasetIndex(chart, event.native || event);
        chart._hoveredDataset = idx;
        chart.update("none");
      },
    },
    plugins: [unifiedChartPlugin],
  });
 
  // Maus verlässt Canvas → Hover zurücksetzen
  canvas.addEventListener("mouseleave", () => {
    if (fieldLineChart) {
      fieldLineChart._hoveredDataset = null;
      fieldLineChart.update("none");
    }
  });
 
  // Klick → Lock umschalten
  canvas.addEventListener("click", (e) => {
    e.stopPropagation();
    const idx = getNearestDatasetIndex(fieldLineChart, e);
    toggleDatasetLock(fieldLineChart, idx);
    fieldLineChart._hoveredDataset = null;
    fieldLineChart.update("none");
  });
 
  // Mausbewegung → Hover aktualisieren
  canvas.addEventListener("mousemove", (e) => {
    if (!fieldLineChart) return;
    const idx = getNearestDatasetIndex(fieldLineChart, e);
    // Immer hoveredDataset aktualisieren, auch wenn locked
    if (idx !== fieldLineChart._hoveredDataset) {
      fieldLineChart._hoveredDataset = idx;
      fieldLineChart.update("none");
    }
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
        <button class="btn-secondary field-detail-btn"   data-id="${a.id}">${uiText("details")}</button>
        <button class="btn-secondary field-download-btn btn-tooltip" data-tooltip="${uiText("download_csv")}" data-id="${a.id}">⬇</button>
        <button class="btn-danger    field-delete-btn"   data-id="${a.id}">${uiText("delete")}</button>
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
  if (!confirm(uiText("delete_confirm"))) return;
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
    alert(uiText("delete_failed", { msg: err.message }));
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

  const toggleBtn = document.getElementById("toggle-filters");
  if (toggleBtn) {
    toggleBtn.textContent = active
      ? uiText("filters_active")
      : uiText("filters");
  }

  const filteredFields = Object.keys(groupByField(filtered)).length;
  const totalFields    = Object.keys(groupByField(allAnalyses)).length;
  const parts = [];
  if (name) parts.push(uiText("filter_name", { val: escapeHtml(name) }));
  if (crop) parts.push(uiText("filter_crop", { val: escapeHtml(crop) }));
  if (from) parts.push(uiText("filter_from", { val: escapeHtml(from) }));
  if (to)   parts.push(uiText("filter_to", { val: escapeHtml(to) }));

  el.innerHTML = uiText("filter_summary", {
    shown: filteredFields,
    total: totalFields,
    parts: parts.join(", "),
  });
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
  if (selectedForCompare.size === 0) return;

  // Wrapper + Canvas dynamisch erstellen falls nicht vorhanden
  let wrapper = document.getElementById("compare-chart-wrapper");
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.id = "compare-chart-wrapper";
    wrapper.style.cssText = "margin-top:24px; padding:20px; border-radius:12px;";

    const canvas = document.createElement("canvas");
    canvas.id = "compare-chart";
    canvas.style.height = "320px";
    wrapper.appendChild(canvas);

    // Nach dem dashboard-container einfügen
    const container = document.getElementById("dashboard-container");
    container?.parentNode.insertBefore(wrapper, container);
  }

  wrapper.style.display = "";

  const canvas = document.getElementById("compare-chart");
  const ctx = canvas.getContext("2d");
  if (compareChart) compareChart.destroy();

  const allDates   = new Set();
  const fieldItems = {};

  selectedForCompare.forEach(fieldName => {
    const items = allAnalyses
      .filter(a => fieldKey(a) === fieldName)
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    fieldItems[fieldName] = items;
    items.forEach(i => { if (i.date) allDates.add(i.date); });
  });

  // Gemeinsames Zeitraster aus allen Feldern
  const sortedDates = Array.from(allDates).sort();

  // Jeden Feldwert exakt auf seinen Datumsplatz mappen — fehlende Daten = null
  const rawDatasets = [];
  selectedForCompare.forEach(fieldName => {
    const byDate = {};
    fieldItems[fieldName].forEach(i => {
      if (i.date) byDate[i.date] = roundOc(i.avg_value);
    });
    rawDatasets.push({
      label:    fieldName,
      data:     sortedDates.map(d => byDate[d] ?? null),
      spanGaps: true,
      tension:  0,
      fill:     false,
      borderColor:          "rgba(107,114,128,0.55)",
      backgroundColor:      "transparent",
      pointBorderColor:     "rgba(107,114,128,0.55)",
      pointBackgroundColor: "transparent",
      pointBorderWidth:     2,
    });
  });

  const { labels, datasets } = padChart(sortedDates, rawDatasets);

  compareChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      animation: false,
      interaction: {
        mode:      "nearest",   // ← nur das nächste Dataset
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              // Datum + Feldname als Titel
              const item = items[0];
              const date = item?.label || "";
              const field = item?.dataset?.label || "";
              return `${field}  ·  ${date}`;
            },
            label: (item) =>
              ` ${item.raw != null ? Number(item.raw).toFixed(2) + " g/kg" : "–"}`,
          },
        },
      },
      scales: {
        y: ocYAxisOptions(datasets.flatMap(d => d.data)),
        x: xAxisOpts(),
      },
      onHover: (event, _elements, chart) => {
        if (chart._lockedDataset !== null && chart._lockedDataset !== undefined) return;
        const idx = getNearestDatasetIndex(chart, event.native || event);
        chart._hoveredDataset = idx;
        chart.update("none");
      },
    },
    plugins: [unifiedChartPlugin],
  });

  // Event Listener nur einmalig registrieren
  if (!canvas._compareListenersAttached) {
    canvas._compareListenersAttached = true;

    canvas.addEventListener("mouseleave", () => {
      if (compareChart) {
        compareChart._hoveredDataset = null;
        compareChart.update("none");
      }
    });

    canvas.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = getNearestDatasetIndex(compareChart, e);
      toggleDatasetLock(compareChart, idx);
      compareChart._hoveredDataset = null;
      compareChart.update("none");
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!compareChart) return;
      const idx = getNearestDatasetIndex(compareChart, e);
      // Immer hoveredDataset aktualisieren, auch wenn locked
      if (idx !== compareChart._hoveredDataset) {
        compareChart._hoveredDataset = idx;
        compareChart.update("none");
      }
    });
  }
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
  document.getElementById("Date-of-Analysis").value = item.date         || "";

  document.getElementById("detail-avg").textContent = formatOcGkg(item.avg_value);
  document.getElementById("detail-min").textContent = formatOcGkg(item.min_value);
  document.getElementById("detail-max").textContent = formatOcGkg(item.max_value);

  document.getElementById("detail-modal").style.display = "flex";

  if (typeof L === "undefined") return;

  destroyDetailMap();
    document.getElementById("detail-modal").style.display = "flex";

    setTimeout(() => {
      renderDetailMap(item);
    }, 50);
}

function destroyDetailMap() {
  if (detailMapInvalidateTimer) {
    clearTimeout(detailMapInvalidateTimer);
    detailMapInvalidateTimer = null;
  }
  if (detailMap) {
    try {
      detailMap.remove();
    } catch (_e) {
      /* ignore */
    }
    detailMap = null;
  }
  const mount = document.getElementById("detail-map");
  if (mount) mount.innerHTML = "";
}

window.closeDetailModal = function () {
  document.getElementById("detail-modal").style.display = "none";
  if (qualityChart) { qualityChart.destroy(); qualityChart = null; }
  destroyDetailMap();
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
    alert(uiText("save_failed", { msg: err.message }));
  }
}

/* ── Mini satellite map ──────────────────────────── */

function renderDetailMap(item) {
  const container = document.getElementById("detail-map");
  if (!container) return;

  destroyDetailMap();

  const zones   = item.zones   || [];
  const polygon = item.polygon || [];

  if (!polygon.length && !zones.length) {
    if (container.parentElement)
      container.parentElement.style.display = "none";
    return;
  }
  if (container.parentElement) container.parentElement.style.display = "";

  detailMap = L.map(container, {
    zoomControl:        true,
    attributionControl: false,
    scrollWheelZoom:    true,
    preferCanvas:       true,
  });

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri" }
  ).addTo(detailMap);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { opacity: 0.8 }
  ).addTo(detailMap);

  const bounds = [];

const viz = FieldGradientOverlay.addFieldVisualization({
  map: detailMap,
  polygon,
  zones,
  classification: ocClassification,
  valueToColor: valueToColor,   // 👈 WICHTIG
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

  function scheduleInvalidate() {
    if (!detailMap) return;
    detailMap.invalidateSize();
    detailMap.invalidateSize(false);
    if (bounds.length)
      detailMap.fitBounds(bounds.reduce((acc, b) => acc.extend(b), bounds[0].pad(0)), {
        padding: [24, 24],
      });
  }

  requestAnimationFrame(scheduleInvalidate);
  detailMapInvalidateTimer = setTimeout(scheduleInvalidate, 200);
}

function sortGroups(groups, mode) {
  const entries = Object.entries(groups);

  const enriched = entries.map(([name, items]) => {
    const metrics = computeFieldMetrics(items);
    return { name, items, metrics };
  }).filter(x => x.metrics);

  switch (mode) {
    case "latest":
      enriched.sort((a, b) => b.metrics.latest - a.metrics.latest);
      break;

    case "best":
      enriched.sort((a, b) => b.metrics.avg - a.metrics.avg);
      break;

    case "worst":
      enriched.sort((a, b) => a.metrics.avg - b.metrics.avg);
      break;

    case "trend":
      enriched.sort((a, b) => b.metrics.trend - a.metrics.trend);
      break;
  }

  return enriched;
}

/* ══════════════════════════════════════════════════
   GLOBAL OVERVIEW MAP
══════════════════════════════════════════════════ */
let globalOverviewMap = null;

function renderGlobalOverviewMap(analyses) {
  const container = document.getElementById("global-overview-map");
  if (!container) return;

  if (!globalOverviewMap) {
    globalOverviewMap = L.map(container, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: true,
      preferCanvas: true,
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles © Esri" }
    ).addTo(globalOverviewMap);
  }

  // Bereits eingezeichnete Layer entfernen, um Duplikate zu vermeiden
  globalOverviewMap.eachLayer((layer) => {
    if (!layer._url) globalOverviewMap.removeLayer(layer);
  });

  const bounds = [];
  const drawnFields = new Set();

  analyses.forEach(item => {
    if (!item.polygon || drawnFields.has(item.field_name)) return;
    drawnFields.add(item.field_name);

    // Nutzt das bereits importierte FieldGradientOverlay
    const viz = FieldGradientOverlay.addFieldVisualization({
      map: globalOverviewMap,
      polygon: item.polygon,
      zones: item.zones || [],
      classification: ocClassification,
      valueToColor: valueToColor,
      formatTooltip: (zone) =>
        `<b>${item.field_name}</b><br>OC: ${Number(zone.value).toFixed(1)} g/kg`,
    });

    if (viz.borderLayer) {
      bounds.push(viz.borderLayer.getBounds());
      // Optional: Tooltip mit Feldnamen direkt auf dem Polygon
      viz.borderLayer.bindTooltip(`<b>${item.field_name}</b>`, { direction: 'center', permanent: false });
    } else if (item.polygon.length >= 3) {
      bounds.push(L.latLngBounds(item.polygon.map(p => [p.lat, p.lng])));
    }
  });

  if (bounds.length) {
    const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0].pad(0));
    globalOverviewMap.fitBounds(combined, { padding: [24, 24] });
  }
}