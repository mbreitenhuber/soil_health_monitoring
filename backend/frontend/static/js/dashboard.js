/* =====================================================
   dashboard.js  —  grouped field view (OC in g/kg)
===================================================== */

function formatOcGkg(value) {
  return `${Number(value).toFixed(1)} g/kg`;
}

function roundOc(value) {
  return +Number(value).toFixed(1);
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relativeTrendPct(firstVal, latestVal) {
  const first = Number(firstVal);
  const latest = Number(latestVal);
  if (!first || !Number.isFinite(first) || !Number.isFinite(latest)) return null;
  return ((latest - first) / first) * 100;
}

function ocYAxisOptions(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v));
  const maxVal = nums.length ? Math.max(...nums) : 10;
  return {
    beginAtZero: true,
    suggestedMax: maxVal + Math.max(0.5, maxVal * 0.15),
    grid: { color: "rgba(255,255,255,0.07)" },
    ticks: {
      color: "#9ca3af",
      callback: v => v + " g/kg",
    },
  };
}

function ocYAxisOptionsLight(values) {
  const opts = ocYAxisOptions(values);
  opts.grid = { color: "rgba(0,0,0,0.06)" };
  opts.ticks = { callback: v => v + " g/kg" };
  return opts;
}

function readDashboardConfig() {
  const el = document.getElementById("dashboard-config");
  if (!el) return { analyses: [], apiUrl: "http://127.0.0.1:8000" };
  try { return JSON.parse(el.textContent); }
  catch { return { analyses: [], apiUrl: "http://127.0.0.1:8000" }; }
}

const dashboardConfig  = readDashboardConfig();
let allAnalyses        = dashboardConfig.analyses || [];
let selectedForCompare = new Set();   // field names (strings)
let currentItem        = null;
let currentFieldName   = null;
let qualityChart       = null;
let fieldLineChart     = null;
let compareChart       = null;

const API_URL = dashboardConfig.apiUrl || "http://127.0.0.1:8000";

const COLORS = {
  min:     "#ef4444",
  avg:     "#f59e0b",
  max:     "#22c55e",
  compare: ["#C94F4F", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"],
};

const TREND_FLAT_PCT = 1;

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
  Object.values(groups).forEach(g =>
    g.sort((a, b) => (a.date || "").localeCompare(b.date || ""))
  );
  return groups;
}

function fieldKey(analysis) {
  return (analysis.field_name || "Unnamed Field").trim();
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  renderDashboard(allAnalyses, { filtered: false });
  populateCropFilter();

  document.getElementById("download-csv-btn")
    ?.addEventListener("click", () =>
      window.open(`${API_URL}/api/analyses/csv`, "_blank")
    );
  document.getElementById("compare-btn")
    ?.addEventListener("click", showCompareChart);
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
  container?.addEventListener("click", onCardClick);
  container?.addEventListener("change", onCardChange);

  document.getElementById("field-modal")?.addEventListener("click", e => {
    if (e.target.id === "field-modal") closeFieldModal();
  });
  document.getElementById("detail-modal")?.addEventListener("click", e => {
    if (e.target.id === "detail-modal") closeDetailModal();
  });
});

/* ══════════════════════════════════════════════════════
   RENDER  —  one card per unique field name
══════════════════════════════════════════════════════ */

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

  container.innerHTML = Object.entries(groups).map(([fieldName, items]) => {
    const latest = items[items.length - 1];
    const first = items[0];
    const dateRange = items.length > 1
      ? `${escapeHtml(first.date)} – ${escapeHtml(latest.date)}`
      : escapeHtml(latest.date || "–");

    const trend = items.length > 1
      ? relativeTrendPct(first.avg_value, latest.avg_value)
      : null;

    const trendHTML = trend !== null
      ? `<span class="field-trend ${
          trend >  TREND_FLAT_PCT ? "trend-up"   :
          trend < -TREND_FLAT_PCT ? "trend-down" : "trend-flat"
        }">${
          trend >  TREND_FLAT_PCT ? "↑" :
          trend < -TREND_FLAT_PCT ? "↓" : "→"
        } ${Math.abs(trend).toFixed(1)}%</span>`
      : "";

    const checked = selectedForCompare.has(fieldName) ? "checked" : "";
    const safeField = encodeURIComponent(fieldName);

    return `
      <div class="analysis-card field-group-card" data-field="${safeField}">
        <div class="field-group-header">
          <div class="analysis-title">${escapeHtml(fieldName)}</div>
          <span class="field-count-badge"
                title="${items.length} ${items.length === 1 ? "analysis" : "analyses"}">
            ${items.length}
          </span>
        </div>
        <div class="analysis-meta">
          📅 ${dateRange}<br>
          ${latest.crop ? `🌾 ${escapeHtml(latest.crop)}<br>` : ""}
          ${latest.location_name ? `📍 ${escapeHtml(latest.location_name)}<br>` : ""}
          📊 Latest Avg: <b>${formatOcGkg(latest.avg_value)}</b>
          ${trendHTML}
        </div>
        <label class="compare-label"
               style="display:flex;gap:8px;align-items:center;cursor:pointer;
                      font-size:0.83rem;color:#555;">
          <input type="checkbox"
                 class="compare-checkbox"
                 data-field="${safeField}"
                 ${checked}>
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
  if (e.target.closest(".compare-label") || e.target.closest(".compare-checkbox")) {
    return;
  }

  const card = e.target.closest(".field-group-card");
  if (!card) return;

  openFieldModal(decodeURIComponent(card.dataset.field));
}

function onCardChange(e) {
  const cb = e.target.closest(".compare-checkbox");
  if (!cb || !cb.dataset.field) return;
  const field = decodeURIComponent(cb.dataset.field);
  if (cb.checked) selectedForCompare.add(field);
  else selectedForCompare.delete(field);
}

/* ══════════════════════════════════════════════════════
   FIELD MODAL
══════════════════════════════════════════════════════ */

function updateFieldModalStats(items) {
  const latest = items[items.length - 1];
  const allMin = Math.min(...items.map(a => a.min_value));
  const allMax = Math.max(...items.map(a => a.max_value));

  document.getElementById("field-stat-count").textContent = items.length;
  document.getElementById("field-stat-min").textContent = formatOcGkg(allMin);
  document.getElementById("field-stat-max").textContent = formatOcGkg(allMax);
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
    latest.crop ? `🌾 ${latest.crop}` : null,
  ].filter(Boolean);
  document.getElementById("field-modal-meta").textContent =
    metaParts.join("  ·  ");

  updateFieldModalStats(items);
  renderFieldLineChart(items);
  renderFieldAnalysesList(items);

  document.getElementById("field-new-analysis-btn").onclick = () => {
    window.location.href = "/analyse";
  };

  document.getElementById("field-modal").style.display = "flex";
}

window.closeFieldModal = function () {
  document.getElementById("field-modal").style.display = "none";
  if (fieldLineChart) {
    fieldLineChart.destroy();
    fieldLineChart = null;
  }
};

function renderFieldLineChart(items) {
  const ctx = document.getElementById("field-line-chart").getContext("2d");
  if (fieldLineChart) fieldLineChart.destroy();

  const labels = items.map(a => a.date || "–");
  const maxData = items.map(a => roundOc(a.max_value));
  const avgData = items.map(a => roundOc(a.avg_value));
  const minData = items.map(a => roundOc(a.min_value));
  const allY = [...maxData, ...avgData, ...minData];

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
          data: maxData,
          borderColor: COLORS.max,
          pointBackgroundColor: COLORS.max,
        },
        {
          ...sharedOpts,
          label: "Average",
          data: avgData,
          borderColor: COLORS.avg,
          pointBackgroundColor: COLORS.avg,
        },
        {
          ...sharedOpts,
          label: "Minimum",
          data: minData,
          borderColor: COLORS.min,
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
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} g/kg`,
          },
        },
      },
      scales: {
        y: ocYAxisOptions(allY),
        x: {
          grid: { display: false },
          ticks: { color: "#9ca3af" },
        },
      },
    },
  });
}

function renderFieldAnalysesList(items) {
  const list = document.getElementById("field-analyses-list");
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
        <button class="btn-secondary field-detail-btn" data-id="${a.id}">Details</button>
        <button class="btn-secondary field-download-btn" data-id="${a.id}">⬇</button>
        <button class="btn-danger field-delete-btn" data-id="${a.id}">Delete</button>
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

/* ══════════════════════════════════════════════════════
   CROP FILTER
══════════════════════════════════════════════════════ */

function populateCropFilter() {
  const select = document.getElementById("filter-crop");
  if (!select) return;

  const crops = [...new Set(
    allAnalyses.map(a => (a.crop || "").trim()).filter(Boolean)
  )].sort();

  crops.forEach(crop => {
    const opt = document.createElement("option");
    opt.value = crop.toLowerCase();
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
    const opt = document.createElement("option");
    opt.value = crop.toLowerCase();
    opt.textContent = crop.charAt(0).toUpperCase() + crop.slice(1);
    select.appendChild(opt);
  });
  select.value = currentVal;
}

/* ══════════════════════════════════════════════════════
   FILTERS
══════════════════════════════════════════════════════ */

function applyFilters() {
  const name = document.getElementById("filter-name").value.trim().toLowerCase();
  const crop = document.getElementById("filter-crop").value.toLowerCase();
  const dateFrom = document.getElementById("filter-date-from").value;
  const dateTo = document.getElementById("filter-date-to").value;
  const hasFilters = Boolean(name || crop || dateFrom || dateTo);

  let filtered = [...allAnalyses];
  if (name) filtered = filtered.filter(a => (a.field_name || "").toLowerCase().includes(name));
  if (crop) filtered = filtered.filter(a => (a.crop || "").toLowerCase() === crop);
  if (dateFrom) filtered = filtered.filter(a => a.date >= dateFrom);
  if (dateTo) filtered = filtered.filter(a => a.date <= dateTo);

  renderDashboard(filtered, { filtered: hasFilters });
  updateFilterSummary(filtered, name, crop, dateFrom, dateTo);
}

function resetFilters() {
  document.getElementById("filter-name").value = "";
  document.getElementById("filter-crop").value = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value = "";
  renderDashboard(allAnalyses, { filtered: false });
  document.getElementById("filter-summary").style.display = "none";
}

function updateFilterSummary(filtered, name, crop, from, to) {
  const el = document.getElementById("filter-summary");
  const active = [name, crop, from, to].some(Boolean);
  if (!active) {
    el.style.display = "none";
    return;
  }

  const filteredFields = Object.keys(groupByField(filtered)).length;
  const totalFields = Object.keys(groupByField(allAnalyses)).length;

  const parts = [];
  if (name) parts.push(`name contains "<b>${escapeHtml(name)}</b>"`);
  if (crop) parts.push(`crop = "<b>${escapeHtml(crop)}</b>"`);
  if (from) parts.push(`from <b>${escapeHtml(from)}</b>`);
  if (to) parts.push(`to <b>${escapeHtml(to)}</b>`);

  el.innerHTML =
    `Showing <b>${filteredFields}</b> of <b>${totalFields}</b> fields — ${parts.join(", ")}`;
  el.style.display = "block";
}

/* ══════════════════════════════════════════════════════
   DOWNLOAD
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
  if (compareChart) {
    compareChart.destroy();
    compareChart = null;
  }

  const wrapper = document.createElement("div");
  wrapper.id = "compare-chart-wrapper";

  const title = document.createElement("p");
  title.style.cssText =
    "font-weight:700;font-size:0.95rem;margin:0 0 16px;color:#333;";
  title.textContent = "Field Comparison — Average OC (g/kg) over Time";
  wrapper.appendChild(title);

  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);

  const container = document.getElementById("dashboard-container");
  container.parentNode.insertBefore(wrapper, container);

  const groups = groupByField(allAnalyses);
  const dateSet = new Set();
  selectedForCompare.forEach(name => {
    (groups[name] || []).forEach(a => { if (a.date) dateSet.add(a.date); });
  });
  const allDates = [...dateSet].sort();

  const datasets = [...selectedForCompare].map((fieldName, i) => {
    const items = groups[fieldName] || [];
    const byDate = Object.fromEntries(items.map(a => [a.date, a]));
    const color = COLORS.compare[i % COLORS.compare.length];

    return {
      label: fieldName,
      data: allDates.map(d =>
        byDate[d] ? roundOc(byDate[d].avg_value) : null
      ),
      borderColor: color,
      pointBackgroundColor: color,
      tension: 0.35,
      pointRadius: 5,
      pointHoverRadius: 7,
      borderWidth: 2.5,
      fill: false,
      spanGaps: false,
    };
  });

  const allY = datasets.flatMap(ds => ds.data).filter(v => v != null);

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
              ` ${ctx.dataset.label}: ${
                ctx.parsed.y !== null ? ctx.parsed.y + " g/kg" : "–"
              }`,
          },
        },
      },
      scales: {
        y: ocYAxisOptionsLight(allY),
        x: { grid: { display: false } },
      },
    },
  });

  wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ══════════════════════════════════════════════════════
   DETAIL MODAL
══════════════════════════════════════════════════════ */

function openDetailModal(item) {
  currentItem = item;

  document.getElementById("edit-field-name").value = item.field_name || "";
  document.getElementById("edit-location").value = item.location_name || "";
  document.getElementById("edit-crop").value = item.crop || "";
  document.getElementById("edit-notes").value = item.notes || "";
  document.getElementById("detail-avg").textContent = formatOcGkg(item.avg_value);
  document.getElementById("detail-min").textContent = formatOcGkg(item.min_value);
  document.getElementById("detail-max").textContent = formatOcGkg(item.max_value);
  document.getElementById("detail-modal").style.display = "flex";
  renderDetailChart(item);
}

window.closeDetailModal = function () {
  document.getElementById("detail-modal").style.display = "none";
  if (qualityChart) {
    qualityChart.destroy();
    qualityChart = null;
  }
};

async function saveDetails() {
  if (!currentItem) return;

  const newFieldName = document.getElementById("edit-field-name").value.trim();
  const payload = {
    ...currentItem,
    field_name: newFieldName || currentItem.field_name,
    location_name: document.getElementById("edit-location").value,
    crop: document.getElementById("edit-crop").value,
    notes: document.getElementById("edit-notes").value,
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

    const oldFieldName = fieldKey(currentItem);
    const renamed = newFieldName && fieldKey({ field_name: newFieldName }) !== oldFieldName;

    if (renamed) {
      if (selectedForCompare.has(oldFieldName)) {
        selectedForCompare.delete(oldFieldName);
        selectedForCompare.add(fieldKey(payload));
      }
      if (currentFieldName === oldFieldName) {
        currentFieldName = fieldKey(payload);
      }
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
        label: "OC (g/kg)",
        data: barData,
        backgroundColor: [COLORS.min, COLORS.avg, COLORS.max],
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y} g/kg`,
          },
        },
      },
      scales: {
        y: ocYAxisOptions(barData),
        x: {
          grid: { display: false },
          ticks: { color: "#9ca3af" },
        },
      },
    },
  });
}
