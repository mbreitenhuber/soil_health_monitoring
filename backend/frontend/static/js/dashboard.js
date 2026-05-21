/* =====================================================
   dashboard.js
===================================================== */

function readDashboardConfig() {
  const el = document.getElementById("dashboard-config");
  if (!el) {
    return { analyses: [], apiUrl: "http://127.0.0.1:8000", lang: "en" };
  }
  try {
    return JSON.parse(el.textContent);
  } catch {
    return { analyses: [], apiUrl: "http://127.0.0.1:8000", lang: "en" };
  }
}

const dashboardConfig  = readDashboardConfig();
let allAnalyses        = dashboardConfig.analyses || [];
let selectedForCompare = new Set();
let currentItem        = null;
let qualityChart       = null;

const API_URL = dashboardConfig.apiUrl || "http://127.0.0.1:8000";
const LANG    = dashboardConfig.lang || "en";

const COLORS = {
  min:     "#ef4444",
  avg:     "#f59e0b",
  max:     "#22c55e",
  compare: ["#C94F4F","#f59e0b","#22c55e","#3b82f6","#a855f7","#ec4899"],
};

/* ── INIT ─────────────────────────────────────────── */

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

  // Filters — fire on every keystroke / change
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

  // Event delegation on card container
  const c = document.getElementById("dashboard-container");
  c.addEventListener("click",  onCardClick);
  c.addEventListener("change", onCardChange);
});

/* ── CROP FILTER — dynamic from data ─────────────── */

function populateCropFilter() {
  const crops = [...new Set(
    allAnalyses
      .map(a => (a.crop || "").trim())
      .filter(Boolean)
  )].sort();

  const select = document.getElementById("filter-crop");
  // Keep the "All crops" option, append the rest
  crops.forEach(crop => {
    const opt = document.createElement("option");
    opt.value = crop.toLowerCase();
    opt.textContent = crop.charAt(0).toUpperCase() + crop.slice(1);
    select.appendChild(opt);
  });
}

/* ── FILTERS ──────────────────────────────────────── */

function applyFilters() {
  const name     = document.getElementById("filter-name").value.trim().toLowerCase();
  const crop     = document.getElementById("filter-crop").value.toLowerCase();
  const dateFrom = document.getElementById("filter-date-from").value; // "YYYY-MM-DD" or ""
  const dateTo   = document.getElementById("filter-date-to").value;

  let filtered = [...allAnalyses];

  if (name) {
    filtered = filtered.filter(a =>
      (a.field_name || "").toLowerCase().includes(name)
    );
  }

  if (crop) {
    filtered = filtered.filter(a =>
      (a.crop || "").toLowerCase() === crop
    );
  }

  if (dateFrom) {
    filtered = filtered.filter(a => a.date >= dateFrom);
  }

  if (dateTo) {
    filtered = filtered.filter(a => a.date <= dateTo);
  }

  renderDashboard(filtered);
  updateFilterSummary(filtered.length, name, crop, dateFrom, dateTo);
}

function resetFilters() {
  document.getElementById("filter-name").value      = "";
  document.getElementById("filter-crop").value      = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value   = "";
  renderDashboard(allAnalyses);
  document.getElementById("filter-summary").style.display = "none";
}

function updateFilterSummary(count, name, crop, from, to) {
  const el     = document.getElementById("filter-summary");
  const active = [name, crop, from, to].some(Boolean);

  if (!active) { el.style.display = "none"; return; }

  const total = allAnalyses.length;
  const parts = [];
  if (name)  parts.push(`name contains "<b>${name}</b>"`);
  if (crop)  parts.push(`crop = "<b>${crop}</b>"`);
  if (from)  parts.push(`from <b>${from}</b>`);
  if (to)    parts.push(`to <b>${to}</b>`);

  el.innerHTML  = `Showing <b>${count}</b> of <b>${total}</b> analyses — ${parts.join(", ")}`;
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
          📊 Avg: <b>${(a.avg_value * 100).toFixed(1)}%</b> &nbsp;
          🔴 ${(a.min_value * 100).toFixed(1)}% &nbsp;
          🟢 ${(a.max_value * 100).toFixed(1)}%
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

async function deleteAnalysis(id) {
  if (!confirm("Delete this analysis?")) return;
  try {
    const res = await fetch(`${API_URL}/api/analyses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allAnalyses = allAnalyses.filter(a => String(a.id) !== id);
    selectedForCompare.delete(id);
    // Re-apply current filters after delete
    applyFilters();
    // Also refresh crop dropdown
    refreshCropFilter();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

function refreshCropFilter() {
  const select      = document.getElementById("filter-crop");
  const currentVal  = select.value;
  // Remove all options except first ("All crops")
  while (select.options.length > 1) select.remove(1);
  // Re-populate
  const crops = [...new Set(
    allAnalyses.map(a => (a.crop || "").trim()).filter(Boolean)
  )].sort();
  crops.forEach(crop => {
    const opt = document.createElement("option");
    opt.value = crop.toLowerCase();
    opt.textContent = crop.charAt(0).toUpperCase() + crop.slice(1);
    select.appendChild(opt);
  });
  // Restore selection if still valid
  select.value = currentVal;
}

/* ── DOWNLOAD SINGLE ──────────────────────────────── */

function downloadAnalysis(id) {
  window.open(`${API_URL}/api/analyses/${id}/csv`, "_blank");
}

/* ── COMPARE CHART ────────────────────────────────── */

function showCompareChart() {
  const selected = allAnalyses.filter(a =>
    selectedForCompare.has(String(a.id))
  );
  if (selected.length < 2) {
    alert("Please select at least 2 fields first.");
    return;
  }

  const old = document.getElementById("compare-chart-wrapper");
  if (old) old.remove();

  const wrapper = document.createElement("div");
  wrapper.id = "compare-chart-wrapper";
  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);

  const container = document.getElementById("dashboard-container");
  container.parentNode.insertBefore(wrapper, container);

  new Chart(canvas, {
    type: "bar",
    data: {
      labels: selected.map(a => a.field_name || "Unnamed"),
      datasets: [{
        label: "Average Soil Quality (%)",
        data: selected.map(a => +(a.avg_value * 100).toFixed(1)),
        backgroundColor: selected.map((_, i) =>
          COLORS.compare[i % COLORS.compare.length]
        ),
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true, max: 100,
          grid: { color: "rgba(0,0,0,0.06)" },
          ticks: { callback: v => v + "%" }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

/* ── DETAIL MODAL ─────────────────────────────────── */

function openDetailModal(item) {
  currentItem = item;
  document.getElementById("edit-field-name").value  = item.field_name    || "";
  document.getElementById("edit-location").value    = item.location_name || "";
  document.getElementById("edit-crop").value        = item.crop          || "";
  document.getElementById("edit-notes").value       = item.notes         || "";
  document.getElementById("detail-avg").textContent = (item.avg_value * 100).toFixed(1) + "%";
  document.getElementById("detail-min").textContent = (item.min_value * 100).toFixed(1) + "%";
  document.getElementById("detail-max").textContent = (item.max_value * 100).toFixed(1) + "%";
  document.getElementById("detail-modal").style.display = "flex";
  renderDetailChart(item);
}

window.closeDetailModal = function () {
  document.getElementById("detail-modal").style.display = "none";
};

/* ── SAVE ─────────────────────────────────────────── */

async function saveDetails() {
  if (!currentItem) return;
  const payload = {
    ...currentItem,
    field_name:    document.getElementById("edit-field-name").value,
    location_name: document.getElementById("edit-location").value,
    crop:          document.getElementById("edit-crop").value,
    notes:         document.getElementById("edit-notes").value
  };
  try {
    const res = await fetch(`${API_URL}/api/update-analysis/${currentItem.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const idx = allAnalyses.findIndex(a => String(a.id) === String(currentItem.id));
    if (idx !== -1) allAnalyses[idx] = { ...allAnalyses[idx], ...payload };
    closeDetailModal();
    applyFilters();
    refreshCropFilter();
  } catch (err) {
    alert("Save failed: " + err.message);
  }
}

/* ── DETAIL CHART ─────────────────────────────────── */

function renderDetailChart(item) {
  const ctx = document.getElementById("quality-chart").getContext("2d");
  if (qualityChart) qualityChart.destroy();
  qualityChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Minimum", "Average", "Maximum"],
      datasets: [{
        label: "Soil Quality (%)",
        data: [
          +(item.min_value * 100).toFixed(1),
          +(item.avg_value * 100).toFixed(1),
          +(item.max_value * 100).toFixed(1)
        ],
        backgroundColor: [COLORS.min, COLORS.avg, COLORS.max],
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true, max: 100,
          grid: { color: "rgba(255,255,255,0.08)" },
          ticks: { color: "#9ca3af", callback: v => v + "%" }
        },
        x: { grid: { display: false }, ticks: { color: "#9ca3af" } }
      }
    }
  });
}