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

const EVENT_TYPE_ICONS = {
  planting:    "🌱",
  fertilizing: "🌿",
  tillage:     "🚜",
  harvest:     "🌾",
  irrigation:  "💧",
  pesticide:   "🧪",
  other:       "📝",
};

function eventIcon(type) {
  return EVENT_TYPE_ICONS[type] || "📝";
}

function formatEventTypeName(type) {
  if (!type) return "Event";
  return type.charAt(0).toUpperCase() + type.slice(1);
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
    title: {
      display: true,
      text: "OC (g/kg)",
      color: dark ? "#9ca3af" : "#6b7280",
      font: { size: 11 },
    },
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
  const pLabels = ["", ...labels, "", ""];
  const pDatasets = datasets.map(ds => ({
    ...ds,
    data: [null, ...ds.data, null, null],
    spanGaps: true,
  }));
  return { labels: pLabels, datasets: pDatasets };
}

/** X pixel for an event/analysis date on the compare chart (interpolates between labels). */
function getCompareChartDateX(chart, dateStr) {
  const xScale = chart.scales.x;
  if (!xScale || !dateStr) return null;

  const labels = chart.data.labels || [];
  const points = [];
  labels.forEach((label, idx) => {
    if (!label) return;
    const t = new Date(label).getTime();
    if (!Number.isNaN(t)) points.push({ idx, t, label });
  });
  if (!points.length) return null;

  const eventT = new Date(dateStr).getTime();
  if (Number.isNaN(eventT)) return null;

  const exact = points.find(p => p.label === dateStr);
  if (exact) return xScale.getPixelForValue(exact.idx);

  if (eventT <= points[0].t) return xScale.getPixelForValue(points[0].idx);
  if (eventT >= points[points.length - 1].t) {
    return xScale.getPixelForValue(points[points.length - 1].idx);
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (eventT >= a.t && eventT <= b.t) {
      const ratio = (eventT - a.t) / (b.t - a.t);
      const xA = xScale.getPixelForValue(a.idx);
      const xB = xScale.getPixelForValue(b.idx);
      return xA + ratio * (xB - xA);
    }
  }
  return null;
}

function isChartDatasetVisible(chart, i) {
  const meta = chart.getDatasetMeta(i);
  if (!meta) return false;
  if (typeof chart.isDatasetVisible === "function") return chart.isDatasetVisible(i);
  return !meta.hidden;
}

function drawCompareChartEventDecorations(chart, ctx, { labelsOnly = false } = {}) {
  const eventAnnotations = chart._eventAnnotations;
  if (!eventAnnotations?.length) return;

  const locked   = chart._lockedDataset;
  const hovered  = chart._hoveredDataset;
  const focused  = locked ?? hovered;
  const hasFocus = focused !== null && focused !== undefined;
  const focusedLabel = hasFocus ? chart.data.datasets[focused]?.label : null;

  const xScale = chart.scales.x;
  const yScale = chart.scales.y;
  if (!xScale || !yScale) return;

  const chartTop    = yScale.top;
  const chartBottom = yScale.bottom;
  const chartLeft   = xScale.left;
  const chartRight  = xScale.right;

  ctx.save();

  eventAnnotations.forEach((ann) => {
    if (chart._hiddenFields?.has(ann._fieldName)) return;

    const xPixel = getCompareChartDateX(chart, ann.value);
    if (xPixel == null || xPixel < chartLeft || xPixel > chartRight) return;

    const isOwn = !hasFocus || ann._fieldName === focusedLabel;

    if (!labelsOnly && isOwn) {
      ctx.beginPath();
      ctx.moveTo(xPixel, chartTop);
      ctx.lineTo(xPixel, chartBottom);
      ctx.strokeStyle = hasFocus ? "#4A90E2" : "rgba(74,144,226,0.55)";
      ctx.lineWidth   = hasFocus ? 1.5 : 1;
      ctx.setLineDash(hasFocus ? [] : [4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (!labelsOnly && hasFocus && !isOwn) {
      ctx.beginPath();
      ctx.moveTo(xPixel, chartTop);
      ctx.lineTo(xPixel, chartBottom);
      ctx.strokeStyle = "rgba(156,163,175,0.12)";
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (labelsOnly && isOwn) {
      const peers = eventAnnotations
        .filter(a =>
          a.value === ann.value &&
          !chart._hiddenFields?.has(a._fieldName) &&
          (!hasFocus || a._fieldName === focusedLabel)
        )
        .sort((a, b) => (a._fieldName || "").localeCompare(b._fieldName || ""));
      const slot  = Math.max(0, peers.indexOf(ann));
      const yPos  = chartTop - 10 - slot * 22;
      const xPos  = xPixel + 8 + slot * 12;

      ctx.save();
      ctx.translate(xPos, yPos);
      ctx.rotate(-Math.PI / 6);
      ctx.fillStyle    = hasFocus ? "#4A90E2" : "rgba(74,144,226,0.9)";
      ctx.font         = hasFocus
        ? "bold 10px system-ui, sans-serif"
        : "500 10px system-ui, sans-serif";
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillText(ann.content, 0, 0);
      ctx.restore();
    }
  });

  ctx.restore();
}

function buildCompareEventAnnotations(allEvents) {
  const sorted = [...allEvents].sort((a, b) => {
    const byDate = (a.date || "").localeCompare(b.date || "");
    if (byDate !== 0) return byDate;
    return (a.field_name || "").localeCompare(b.field_name || "");
  });

  const slotByDate = {};
  return sorted.map((ev) => {
    const dateKey = ev.date || "";
    const slot    = slotByDate[dateKey] || 0;
    slotByDate[dateKey] = slot + 1;
    return {
      value:      ev.date,
      _fieldName: ev.field_name,
      _slot:      slot,
      content:    `${eventIcon(ev.event_type)} ${formatEventTypeName(ev.event_type)}`,
    };
  });
}

function maxEventsOnSameDate(annotations) {
  const counts = {};
  annotations.forEach(a => {
    const key = a.value || "";
    counts[key] = (counts[key] || 0) + 1;
  });
  return Math.max(0, ...Object.values(counts));
}

function getCachedFieldEvents(fieldNames) {
  return fieldNames.flatMap(name =>
    (fieldEventsCache[name] || []).map(ev => ({
      ...ev,
      field_name: ev.field_name || name,
    }))
  );
}

/* ── Shared x-axis options for line charts ────────── */
function xAxisOpts({ dark = true } = {}) {
  return {
    title: {
      display: true,
      text: "Date",
      color: dark ? "#9ca3af" : "#6b7280",
      font: { size: 11 },
    },
    grid: { display: false },
    ticks: {
      color: dark ? "#9ca3af" : undefined,
      maxRotation: 30,
      callback: function(val) {
        const label = this.getLabelForValue(val);
        if (!label) return "";
        return label;
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
    if (!isChartDatasetVisible(chart, i)) return;
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

function formatEventCountLabel(count) {
  const n = Number(count) || 0;
  return n === 1 ? uiText("one_event") : uiText("n_events", { n });
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
    if (compareChart && compareChart._lockedDataset !== null) {
      compareChart._lockedDataset = null;
      compareChart._hoveredDataset = null;
      compareChart.update("none");
    }
  }
});

const unifiedChartPlugin = {
  id: "unifiedChartPlugin",

  beforeDatasetsDraw(chart) {
    const locked   = chart._lockedDataset;
    const hovered  = chart._hoveredDataset;
    const focused  = locked ?? hovered;
    const hasFocus = focused !== null && focused !== undefined;

    const fgColor = getComputedStyle(chart.canvas)
      .getPropertyValue("--color-text-primary").trim() || "#111827";

    chart.data.datasets.forEach((ds, i) => {
      const isActive = (focused === i);

      if (!hasFocus || isActive) {
        // Kein Focus: alle gleich — Focus: aktives Dataset hervorgehoben
        const color = (hasFocus && isActive) ? fgColor : "rgba(107, 114, 128, 0.55)";
        const width = (hasFocus && isActive) ? 2.5 : 1.5;
        const radius = (hasFocus && isActive) ? 4 : 3;

        ds.borderColor          = color;
        ds.borderWidth          = width;
        ds.pointRadius          = radius;
        ds.pointHoverRadius     = radius + 2;
        ds.pointBackgroundColor = "transparent";
        ds.pointBorderColor     = color;
        ds.pointBorderWidth     = 2;
        ds.pointHoverBackgroundColor = color;
        ds.pointHoverBorderColor     = color;
        ds.pointHoverBorderWidth     = 2;
      } else {
        // Dimmed: gleiche Farbe wie normal, nur etwas dünner
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

  afterDatasetsDraw(chart) {
    const { ctx }  = chart;
    const locked   = chart._lockedDataset;
    const hovered  = chart._hoveredDataset;
    const focused  = locked ?? hovered;
    const hasFocus = focused !== null && focused !== undefined;

    const fgColor = getComputedStyle(chart.canvas)
      .getPropertyValue("--color-text-primary").trim() || "#111827";

    // ── Dataset end-labels ─────────────────────────
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.font         = "500 11px system-ui, sans-serif";

    chart.data.datasets.forEach((ds, i) => {
      if (!isChartDatasetVisible(chart, i)) return;
      const meta = chart.getDatasetMeta(i);
      if (!meta?.data?.length) return;

      let lastPoint = null;
      for (let j = ds.data.length - 1; j >= 0; j--) {
        if (ds.data[j] != null) { lastPoint = meta.data[j]; break; }
      }
      if (!lastPoint) return;

      const isActive = (focused === i);
      const isDimmed = hasFocus && !isActive;

      ctx.fillStyle = (hasFocus && isActive)
        ? fgColor
        : "rgba(107, 114, 128, 0.6)";

      ctx.fillText(ds.label || "", lastPoint.x + 10, lastPoint.y);
    });

    ctx.restore();

    drawCompareChartEventDecorations(chart, ctx, { labelsOnly: false });
  },

  afterDraw(chart) {
    drawCompareChartEventDecorations(chart, chart.ctx, { labelsOnly: true });
  },
};

function toggleCustomEventType(value) {
  const wrapper = document.getElementById("event-custom-type-wrapper");
  if (!wrapper) return;
  wrapper.style.display = value === "other" ? "" : "none";
  if (value !== "other") {
    document.getElementById("event-custom-type").value = "";
  }
}

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
  initCompareToggle();
  initEventModal();
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
    const eventsLabel = fieldEventsCache[name] !== undefined
      ? formatEventCountLabel(fieldEventsCache[name].length)
      : "…";

    // Sparkline data
    const sparkItems = items.filter(i => parseOc(i.avg_value) != null);
    const sparkData  = sparkItems.map(i => parseOc(i.avg_value));
    const sparkDates = sparkItems.map(i => i.date || "");

    return `
      <div class="analysis-card field-group-card" data-field="${safeField}">

        <div class="fgc-main">
          <div class="fgc-info">
            <div class="analysis-title">
              ${fieldIndexMap[name] ?? "–"}. ${escapeHtml(name)}
            </div>
            <div class="fgc-meta-list">
              <span>📅 ${dateRange}</span>
              ${latest.location_name ? `<span>📍 ${escapeHtml(latest.location_name)}</span>` : ""}
              ${latest.field_area_ha != null ? `<span>🗺 ${Number(latest.field_area_ha).toFixed(2)} ha</span>` : ""}
              ${Array.isArray(latest.zones) && latest.zones.length ? `<span>📊 ${latest.zones.length} ${uiText("Data points") || "data points"}</span>` : ""}
            </div>
          </div>

          <div class="fgc-chart">
            <canvas class="fgc-sparkline"
                    data-values="${sparkData.join(",")}"
                    data-labels="${sparkDates.join("|")}"></canvas>
          </div>

          <div class="fgc-actions">
            <div class="fgc-latest">
              <span class="fgc-latest-label">${uiText("latest_avg_oc")}</span>
              <span class="fgc-latest-value">${formatOcGkg(latest.avg_value)}</span>
              <span class="fgc-latest-label">${uiText("current_vs")}</span>
              ${trendBadge(trendAllTime, uiText("first_sample"))}
              ${trendBadge(trendPrev, uiText("recent_sample"))}
            </div>
            <div class="fgc-buttons">
              <button class="fgc-explore-btn fgc-new-analysis-btn"
                      data-field="${safeField}"
                      data-location="${escapeHtml(latest.location_name || "")}"
                      data-crop="${escapeHtml(latest.crop || "")}"
                      data-polygon="${encodeURIComponent(JSON.stringify(latest.polygon || []))}">
                ${uiText("+ New Analysis")}
              </button>
              <button class="fgc-add-event-btn" data-field="${safeField}">
                📋 Add Event
              </button>
            </div>
          </div>
        </div>

        <!-- ── Footer: toggle für Analyses + Events ── -->
        <button class="fgc-combined-toggle" data-field="${safeField}">
          <span class="fgc-analyses-toggle-label">
            ${items.length === 1 ? uiText("one_analysis") : uiText("n_analyses", { n: items.length })}
          </span>
          <span class="fgc-combined-toggle-sep">·</span>
          <span class="fgc-events-count-label" data-field="${safeField}">${eventsLabel}</span>
          <span class="fgc-toggle-trailing">
            <span class="fgc-toggle-hint">${uiText("click_to_see_analyses_events")}</span>
            <span class="fgc-field-download-btn" data-field="${safeField}" role="button" tabindex="0">
              ⬇ ${uiText("download_field_data")}
            </span>
            <span class="fgc-analyses-chevron">▾</span>
          </span>
        </button>

        <!-- ── Stacked body: Analyses, then Events ── -->
        <div class="fgc-combined-body" data-field="${safeField}">
          <div class="fgc-section-header">${uiText("analyses_section")}</div>
          ${[...items].reverse().map(a => `
            <div class="fgc-list-row fgc-analysis-row">
              <div class="fgc-list-row-main">
                <span class="fgc-list-date">${escapeHtml(a.date || "–")}</span>
                ${a.crop ? `<span class="fgc-list-meta">${getCropDisplay(a.crop)}</span>` : ""}
                <div class="row-badges">
                  <span class="badge-min" title="Min">${formatOcGkg(a.min_value)}</span>
                  <span class="badge-avg" title="Avg">${formatOcGkg(a.avg_value)}</span>
                  <span class="badge-max" title="Max">${formatOcGkg(a.max_value)}</span>
                </div>
              </div>
              <div class="fgc-row-actions">
                <button class="btn-secondary fgc-detail-btn" data-id="${a.id}">${uiText("details")}</button>
                <button class="btn-danger    fgc-delete-btn" data-id="${a.id}">${uiText("delete")}</button>
              </div>
            </div>
          `).join("")}
          <div class="fgc-section-header fgc-section-header--events">${uiText("events_section")}</div>
          <div class="fgc-events-list" data-field="${safeField}">
            <p class="event-list-loading">Loading…</p>
          </div>
        </div>

      </div>
    `;
  }).join("");

  // Draw sparklines after DOM update
  requestAnimationFrame(() => drawSparklines());
  refreshFieldEventCountLabels(sortedGroups.map(g => g.name));
}

/* ── Draw mini sparkline on each .fgc-sparkline canvas ──
   • Y-axis labels fully visible (wider left pad)
   • Chart title drawn inside canvas top-left
   • Line segments coloured: green=rise, red=fall, black=flat (±0.2 abs)
   • Hover tooltip showing exact value + date                           */
async function drawSparklines() {
  const allCards = document.querySelectorAll(".fgc-sparkline");
  
  for (const canvas of allCards) {
    if (canvas._sparklineInit) continue;
    canvas._sparklineInit = true;

    const raw      = canvas.dataset.values || "";
    const labels   = (canvas.dataset.labels || "").split("|").map(s => s.trim());
    const values   = raw.split(",").map(v => parseFloat(v)).filter(v => Number.isFinite(v));
    if (!values.length) continue;

    // Feldname aus der Card holen
    const card      = canvas.closest(".field-group-card");
    const safeField = card?.dataset.field || "";
    const fieldName = safeField ? decodeURIComponent(safeField) : "";

    // Events laden (aus Cache oder API)
    const events = fieldName ? await fetchFieldEvents(fieldName) : [];

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

      const TICK_COLOR = "#9ca3af";
      const FONT_SM    = "9.5px system-ui,sans-serif";
      const FONT_TITLE = "bold 9px system-ui,sans-serif";
      const Y_LABEL_W  = 52;
      const X_LABEL_H  = 15;
      const TITLE_H    = 14;

      const pad = { top: TITLE_H + 4, right: 8, bottom: X_LABEL_H, left: Y_LABEL_W };
      const iW  = W - pad.left - pad.right;
      const iH  = H - pad.top  - pad.bottom;

      const dMin  = Math.min(...values);
      const dMax  = Math.max(...values);
      const range = Math.max(dMax - dMin, 0.5);
      const rPad  = Math.max(range * 0.30, 0.5);
      const yMin  = Math.max(0, dMin - rPad);
      const yMax  = dMax + rPad;
      const yRange = yMax - yMin;

      const X_PAD = 12;
      const toX = i => {
        if (values.length === 1) return pad.left + iW / 2;
        return pad.left + X_PAD + (i / (values.length - 1)) * (iW - X_PAD * 2);
      };
      const toY = v => pad.top + iH - ((v - yMin) / yRange) * iH;

      // Datum → X-Position (für Events)
      const dateToX = (dateStr) => {
        if (!labels.length || values.length < 2) return null;
        const firstDate  = new Date(labels[0]).getTime();
        const lastDate   = new Date(labels[values.length - 1]).getTime();
        const eventDate  = new Date(dateStr).getTime();
        if (isNaN(eventDate) || lastDate === firstDate) return null;
        const ratio = (eventDate - firstDate) / (lastDate - firstDate);
        if (ratio < 0 || ratio > 1) return null;
        return pad.left + X_PAD + ratio * (iW - X_PAD * 2);
      };

      // ── Chart title ──────────────────────────────
      ctx.font         = FONT_TITLE;
      ctx.fillStyle    = TICK_COLOR;
      ctx.textAlign    = "center";
      ctx.textBaseline = "top";
      ctx.fillText(uiText("oc_over_time"), pad.left + iW / 2, 3);

      // ── Y-Axis title ──────────────────────────────
      ctx.save();
      ctx.font         = "9px system-ui,sans-serif";
      ctx.fillStyle    = TICK_COLOR;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.translate(10, pad.top + iH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("OC (g/kg)", 0, 0);
      ctx.restore();

      // ── X-Axis title ──────────────────────────────
      ctx.font         = "9px system-ui,sans-serif";
      ctx.fillStyle    = TICK_COLOR;
      ctx.textAlign    = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(uiText("date") || "Date", pad.left + iW / 2, H - 1);

      // ── X baseline ────────────────────────────────
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top + iH);
      ctx.lineTo(pad.left + iW, pad.top + iH);
      ctx.strokeStyle = "rgba(156,163,175,0.25)";
      ctx.lineWidth   = 1;
      ctx.stroke();

      // ── X date labels ─────────────────────────────
      if (labels.length >= values.length && values.length >= 1) {
        ctx.font         = FONT_SM;
        ctx.textBaseline = "top";
        ctx.fillStyle    = TICK_COLOR;
        const fmt = s => s ? s.slice(5) : "";
        ctx.textAlign = "left";
        ctx.fillText(fmt(labels[0]), pad.left, pad.top + iH + 3);
        if (values.length > 1) {
          ctx.textAlign = "right";
          ctx.fillText(fmt(labels[values.length - 1]), pad.left + iW, pad.top + iH + 3);
        }
      }

      // ── Gradient fill ─────────────────────────────
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

      // ── Coloured line segments ─────────────────────
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

      // ── Dots ──────────────────────────────────────
      values.forEach((v, i) => {
        const isHover = (i === hoverIdx);
        ctx.beginPath();
        ctx.arc(toX(i), toY(v), isHover ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle   = "transparent";
        ctx.fill();
        ctx.strokeStyle = isHover ? "rgba(107,114,128,0.9)" : "rgba(107,114,128,0.55)";
        ctx.lineWidth   = 2;
        ctx.stroke();
      });

      // ── Event lines + diagonal labels ─────────────
      events.forEach((ev, idx) => {
        const x = dateToX(ev.date);
        if (x === null) return;

        // Vertikale gestrichelte Linie
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + iH);
        ctx.strokeStyle = "#4A90E2";
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Diagonales Label (rechts oben, gestaffelt)
        const icon    = eventIcon(ev.event_type);
        const label   = `${icon} ${ev.description}`;
        const yStart  = pad.top + 2 + (idx % 3) * 14; // staffeln

        ctx.translate(x + 4, yStart);
        ctx.rotate(-Math.PI / 6); // 30° diagonal nach rechts oben
        ctx.font         = "bold 8px system-ui,sans-serif";
        ctx.fillStyle    = "#4A90E2";
        ctx.textAlign    = "left";
        ctx.textBaseline = "top";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      });

      // ── Hover tooltip ──────────────────────────────
      if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < values.length) {
        const tx   = toX(hoverIdx);
        const ty   = toY(values[hoverIdx]);
        const text = `${values[hoverIdx].toFixed(2)} g/kg`;
        const dateText = labels[hoverIdx] || "";
        const fullText = dateText ? `${dateText}: ${text}` : text;

        ctx.font = "bold 10px system-ui,sans-serif";
        const tw  = ctx.measureText(fullText).width;
        const bPad = 5;
        const bW  = tw + bPad * 2;
        const bH  = 18;
        let bx = tx - bW / 2;
        let by = ty - bH - 8;
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

    redraw(null);

    function getHoverIndex(e) {
      const rect   = canvas.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const W      = canvas.offsetWidth || 220;
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
  }
}

/* ══════════════════════════════════════════════════
   EVENT DELEGATION
══════════════════════════════════════════════════ */

function onCardClick(e) {
  // ── New analysis ──────────────────────────────────
  const newBtn = e.target.closest(".fgc-new-analysis-btn");
  if (newBtn) {
    e.stopPropagation();
    const fieldName = decodeURIComponent(newBtn.dataset.field);
    const prefill = {
      field_name:    fieldName,
      location_name: newBtn.dataset.location || "",
      crop:          newBtn.dataset.crop     || "",
      polygon:       JSON.parse(decodeURIComponent(newBtn.dataset.polygon || "[]")),
    };
    sessionStorage.setItem("dashboard_prefill", JSON.stringify(prefill));
    const p = new URLSearchParams();
    p.set("field", fieldName);
    if (prefill.location_name) p.set("location", prefill.location_name);
    if (prefill.crop)          p.set("crop",     prefill.crop);
    window.location.href = `/analyse?${p.toString()}`;
    return;
  }

  // ── Add Event button (opens modal) ────────────────
  const addEventBtn = e.target.closest(".fgc-add-event-btn");
  if (addEventBtn) {
    e.stopPropagation();
    openEventModal(decodeURIComponent(addEventBtn.dataset.field));
    return;
  }

  // ── Field download (nur wenn Dropdown offen) ─────
  const fieldDownloadBtn = e.target.closest(".fgc-field-download-btn");
  if (fieldDownloadBtn) {
    e.stopPropagation();
    downloadFieldData(decodeURIComponent(fieldDownloadBtn.dataset.field));
    return;
  }

  // ── Combined toggle ───────────────────────────────
  const combinedToggle = e.target.closest(".fgc-combined-toggle");
  if (combinedToggle) {
    e.stopPropagation();
    const field = decodeURIComponent(combinedToggle.dataset.field);
    const body  = document.querySelector(
      `.fgc-combined-body[data-field="${encodeURIComponent(field)}"]`
    );
    const chev  = combinedToggle.querySelector(".fgc-analyses-chevron");
    if (!body) return;

    const isOpen = body.classList.contains("open");

    body.classList.toggle("open", !isOpen);
    combinedToggle.classList.toggle("open", !isOpen);
    if (chev) chev.textContent = isOpen ? "▾" : "▴";

    if (!isOpen) {
      if (!body._bound) {
        body._bound = true;
        body.querySelectorAll(".fgc-detail-btn").forEach(btn =>
          btn.addEventListener("click", ev => {
            ev.stopPropagation();
            const item = allAnalyses.find(a => String(a.id) === btn.dataset.id);
            if (item) openDetailModal(item);
          })
        );
        body.querySelectorAll(".fgc-delete-btn").forEach(btn =>
          btn.addEventListener("click", ev => {
            ev.stopPropagation();
            deleteAnalysisFromCard(btn.dataset.id);
          })
        );
      }
      const eventsListEl = body.querySelector(
        `.fgc-events-list[data-field="${encodeURIComponent(field)}"]`
      );
      if (eventsListEl) loadInlineEvents(field, eventsListEl);
    }
    return;
  }
}

async function deleteAnalysisFromCard(id) {
  if (!confirm(uiText("delete_confirm"))) return;
  try {
    const res = await fetch(`${API_URL}/api/analyses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allAnalyses = allAnalyses.filter(a => String(a.id) !== id);
    applyFilters();
    refreshCropFilter();
    showCompareChart().catch(console.error);
  } catch (err) {
    alert(uiText("delete_failed", { msg: err.message }));
  }
}

async function loadInlineEvents(fieldName, listEl) {
  if (!listEl) return;
  listEl.innerHTML = `<p class="event-list-loading">Loading…</p>`;

  const events = (await fetchFieldEvents(fieldName))
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (!events.length) {
    listEl.innerHTML = `<p class="event-list-empty">No events yet.</p>`;
    return;
  }

  listEl.innerHTML = events.map(ev => {
    const typeName = ev.event_type.charAt(0).toUpperCase() + ev.event_type.slice(1);
    return `
    <div class="fgc-list-row fgc-event-row" data-id="${ev.id}">
      <div class="fgc-list-row-main">
        <span class="fgc-list-date">${escapeHtml(ev.date)}</span>
        <span class="fgc-list-meta">${eventIcon(ev.event_type)} ${escapeHtml(typeName)}${ev.description ? ` — ${escapeHtml(ev.description)}` : ""}</span>
      </div>
      <div class="fgc-row-actions">
        <button class="fgc-event-delete-btn btn-danger"
                data-id="${ev.id}"
                data-field="${encodeURIComponent(fieldName)}">${uiText("delete")}</button>
      </div>
    </div>
  `;
  }).join("");

  listEl.querySelectorAll(".fgc-event-delete-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id    = btn.dataset.id;
      const field = decodeURIComponent(btn.dataset.field);
      try {
        await deleteFieldEvent(id, field);
        await loadInlineEvents(field, listEl);
        updateFieldEventCountLabel(field);
        if (document.getElementById("compare-toggle-body").classList.contains("open")) {
          showCompareChart().catch(console.error);
        }
      } catch (err) {
        alert("Could not delete event: " + err.message);
      }
    });
  });

  updateFieldEventCountLabel(fieldName);
}

function onCardChange(e) {
  // Checkboxes removed — handler kept as no-op for safety
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

  renderFieldAnalysesList(items);

  document.getElementById("field-modal").style.display = "flex";
}

window.closeFieldModal = function () {
  document.getElementById("field-modal").style.display = "none";
};

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

function downloadFieldData(fieldName) {
  window.open(
    `${API_URL}/api/analyses/field/${encodeURIComponent(fieldName)}/csv`,
    "_blank"
  );
}

/* ══════════════════════════════════════════════════
   COMPARE CHART — one line per selected field
══════════════════════════════════════════════════ */

async function showCompareChart() {
  const wrapper = document.getElementById("compare-chart-wrapper");
  const bar     = document.getElementById("compare-fields-bar");
  const hint    = document.getElementById("compare-fields-hint");

  const groups        = groupByField(allAnalyses);
  const allFieldNames = Object.keys(groups);

  if (!allFieldNames.length) {
    if (wrapper) wrapper.style.display = "none";
    return;
  }

  if (hint) hint.style.display = "none";

  if (!showCompareChart._hidden) showCompareChart._hidden = new Set();
  const hidden = showCompareChart._hidden;

  // ── Build chips bar ───────────────────────────────
  if (bar) {
    bar.innerHTML = allFieldNames.map(fieldName => {
      const isHidden = hidden.has(fieldName);
      return `
        <span class="compare-field-chip ${isHidden ? "compare-field-chip--off" : ""}"
              data-field="${encodeURIComponent(fieldName)}"
              title="${isHidden ? "Show" : "Hide"} ${escapeHtml(fieldName)}">
          ${escapeHtml(fieldName)}
        </span>
      `;
    }).join("");

    bar.querySelectorAll(".compare-field-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const field = decodeURIComponent(chip.dataset.field);
        if (hidden.has(field)) hidden.delete(field);
        else                   hidden.add(field);
        showCompareChart().catch(console.error);
      });
    });
  }

  // ── Build datasets (nur sichtbare Felder) ─────────
  const visibleFieldNames = allFieldNames.filter(f => !hidden.has(f));

  if (!visibleFieldNames.length) {
    if (wrapper) wrapper.style.display = "none";
    if (compareChart) { compareChart.destroy(); compareChart = null; }
    updateCompareToggleMeta();
    return;
  }

  if (wrapper) wrapper.style.display = "block";

  const needsFetch = visibleFieldNames.some(n => fieldEventsCache[n] === undefined);
  let allEvents = getCachedFieldEvents(visibleFieldNames);
  if (needsFetch) {
    allEvents = await fetchAllFieldEvents(visibleFieldNames);
  }

  const allDates   = new Set();
  const fieldItems = {};

  visibleFieldNames.forEach(fieldName => {
    const items = (groups[fieldName] || [])
      .slice()
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    fieldItems[fieldName] = items;
    items.forEach(i => { if (i.date) allDates.add(i.date); });
  });
  allEvents.forEach(ev => { if (ev.date) allDates.add(ev.date); });

  const sortedDates = Array.from(allDates).sort();
  const rawDatasets = [];

  visibleFieldNames.forEach(fieldName => {
    const byDate = {};
    fieldItems[fieldName].forEach(i => {
      if (i.date) byDate[i.date] = roundOc(i.avg_value);
    });
    rawDatasets.push({
      label:                fieldName,
      data:                 sortedDates.map(d => byDate[d] ?? null),
      spanGaps:             true,
      tension:              0,
      fill:                 false,
      borderColor:          "rgba(107,114,128,0.55)",
      backgroundColor:      "transparent",
      pointBorderColor:     "rgba(107,114,128,0.55)",
      pointBackgroundColor: "transparent",
      pointBorderWidth:     2,
    });
  });

  const { labels, datasets } = padChart(sortedDates, rawDatasets);

  const eventAnnotations = buildCompareEventAnnotations(allEvents);
  const topPad = 40 + maxEventsOnSameDate(eventAnnotations) * 22;

  // ── Chart ─────────────────────────────────────────
  const canvas = document.getElementById("compare-chart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (compareChart) compareChart.destroy();

  compareChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      animation: false,
      layout: { padding: { top: topPad, right: 100 } },
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        annotation: { annotations: {} },
        tooltip: {
          callbacks: {
            title: (items) => {
              const item = items[0];
              return `${item?.dataset?.label || ""}  ·  ${item?.label || ""}`;
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

  // Event-Daten für Plugin-Zeichnung
  compareChart._eventAnnotations = eventAnnotations;
  compareChart._hiddenFields     = hidden;

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
      if (idx !== compareChart._hoveredDataset) {
        compareChart._hoveredDataset = idx;
        compareChart.update("none");
      }
    });
  }

  updateCompareToggleMeta();
}

/* ══════════════════════════════════════════════════
   FIELD EVENTS
══════════════════════════════════════════════════ */

const fieldEventsCache = {};   // { fieldName: [events] }

function updateFieldEventCountLabel(fieldName) {
  const el = document.querySelector(
    `.fgc-events-count-label[data-field="${encodeURIComponent(fieldName)}"]`
  );
  if (el) el.textContent = formatEventCountLabel((fieldEventsCache[fieldName] || []).length);
}

async function refreshFieldEventCountLabels(fieldNames) {
  await Promise.all(fieldNames.map(async (name) => {
    if (fieldEventsCache[name] === undefined) await fetchFieldEvents(name);
    updateFieldEventCountLabel(name);
  }));
}

async function fetchFieldEvents(fieldName) {
  if (fieldEventsCache[fieldName] !== undefined) {
    return fieldEventsCache[fieldName];
  }
  try {
    const res = await fetch(
      `${API_URL}/api/field-events/${encodeURIComponent(fieldName)}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = await res.json();
    fieldEventsCache[fieldName] = events;
    return events;
  } catch (err) {
    console.error("fetchFieldEvents error:", err);
    return [];
  }
}

async function fetchAllFieldEvents(fieldNames) {
  const results = await Promise.all(
    fieldNames.map(async name => {
      const events = await fetchFieldEvents(name);
      // field_name an jedes Event anhängen falls API es nicht liefert
      return events.map(ev => ({ ...ev, field_name: ev.field_name || name }));
    })
  );
  return results.flat();
}

async function addFieldEvent(fieldName, date, eventType, description) {
  const res = await fetch(`${API_URL}/api/field-events`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      field_name:  fieldName,
      date,
      event_type:  eventType,
      description,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const event = await res.json();
  if (!fieldEventsCache[fieldName]) fieldEventsCache[fieldName] = [];
  fieldEventsCache[fieldName].push(event);
  fieldEventsCache[fieldName].sort((a, b) => a.date.localeCompare(b.date));
  return event;
}

async function deleteFieldEvent(eventId, fieldName) {
  const res = await fetch(`${API_URL}/api/field-events/${eventId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (fieldEventsCache[fieldName]) {
    fieldEventsCache[fieldName] =
      fieldEventsCache[fieldName].filter(e => String(e.id) !== String(eventId));
  }
}

/* ── Event Modal ─────────────────────────────────── */

let currentEventFieldName = null;

async function openEventModal(fieldName) {
  currentEventFieldName = fieldName;
  document.getElementById("event-modal-title").textContent =
    `Field Events — ${fieldName}`;

  const modal = document.getElementById("event-modal");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");

  // Set today as default date
  const dateInput = document.getElementById("event-date");
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().split("T")[0];
  }
}

function closeEventModal() {
  const modal = document.getElementById("event-modal");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  currentEventFieldName = null;
}

async function renderEventList(fieldName) {
  const list   = document.getElementById("event-list");
  list.innerHTML = `<p class="event-list-loading">Loading…</p>`;

  const events = await fetchFieldEvents(fieldName);

  if (!events.length) {
    list.innerHTML = `<p class="event-list-empty">No events yet.</p>`;
    return;
  }

  list.innerHTML = events.map(ev => `
    <div class="event-row" data-id="${ev.id}">
      <span class="event-row-icon">${eventIcon(ev.event_type)}</span>
      <span class="event-row-date">${escapeHtml(ev.date)}</span>
      <span class="event-row-desc">${escapeHtml(ev.description)}</span>
      <button class="event-row-delete btn-danger"
              data-id="${ev.id}"
              data-field="${encodeURIComponent(fieldName)}">✕</button>
    </div>
  `).join("");

  list.querySelectorAll(".event-row-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id    = btn.dataset.id;
      const field = decodeURIComponent(btn.dataset.field);
      try {
        await deleteFieldEvent(id, field);
        await renderEventList(field);
        // Refresh chart annotations if open
        if (document.getElementById("compare-toggle-body").classList.contains("open")) {
          showCompareChart().catch(console.error);
        }
      } catch (err) {
        alert("Could not delete event: " + err.message);
      }
    });
  });
}

// Wire up add button — called once on DOMContentLoaded
function initEventModal() {
  document.getElementById("event-modal")
    ?.addEventListener("click", e => {
      if (e.target.id === "event-modal") closeEventModal();
    });

  document.getElementById("event-add-btn")
  ?.addEventListener("click", async () => {
    if (!currentEventFieldName) return;
    const date     = document.getElementById("event-date").value;
    const typeRaw  = document.getElementById("event-type").value;
    const customType = document.getElementById("event-custom-type").value.trim();
    const type     = (typeRaw === "other" && customType) ? customType : typeRaw;
    const desc     = document.getElementById("event-description").value.trim();

    if (!date) { alert("Please select a date."); return; }
    if (typeRaw === "other" && !customType) {
      alert("Please enter a custom event type."); return;
    }
    if (!desc)  { alert("Please enter a description."); return; }

    try {
      await addFieldEvent(currentEventFieldName, date, type, desc);
      document.getElementById("event-description").value = "";
      document.getElementById("event-custom-type").value = "";
      document.getElementById("event-type").value = "planting";
      toggleCustomEventType("planting");

      const encodedField = encodeURIComponent(currentEventFieldName);
      const inlineList = document.querySelector(
        `.fgc-events-list[data-field="${encodedField}"]`
      );
      if (inlineList) await loadInlineEvents(currentEventFieldName, inlineList);
      updateFieldEventCountLabel(currentEventFieldName);

      if (document.getElementById("compare-toggle-body").classList.contains("open")) {
        showCompareChart().catch(console.error);
      }

      closeEventModal();
    } catch (err) {
      alert("Could not add event: " + err.message);
    }
  });
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
let _globalSatellite  = null;
let _globalLabels     = null;
let _globalMinimal    = null;

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

    // ── Base layers ──────────────────────────────
    _globalSatellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles © Esri" }
    );

    _globalMinimal = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
      { attribution: "© OpenStreetMap contributors © CARTO", subdomains: "abcd" }
    );

    // ── Overlay layers ───────────────────────────
    _globalLabels = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { opacity: 0.8 }
    );

    // Default: Satellite + Labels
    _globalSatellite.addTo(globalOverviewMap);
    _globalLabels.addTo(globalOverviewMap);

    // ── Layer control (same structure as map.js) ─
    const baseLayers = {
      "Satellite": _globalSatellite,
      "Map":       _globalMinimal,
    };
    const overlays = {
      "Labels": _globalLabels,
    };
    L.control.layers(baseLayers, overlays).addTo(globalOverviewMap);
  }

  // Remove non-tile layers (field drawings) to avoid duplicates
  globalOverviewMap.eachLayer(layer => {
    if (!layer._url) globalOverviewMap.removeLayer(layer);
  });

  const bounds    = [];
  const drawnFields = new Set();

  analyses.forEach(item => {
    if (!item.polygon || drawnFields.has(item.field_name)) return;
    drawnFields.add(item.field_name);

    const viz = FieldGradientOverlay.addFieldVisualization({
      map:            globalOverviewMap,
      polygon:        item.polygon,
      zones:          item.zones || [],
      classification: ocClassification,
      valueToColor:   valueToColor,
      formatTooltip:  zone =>
        `<b>${item.field_name}</b><br>OC: ${Number(zone.value).toFixed(1)} g/kg`,
    });

    if (viz.borderLayer) {
      bounds.push(viz.borderLayer.getBounds());
      viz.borderLayer.bindTooltip(
        `<b>${item.field_name}</b>`,
        { direction: "center", permanent: false }
      );
    } else if (item.polygon.length >= 3) {
      bounds.push(L.latLngBounds(item.polygon.map(p => [p.lat, p.lng])));
    }
  });

  if (bounds.length) {
    const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0].pad(0));
    globalOverviewMap.fitBounds(combined, { padding: [24, 24] });
  }
}

/* ══════════════════════════════════════════════════
   OC CLASSIFICATION INFO POPUP (Dashboard)
══════════════════════════════════════════════════ */

(function initDashboardClassInfo() {
  const popup      = document.getElementById("class-info-popup-dashboard");
  const btnOpen    = document.getElementById("btn-class-info-dashboard");
  const btnClose   = document.getElementById("close-class-info-dashboard");

  function renderDashboardClassInfo() {
    const c = ocClassification;
    if (!c || !popup) return;

    const noteEl    = document.getElementById("dash-class-info-note");
    const tiersEl   = document.getElementById("dash-class-info-tiers");
    const datasetEl = document.getElementById("dash-class-info-dataset");
    const linkEl    = document.getElementById("dash-class-info-link");

    if (noteEl) {
      noteEl.textContent = [c.dataset_note, c.colormap_note].filter(Boolean).join(" ");
    }
    if (datasetEl) {
      datasetEl.textContent =
        `${c.dataset_name} · ${c.n_samples} ${c.n_samples === 1 ? "point" : "points"} · ${c.parameter}, ${c.depth_cm} cm`;
    }
    if (linkEl && c.reference_url) {
      linkEl.href = c.reference_url;
    }
    if (tiersEl) {
      if (c.discrete_bin_labels && c.discrete_colors) {
        tiersEl.innerHTML = c.discrete_bin_labels
          .map((text, i) => {
            const swatch = c.discrete_colors[i] || "#888";
            return `<li><span class="legend-swatch" style="background:${swatch};display:inline-block;vertical-align:middle;margin-right:8px;"></span>${text}</li>`;
          })
          .join("");
      } else if (c.tier_descriptions) {
        const order = ["low", "medium", "high"];
        tiersEl.innerHTML = order
          .map(tier => {
            const swatch = (c.colors && c.colors[tier]) || OC_TIER_COLORS[tier];
            const text   = c.tier_descriptions[tier] || "";
            return `<li><span class="legend-swatch" style="background:${swatch};display:inline-block;vertical-align:middle;margin-right:8px;"></span>${text}</li>`;
          })
          .join("");
      }
    }
  }

  function openPopup() {
    if (!popup) return;
    renderDashboardClassInfo();
    popup.classList.add("visible");
    popup.setAttribute("aria-hidden", "false");
  }

  function closePopup() {
    if (!popup) return;
    popup.classList.remove("visible");
    popup.setAttribute("aria-hidden", "true");
  }

  if (btnOpen)  btnOpen.addEventListener("click", openPopup);
  if (btnClose) btnClose.addEventListener("click", closePopup);
  if (popup) {
    popup.addEventListener("click", e => {
      if (e.target === popup) closePopup();
    });
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closePopup();
  });
})();

/* ══════════════════════════════════════════════════
   COMPARE TOGGLE
══════════════════════════════════════════════════ */

function updateCompareToggleMeta() {
  const meta   = document.getElementById("compare-toggle-meta");
  if (!meta) return;
  const total  = Object.keys(groupByField(allAnalyses)).length;
  const hidden = showCompareChart._hidden ? showCompareChart._hidden.size : 0;
  const shown  = total - hidden;
  meta.textContent = total
    ? `${shown} of ${total} field${total > 1 ? "s" : ""} visible`
    : "No fields yet";
}

function updateCompareFieldsBar() {
  const bar = document.getElementById("compare-fields-bar");
  if (!bar) return;

  if (selectedForCompare.size === 0) {
    bar.innerHTML = `<span class="compare-fields-hint" id="compare-fields-hint">
      No fields selected yet — use the checkboxes on the field cards below.
    </span>`;
    return;
  }

  bar.innerHTML = Array.from(selectedForCompare).map(fieldName => `
    <span class="compare-field-chip">
      ${escapeHtml(fieldName)}
      <button class="compare-chip-remove" data-field="${encodeURIComponent(fieldName)}"
              title="Remove">✕</button>
    </span>
  `).join("");

  bar.querySelectorAll(".compare-chip-remove").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const field = decodeURIComponent(btn.dataset.field);
      selectedForCompare.delete(field);

      // Uncheck the card checkbox
      document.querySelectorAll(`.compare-checkbox[data-field="${encodeURIComponent(field)}"]`)
        .forEach(cb => (cb.checked = false));

      showCompareChart().catch(console.error);
      updateCompareToggleMeta();
    });
  });
}

function initCompareToggle() {
  const btn  = document.getElementById("compare-toggle-btn");
  const body = document.getElementById("compare-toggle-body");
  const chev = document.getElementById("compare-toggle-chevron");
  if (!btn || !body) return;

  btn.addEventListener("click", () => {
    const isOpen = body.classList.contains("open");
    body.classList.toggle("open", !isOpen);
    btn.setAttribute("aria-expanded", String(!isOpen));
    if (chev) chev.textContent = isOpen ? "▾" : "▴";

    // Render chart on first open
    if (!isOpen) showCompareChart().catch(console.error);
  });
}