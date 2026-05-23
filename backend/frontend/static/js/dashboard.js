/* =====================================================
   dashboard.js  —  grouped field view
===================================================== */

function formatOcGkg(value) {
  return `${Number(value).toFixed(1)} g/kg`;
}

function readDashboardConfig() {
  const el = document.getElementById("dashboard-config");
  if (!el) return { analyses: [], apiUrl: "http://127.0.0.1:8000", lang: "en" };
  try { return JSON.parse(el.textContent); }
  catch { return { analyses: [], apiUrl: "http://127.0.0.1:8000", lang: "en" }; }
}

const dashboardConfig  = readDashboardConfig();
let allAnalyses        = dashboardConfig.analyses || [];
let selectedForCompare = new Set();   // stores field names (strings)
let currentItem        = null;
let currentFieldName   = null;
let qualityChart       = null;
let fieldLineChart     = null;
let compareChart       = null;

const API_URL = dashboardConfig.apiUrl || "http://127.0.0.1:8000";
const LANG    = dashboardConfig.lang   || "en";

const COLORS = {
  min:     "#ef4444",
  avg:     "#f59e0b",
  max:     "#22c55e",
  compare: ["#C94F4F","#f59e0b","#22c55e","#3b82f6","#a855f7","#ec4899"],
};

/* ══════════════════════════════════════════════════════
   GROUPING
══════════════════════════════════════════════════════ */

function groupByField(analyses) {
  const groups = {};
  analyses.forEach(a => {
    const key = (a.field_name || "Unnamed Field").trim();
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });
  // Sort each group chronologically by date
  Object.values(groups).forEach(g =>
    g.sort((a, b) => (a.date || "").localeCompare(b.date || ""))
  );
  return groups;
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  renderDashboard(allAnalyses);
  populateCropFilter();

  document.getElementById("download-csv-btn")
    .addEventListener("click", () =>
      window.open(`${API_URL}/api/analyses/csv`, "_blank")
    );
  document.getElementById("compare-btn")
    .addEventListener("click", showCompareChart);
  document.getElementById("save-details")
    .addEventListener("click", saveDetails);

  // Filters
  document.getElementById("filter-name")
    .addEventListener("input", applyFilters);
  document.getElementById("filter-crop")
    .addEventListener("change", applyFilters);
  document.getElementById("filter-date-from")
    .addEventListener("change", applyFilters);
  document.getElementById("filter-date-to")
    .addEventListener("change", applyFilters);
  document.getElementById("filter-reset")
    .addEventListener("click", resetFilters);

  // Event delegation on card grid
  const c = document.getElementById("dashboard-container");
  c.addEventListener("click",  onCardClick);
  c.addEventListener("change", onCardChange);

  // Close modals by clicking overlay
  document.getElementById("field-modal").addEventListener("click", e => {
    if (e.target.id === "field-modal") closeFieldModal();
  });
  document.getElementById("detail-modal").addEventListener("click", e => {
    if (e.target.id === "detail-modal") closeDetailModal();
  });
});

/* ══════════════════════════════════════════════════════
   RENDER  —  one card per unique field name
══════════════════════════════════════════════════════ */

function renderDashboard(analyses) {
  const container = document.getElementById("dashboard-container");

  if (!analyses || analyses.length === 0) {
    container.innerHTML =
      "<p style='color:#888;padding:16px 0'>No analyses match your filters.</p>";
    return;
  }

  const groups = groupByField(analyses);

  container.innerHTML = Object.entries(groups).map(([fieldName, items]) => {
    const latest   = items[items.length - 1];
    const first    = items[0];
    const dateRange = items.length > 1
      ? `${first.date} – ${latest.date}`
      : (latest.date || "–");

    // Trend vs. first recorded analysis
    const trend = items.length > 1
      ? (latest.avg_value - first.avg_value) * 100
      : null;

    const trendHTML = trend !== null
      ? `<span class="field-trend ${
          trend >  0.05 ? "trend-up"   :
          trend < -0.05 ? "trend-down" : "trend-flat"
        }">${
          trend >  0.05 ? "↑" :
          trend < -0.05 ? "↓" : "→"
        } ${Math.abs(trend).toFixed(1)}%</span>`
      : "";

    const checked = selectedForCompare.has(fieldName) ? "checked" : "";

    return `
      <div class="analysis-card field-group-card"
           data-field="${encodeURIComponent(fieldName)}">

        <div class="field-group-header">
          <div class="analysis-title">${fieldName}</div>
          <span class="field-count-badge"
                title="${items.length} ${items.length === 1 ? "analysis" : "analyses"}">
            ${items.length}
          </span>
        </div>

        <div class="analysis-meta">
          📅 ${dateRange}<br>
          ${latest.crop          ? `🌾 ${latest.crop}<br>`          : ""}
          ${latest.location_name ? `📍 ${latest.location_name}<br>` : ""}
          📊 Latest Avg: <b>${(latest.avg_value * 100).toFixed(1)}%</b>
          ${trendHTML}
        </div>

        <label class="compare-label"
               onclick="event.stopPropagation()"
               style="display:flex;gap:8px;align-items:center;cursor:pointer;
                      font-size:0.83rem;color:#555;">
          <input type="checkbox"
                 class="compare-checkbox"
                 data-field="${encodeURIComponent(fieldName)}"
                 ${checked}
                 onclick="event.stopPropagation()">
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

/* ══════════════════════════════════════════════════════
   EVENT DELEGATION
══════════════════════════════════════════════════════ */

function onCardClick(e) {
  // Ignore clicks that originate from the checkbox / its label
  if (e.target.closest(".compare-label")) return;
  if (e.target.closest(".compare-checkbox")) return;

  const card = e.target.closest(".field-group-card");
  if (!card) return;

  const fieldName = decodeURIComponent(card.dataset.field);
  openFieldModal(fieldName);
}

function onCardChange(e) {
  const cb = e.target.closest(".compare-checkbox");
  if (!cb) return;
  const field = decodeURIComponent(cb.dataset.field);
  cb.checked
    ? selectedForCompare.add(field)
    : selectedForCompare.delete(field);
}

/* ══════════════════════════════════════════════════════
   FIELD MODAL
══════════════════════════════════════════════════════ */

function openFieldModal(fieldName) {
  currentFieldName = fieldName;

  const items = allAnalyses
    .filter(a => (a.field_name || "Unnamed Field").trim() === fieldName)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (!items.length) return;

  const latest = items[items.length - 1];

  // ── Header ──────────────────────────────────────────
  document.getElementById("field-modal-name").textContent = fieldName;
  const metaParts = [
    latest.location_name ? `📍 ${latest.location_name}` : null,
    latest.crop          ? `🌾 ${latest.crop}`           : null,
  ].filter(Boolean);
  document.getElementById("field-modal-meta").textContent =
    metaParts.join("  ·  ");

  // ── Stats ────────────────────────────────────────────
  const allMin = Math.min(...items.map(a => a.min_value * 100));
  const allMax = Math.max(...items.map(a => a.max_value * 100));

  document.getElementById("field-stat-count").textContent =
    items.length;
  document.getElementById("field-stat-min").textContent =
    allMin.toFixed(1) + "%";
  document.getElementById("field-stat-max").textContent =
    allMax.toFixed(1) + "%";
  document.getElementById("field-stat-latest").textContent =
    (latest.avg_value * 100).toFixed(1) + "%";

  // ── Charts & list ────────────────────────────────────
  renderFieldLineChart(items);
  renderFieldAnalysesList(items);

  // ── New-analysis button ──────────────────────────────
  document.getElementById("field-new-analysis-btn").onclick = () => {
    window.location.href = "/analyse";
  };

  document.getElementById("field-modal").style.display = "flex";
}

window.closeFieldModal = function () {
  document.getElementById("field-modal").style.display = "none";
  if (fieldLineChart) { fieldLineChart.destroy(); fieldLineChart = null; }
};

/* ── Field line chart  (Min / Avg / Max over time) ── */

function renderFieldLineChart(items) {
  const ctx = document.getElementById("field-line-chart").getContext("2d");
  if (fieldLineChart) fieldLineChart.destroy();

  const labels = items.map(a => a.date || "–");
  const sharedOpts = {
    tension: 0.35,
    pointRadius: items.length === 1 ? 7 : 5,
    pointHoverRadius: 8,
    borderWidth: 2.5,
    fill: false,
  };

  fieldLineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          ...sharedOpts,
          label: "Maximum",
          data: items.map(a => +(a.max_value * 100).toFixed(1)),
          borderColor:         COLORS.max,
          pointBackgroundColor: COLORS.max,
        },
        {
          ...sharedOpts,
          label: "Average",
          data: items.map(a => +(a.avg_value * 100).toFixed(1)),
          borderColor:         COLORS.avg,
          pointBackgroundColor: COLORS.avg,
        },
        {
          ...sharedOpts,
          label: "Minimum",
          data: items.map(a => +(a.min_value * 100).toFixed(1)),
          borderColor:         COLORS.min,
          pointBackgroundColor: COLORS.min,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: "#9ca3af", font: { size: 12 }, boxWidth: 16 },
        },
        tooltip: {
          callbacks: {
            label: ctx =>
              ` ${ctx.dataset.label}: ${ctx.parsed.y}%`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: false,
          min: 0,
          max: 100,
          grid:  { color: "rgba(255,255,255,0.07)" },
          ticks: { color: "#9ca3af", callback: v => v + "%" },
        },
        x: {
          grid:  { display: false },
          ticks: { color: "#9ca3af" },
        },
      },
    },
  });
}

/* ── Analyses list inside field modal ─────────────── */

function renderFieldAnalysesList(items) {
  const list = document.getElementById("field-analyses-list");

  // Newest first
  const sorted = [...items].reverse();

  list.innerHTML = sorted.map(a => `
    <div class="field-analysis-row">
      <div class="field-analysis-row-info">
        <span class="row-date">${a.date || "–"}</span>
        <div class="row-badges">
          <span class="badge-min" title="Min">${(a.min_value * 100).toFixed(1)}%</span>
          <span class="badge-avg" title="Avg">${(a.avg_value * 100).toFixed(1)}%</span>
          <span class="badge-max" title="Max">${(a.max_value * 100).toFixed(1)}%</span>
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
    btn.addEventListener("click", () => {
      const item = allAnalyses.find(a => String(a.id) === btn.dataset.id);
      if (item) openDetailModal(item);
    })
  );
  list.querySelectorAll(".field-download-btn").forEach(btn =>
    btn.addEventListener("click", () => downloadAnalysis(btn.dataset.id))
  );
  list.querySelectorAll(".field-delete-btn").forEach(btn =>
    btn.addEventListener("click", () => deleteAnalysisFromField(btn.dataset.id))
  );
}

/* ── Delete from inside field modal ──────────────── */

async function deleteAnalysisFromField(id) {
  if (!confirm("Delete this analysis?")) return;
  try {
    const res = await fetch(`${API_URL}/api/analyses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    allAnalyses = allAnalyses.filter(a => String(a.id) !== id);
    selectedForCompare.delete(id);
    applyFilters();
    refreshCropFilter();

    // Refresh or close the field modal
    const remaining = allAnalyses
      .filter(a => (a.field_name || "Unnamed Field").trim() === currentFieldName)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    if (remaining.length === 0) {
      closeFieldModal();
    } else {
      renderFieldLineChart(remaining);
      renderFieldAnalysesList(remaining);

      // Update stats
      const latest = remaining[remaining.length - 1];
      const allMin = Math.min(...remaining.map(a => a.min_value * 100));
      const allMax = Math.max(...remaining.map(a => a.max_value * 100));
      document.getElementById("field-stat-count").textContent = remaining.length;
      document.getElementById("field-stat-min").textContent   = allMin.toFixed(1) + "%";
      document.getElementById("field-stat-max").textContent   = allMax.toFixed(1) + "%";
      document.getElementById("field-stat-latest").textContent =
        (latest.avg_value * 100).toFixed(1) + "%";
    }
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

/* ══════════════════════════════════════════════════════
   CROP FILTER
══════════════════════════════════════════════════════ */

function populateCropFilter() {
  const crops = [...new Set(
    allAnalyses.map(a => (a.crop || "").trim()).filter(Boolean)
  )].sort();

  const select = document.getElementById("filter-crop");
  crops.forEach(crop => {
    const opt = document.createElement("option");
    opt.value       = crop.toLowerCase();
    opt.textContent = crop.charAt(0).toUpperCase() + crop.slice(1);
    select.appendChild(opt);
  });
}

function refreshCropFilter() {
  const select     = document.getElementById("filter-crop");
  const currentVal = select.value;
  while (select.options.length > 1) select.remove(1);

  const crops = [...new Set(
    allAnalyses.map(a => (a.crop || "").trim()).filter(Boolean)
  )].sort();
  crops.forEach(crop => {
    const opt = document.createElement("option");
    opt.value       = crop.toLowerCase();
    opt.textContent = crop.charAt(0).toUpperCase() + crop.slice(1);
    select.appendChild(opt);
  });
  select.value = currentVal;
}

/* ══════════════════════════════════════════════════════
   FILTERS
══════════════════════════════════════════════════════ */

function applyFilters() {
  const name     = document.getElementById("filter-name").value.trim().toLowerCase();
  const crop     = document.getElementById("filter-crop").value.toLowerCase();
  const dateFrom = document.getElementById("filter-date-from").value;
  const dateTo   = document.getElementById("filter-date-to").value;

  let filtered = [...allAnalyses];

  if (name)     filtered = filtered.filter(a => (a.field_name || "").toLowerCase().includes(name));
  if (crop)     filtered = filtered.filter(a => (a.crop || "").toLowerCase() === crop);
  if (dateFrom) filtered = filtered.filter(a => a.date >= dateFrom);
  if (dateTo)   filtered = filtered.filter(a => a.date <= dateTo);

  renderDashboard(filtered);
  updateFilterSummary(filtered, name, crop, dateFrom, dateTo);
}

function resetFilters() {
  document.getElementById("filter-name").value      = "";
  document.getElementById("filter-crop").value      = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value   = "";
  renderDashboard(allAnalyses);
  document.getElementById("filter-summary").style.display = "none";
}

function updateFilterSummary(filtered, name, crop, from, to) {
  const el     = document.getElementById("filter-summary");
  const active = [name, crop, from, to].some(Boolean);
  if (!active) { el.style.display = "none"; return; }

  const filteredFields = Object.keys(groupByField(filtered)).length;
  const totalFields    = Object.keys(groupByField(allAnalyses)).length;

  const parts = [];
  if (name) parts.push(`name contains "<b>${name}</b>"`);
  if (crop) parts.push(`crop = "<b>${crop}</b>"`);
  if (from) parts.push(`from <b>${from}</b>`);
  if (to)   parts.push(`to <b>${to}</b>`);

  el.innerHTML     = `Showing <b>${filteredFields}</b> of <b>${totalFields}</b> fields — ${parts.join(", ")}`;
  el.style.display = "block";
}

/* ── EVENT DELEGATION ─────────────────────────────── */

function onCardClick(e) {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains("delete-btn"))   { deleteAnalysis(id);   return; }
  if (btn.classList.contains("download-btn")) { downloadAnalysis(id); return; }
  if (btn.classList.contains("details-btn"))  {
    const item = allAnalyses.find(a => String(a.id) === id);
    if (item) openDetailModal(item);
  }
}

function onCardChange(e) {
  const cb = e.target.closest(".compare-checkbox");
  if (!cb) return;
  cb.checked ? selectedForCompare.add(cb.dataset.id)
             : selectedForCompare.delete(cb.dataset.id);
}

/* ── RENDER ───────────────────────────────────────── */

function renderDashboard(analyses) {
  const container = document.getElementById("dashboard-container");

  if (!analyses || analyses.length === 0) {
    container.innerHTML = "<p style='color:#888;padding:16px 0'>No analyses match your filters.</p>";
    return;
  }

  container.innerHTML = analyses.map(a => {
    const checked = selectedForCompare.has(String(a.id)) ? "checked" : "";
    return `
      <div class="analysis-card">
        <div class="analysis-title">${a.field_name || "Unnamed Field"}</div>
        <div class="analysis-meta">
          📅 ${a.date || "–"}<br>
          ${a.crop ? `🌾 ${a.crop}<br>` : ""}
          📊 Avg: <b>${formatOcGkg(a.avg_value)}</b> &nbsp;
          🔴 ${formatOcGkg(a.min_value)} &nbsp;
          🟢 ${formatOcGkg(a.max_value)}
        </div>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer;font-size:0.83rem;color:#555;">
          <input type="checkbox" class="compare-checkbox" data-id="${a.id}" ${checked}>
          Select for comparison
        </label>
        <div class="card-btn-row">
          <button class="btn-secondary details-btn"  data-id="${a.id}">Details</button>
          <button class="btn-secondary download-btn" data-id="${a.id}">Download</button>
          <button class="btn-danger   delete-btn"    data-id="${a.id}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
}

/* ── DELETE ───────────────────────────────────────── */
/* ══════════════════════════════════════════════════════
   DELETE (standalone, from outside the field modal)
══════════════════════════════════════════════════════ */

async function deleteAnalysis(id) {
  if (!confirm("Delete this analysis?")) return;
  try {
    const res = await fetch(`${API_URL}/api/analyses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allAnalyses = allAnalyses.filter(a => String(a.id) !== id);
    selectedForCompare.delete(id);
    applyFilters();
    refreshCropFilter();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

/* ══════════════════════════════════════════════════════
   DOWNLOAD SINGLE
══════════════════════════════════════════════════════ */

function downloadAnalysis(id) {
  window.open(`${API_URL}/api/analyses/${id}/csv`, "_blank");
}

/* ══════════════════════════════════════════════════════
   COMPARE CHART  —  cross-field, one line per field
══════════════════════════════════════════════════════ */

function showCompareChart() {
  if (selectedForCompare.size < 2) {
    alert("Please select at least 2 fields for comparison.");
    return;
  }

  const old = document.getElementById("compare-chart-wrapper");
  if (old) old.remove();

  const wrapper = document.createElement("div");
  wrapper.id = "compare-chart-wrapper";

  const title = document.createElement("p");
  title.style.cssText =
    "font-weight:700;font-size:0.95rem;margin:0 0 16px;color:#333;";
  title.textContent = "Field Comparison — Average Soil Quality over Time";
  wrapper.appendChild(title);

  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);

  const container = document.getElementById("dashboard-container");
  container.parentNode.insertBefore(wrapper, container);

  new Chart(canvas, {
    type: "bar",
    data: {
      labels: selected.map(a => a.field_name || "Unnamed"),
      datasets: [{
        label: "Average OC (g/kg)",
        data: selected.map(a => +Number(a.avg_value).toFixed(1)),
        backgroundColor: selected.map((_, i) =>
          COLORS.compare[i % COLORS.compare.length]
        ),
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
  // Build datasets — one line per selected field
  const groups = groupByField(allAnalyses);

  // Collect all dates across selected fields (union, sorted)
  const dateSet = new Set();
  selectedForCompare.forEach(name => {
    (groups[name] || []).forEach(a => { if (a.date) dateSet.add(a.date); });
  });
  const allDates = [...dateSet].sort();

  const datasets = [...selectedForCompare].map((fieldName, i) => {
    const items   = groups[fieldName] || [];
    const byDate  = Object.fromEntries(items.map(a => [a.date, a]));

    return {
      label:                fieldName,
      data:                 allDates.map(d => byDate[d] ? +(byDate[d].avg_value * 100).toFixed(1) : null),
      borderColor:          COLORS.compare[i % COLORS.compare.length],
      pointBackgroundColor: COLORS.compare[i % COLORS.compare.length],
      tension:              0.35,
      pointRadius:          5,
      pointHoverRadius:     7,
      borderWidth:          2.5,
      fill:                 false,
      spanGaps:             false,
    };
  });

  if (compareChart) compareChart.destroy();

  compareChart = new Chart(canvas, {
    type: "line",
    data: { labels: allDates, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { font: { size: 12 }, boxWidth: 16 },
        },
        tooltip: {
          callbacks: {
            label: ctx =>
              ` ${ctx.dataset.label}: ${ctx.parsed.y !== null ? ctx.parsed.y + "%" : "–"}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          min: 0,
          max: 100,
          grid:  { color: "rgba(0,0,0,0.06)" },
          ticks: { callback: v => v + " g/kg" },
        },
        x: { grid: { display: false } },
      },
    },
  });

  // Scroll to chart
  wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ══════════════════════════════════════════════════════
   DETAIL MODAL  —  single-analysis edit view
══════════════════════════════════════════════════════ */

function openDetailModal(item) {
  currentItem = item;

  document.getElementById("edit-field-name").value  = item.field_name    || "";
  document.getElementById("edit-location").value    = item.location_name || "";
  document.getElementById("edit-crop").value        = item.crop          || "";
  document.getElementById("edit-notes").value       = item.notes         || "";
  document.getElementById("detail-avg").textContent = formatOcGkg(item.avg_value);
  document.getElementById("detail-min").textContent = formatOcGkg(item.min_value);
  document.getElementById("detail-max").textContent = formatOcGkg(item.max_value);
  document.getElementById("detail-modal").style.display = "flex";
  renderDetailChart(item);
}

window.closeDetailModal = function () {
  document.getElementById("detail-modal").style.display = "none";
};

/* ══════════════════════════════════════════════════════
   SAVE  —  update from detail modal
══════════════════════════════════════════════════════ */

async function saveDetails() {
  if (!currentItem) return;

  const payload = {
    ...currentItem,
    field_name:    document.getElementById("edit-field-name").value,
    location_name: document.getElementById("edit-location").value,
    crop:          document.getElementById("edit-crop").value,
    notes:         document.getElementById("edit-notes").value,
  };

  try {
    const res = await fetch(
      `${API_URL}/api/update-analysis/${currentItem.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const idx = allAnalyses.findIndex(
      a => String(a.id) === String(currentItem.id)
    );
    if (idx !== -1) allAnalyses[idx] = { ...allAnalyses[idx], ...payload };

    closeDetailModal();
    applyFilters();
    refreshCropFilter();

    // If field modal is still open, refresh it too
    if (document.getElementById("field-modal").style.display === "flex") {
      openFieldModal(currentFieldName);
    }
  } catch (err) {
    alert("Save failed: " + err.message);
  }
}

/* ══════════════════════════════════════════════════════
   DETAIL CHART  —  bar chart for single-analysis min/avg/max
══════════════════════════════════════════════════════ */

function renderDetailChart(item) {
  const ctx = document.getElementById("quality-chart").getContext("2d");
  if (qualityChart) qualityChart.destroy();

  qualityChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Minimum", "Average", "Maximum"],
      datasets: [{
        label: "OC (g/kg)",
        data: [
          +Number(item.min_value).toFixed(1),
          +Number(item.avg_value).toFixed(1),
          +Number(item.max_value).toFixed(1)
        ],
        backgroundColor: [COLORS.min, COLORS.avg, COLORS.max],
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          grid:  { color: "rgba(255,255,255,0.08)" },
          ticks: { color: "#9ca3af", callback: v => v + "%" },
        },
        x: {
          grid:  { display: false },
          ticks: { color: "#9ca3af" },
        },
      },
    },
  });
}