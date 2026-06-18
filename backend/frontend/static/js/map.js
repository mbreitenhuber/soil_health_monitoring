/* map.js — Leaflet Karte + Analyse */

const MAP_UI = window.MAP_UI || {
  ready: "Ready ✓",
  no_polygon: "No Polygon",
  search_placeholder: "Search location or coordinates...",
  search_error: "Location not found",
  layer_satellite: "Satellite",
  layer_analysis: "Analysis",
  layer_labels: "Labels",
  layer_drawings: "Drawings",
  layer_results: "Results",
  backend_unreachable: "Backend unreachable:\n{msg}",
  custom_crop_required: "Please enter a custom crop name",
  save_failed: "Could not save analysis",
};

const map = L.map("map", {
  zoomAnimation: true,
  fadeAnimation: true,
  markerZoomAnimation: true
}).setView([48.81430, 11.27558], 15);

// Prefill data set by Personal Dashboard when re-analysing an existing field
let _prefill = null;
try {
  const _raw = sessionStorage.getItem("dashboard_prefill");
  if (_raw) {
    _prefill = JSON.parse(_raw);
    sessionStorage.removeItem("dashboard_prefill"); // consume immediately
  }
} catch(e) {
  _prefill = null;
}

document.addEventListener("DOMContentLoaded", () => {
  const dateInput = document.getElementById("analysis-date");
  if (dateInput) {
    const today = new Date();
    dateInput.value = "";
    dateInput.max = today.toISOString().split("T")[0];
    dateInput.addEventListener("change", onAnalysisDateChosen);
  }

  const btnSelectToday = document.getElementById("btn-select-today");
  if (btnSelectToday) {
    btnSelectToday.addEventListener("click", setTodayDate);
  }

  setWorkflowStep(1);
  // ── Restore polygon + save-popup fields from Personal Dashboard ─────────────
  if (_prefill) {
    const _coords = _prefill.polygon;

    // Draw the stored polygon on the map
    if (Array.isArray(_coords) && _coords.length >= 3) {
      drawnItems.clearLayers();
      const _latlngs = _coords.map(p => L.latLng(p.lat, p.lng));
      const _layer   = L.polygon(_latlngs, {
        color: "#C94F4F",
        fillOpacity: 0.15,
      });
      drawnItems.addLayer(_layer);
      currentPolygon = _layer.getLatLngs()[0];
      updateStats(currentPolygon);
      map.fitBounds(_layer.getBounds(), { padding: [40, 40] });
    }

    // Pre-fill the Save popup fields
    if (_prefill.field_name    && dashboardFieldName)    dashboardFieldName.value    = _prefill.field_name;
    if (_prefill.location_name && dashboardLocationName) dashboardLocationName.value = _prefill.location_name;
    if (_prefill.crop          && dashboardCropSelect) {
      const _cropVal = _prefill.crop;
      const _opt = [...dashboardCropSelect.options].find(
        o => o.value.toLowerCase()    === _cropVal.toLowerCase() ||
            o.textContent.toLowerCase() === _cropVal.toLowerCase()
      );
      if (_opt) {
        dashboardCropSelect.value = _opt.value;
      } else {
        dashboardCropSelect.value = "custom";
        if (dashboardCustomCrop) {
          dashboardCustomCrop.style.display = "block";
          dashboardCustomCrop.value = _cropVal;
        }
      }
    }
  }
});

let analysisMode = false;
let searchMarker = null;
let latestAnalysisData = null;
let ocClassification = window.OC_CLASSIFICATION || null;

// =====================
// BASE LAYERS
// =====================

const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles © Esri"
  }
);

const minimal = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
  {
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: "abcd"
  }
);

// =====================
// OVERLAYS
// =====================

const labels = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles © Esri",
    opacity: 1
  }
);

const drawnItems = new L.FeatureGroup();
const resultLayer = new L.FeatureGroup();

map.addLayer(drawnItems);
map.addLayer(resultLayer);

// =====================
// DEFAULT VIEW (FIELD MODE)
// =====================

satellite.addTo(map);
labels.addTo(map);

// =====================
// SEARCH CONTROL
// =====================

L.Control.geocoder({
  collapsed: false,
  defaultMarkGeocode: false,
  placeholder: MAP_UI.search_placeholder,
  errorMessage: MAP_UI.search_error,
  suggestMinLength: 3,
  geocoder: L.Control.Geocoder.nominatim()
})
.on('markgeocode', function(e) {

  const bbox = e.geocode.bbox;
  const bounds = L.latLngBounds(bbox);

  map.flyToBounds(bounds, {
    padding: [40, 40],
    duration: 1.2
  });

  const center = e.geocode.center;

if (searchMarker) {
  map.removeLayer(searchMarker);
}

searchMarker = L.circleMarker(center, {
  radius: 10,
  fillColor: "#C94F4F",
  color: "#7A2F2F",
  weight: 2,
  opacity: 1,
  fillOpacity: 0.85,
  className: ""
}).addTo(map);

})
.addTo(map);

// =====================
// LAYER CONTROL
// =====================

const baseLayers = {
  [MAP_UI.layer_satellite]: satellite,
  [MAP_UI.layer_analysis]: minimal
};

const overlays = {
  [MAP_UI.layer_labels]: labels,
  [MAP_UI.layer_drawings]: drawnItems,
  [MAP_UI.layer_results]: resultLayer
};

L.control.layers(baseLayers, overlays).addTo(map);

// =====================
// DRAW CONTROL
// =====================

map.addControl(new L.Control.Draw({
  edit: { featureGroup: drawnItems, remove: false },
  draw: {
    polygon: { shapeOptions: { color: "#C94F4F", fillOpacity: 0.15 } },
    polyline: false,
    rectangle: false,
    circle: false,
    marker: false,
    circlemarker: false
  }
}));

map.on('draw:drawstart', () => {
  switchToFieldMode();
});

map.on('draw:editstart', () => {
  switchToFieldMode();
});

let currentPolygon = null;


// =====================
// HELPERS
// =====================

function switchToAnalysisMode() {
  if (analysisMode) return;

  analysisMode = true;

  minimal.setOpacity(0);
  map.addLayer(minimal);

  setTimeout(() => {
    minimal.setOpacity(1);

    satellite.setOpacity(0);
    labels.setOpacity(0);

    setTimeout(() => {
      map.removeLayer(satellite);
      map.removeLayer(labels);

      satellite.setOpacity(1);
      labels.setOpacity(1);
    }, 350);
  }, 50);
}

function switchToFieldMode() {
  if (!analysisMode) return;

  analysisMode = false;

  satellite.setOpacity(0);
  labels.setOpacity(0);

  map.addLayer(satellite);
  map.addLayer(labels);

  setTimeout(() => {
    satellite.setOpacity(1);
    labels.setOpacity(1);

    minimal.setOpacity(0);

    setTimeout(() => {
      map.removeLayer(minimal);
      minimal.setOpacity(1);
    }, 350);
  }, 50);
}

// =====================
// AREA CALC
// =====================

function calcArea(latlngs) {
  const R = 6371000;
  let area = 0;
  const n = latlngs.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;

    const xi = latlngs[i].lng * Math.PI / 180 * R *
      Math.cos(latlngs[i].lat * Math.PI / 180);
    const yi = latlngs[i].lat * Math.PI / 180 * R;

    const xj = latlngs[j].lng * Math.PI / 180 * R *
      Math.cos(latlngs[j].lat * Math.PI / 180);
    const yj = latlngs[j].lat * Math.PI / 180 * R;

    area += xi * yj - xj * yi;
  }

  return Math.abs(area / 2) / 10000;
}

// =====================
// UI HELPERS
// =====================

const OC_TIER_COLORS = {
  low: "#ef4444",
  medium: "#f59e0b",
  high: "#22c55e"
};

function ocTier(value, classification) {
  const c = classification || ocClassification;
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

function formatOcValue(value) {
  return `${Number(value).toFixed(1)} g/kg`;
}

function setResultsVisible(visible) {
  const resultPanel = document.getElementById("sidebar-result-panel");
  const legendPanel = document.getElementById("sidebar-legend-panel");
  const resultBox = document.getElementById("result-box");
  if (resultPanel) resultPanel.hidden = !visible;
  if (legendPanel) legendPanel.hidden = !visible;
  if (resultBox) resultBox.classList.toggle("visible", visible);
}

function setWorkflowStep(step) {
  workflowStep = step;

  const isRunning = step === "running";
  const isComplete = step === "complete";
  const hideSteps = isRunning || isComplete;

  [1, 2, 3].forEach((i) => {
    const full = document.getElementById(`step-${i}`);
    const summary = document.getElementById(`step-${i}-summary`);
    if (!full || !summary) return;

    if (hideSteps) {
      full.classList.add("hidden");
      full.classList.remove("active");
      summary.classList.add("hidden");
      return;
    }

    if (i === step) {
      full.classList.remove("hidden");
      full.classList.add("active");
      summary.classList.add("hidden");
    } else {
      full.classList.add("hidden");
      full.classList.remove("active");
      summary.classList.remove("hidden");
    }
  });

  const howto = document.getElementById("analysis-howto-cta");
  if (howto) howto.hidden = step !== 1;

  const areaPanel = document.getElementById("sidebar-area-panel");
  const dateBox = document.getElementById("sidebar-date-box");
  const hasField = !!currentPolygon;
  const showAreaPanel = hasField && step !== 1;
  const showDateBox = hasField && (step === 2 || step === 3 || isRunning || isComplete);

  if (areaPanel) areaPanel.hidden = !showAreaPanel;
  if (dateBox) dateBox.hidden = !showDateBox;

  const btnSelectToday = document.getElementById("btn-select-today");
  if (btnSelectToday) btnSelectToday.hidden = step !== 2;

  const instructions = document.getElementById("instructions-panel");
  if (instructions) {
    instructions.classList.toggle("is-collapsed", hideSteps);
  }

  const analyseBtn = document.getElementById("btn-analyse");
  if (analyseBtn) {
    const readyToStart = step === 3 || isComplete;
    analyseBtn.classList.toggle("is-inactive", !readyToStart && !isRunning);
    analyseBtn.disabled = isRunning;
  }

  hideAnalysisHint();
}

let workflowStep = 1;

function hasAnalysisDate() {
  const dateInput = document.getElementById("analysis-date");
  return !!(dateInput && dateInput.value);
}

function setTodayDate() {
  const dateInput = document.getElementById("analysis-date");
  if (!dateInput) return;
  dateInput.valueAsDate = new Date();
  onAnalysisDateChosen();
}

function onAnalysisDateChosen() {
  if (!currentPolygon || !hasAnalysisDate()) return;
  if (workflowStep === 2) setWorkflowStep(3);
}

function hideAnalysisHint() {
  const hint = document.getElementById("analysis-hint");
  if (hint) hint.hidden = true;
}

function showAnalysisHint(kind = "field") {
  const hint = document.getElementById("analysis-hint");
  if (!hint) return;
  const message =
    kind === "date"
      ? hint.dataset.hintDate
      : hint.dataset.hintField;
  if (message) hint.textContent = message;
  hint.hidden = false;
}

function updateStats(latlngs) {
  document.getElementById("stat-points").textContent = latlngs.length;
  document.getElementById("stat-area").textContent = calcArea(latlngs).toFixed(2) + " ha";
  document.getElementById("stat-status").textContent = MAP_UI.ready;
  hideAnalysisHint();

  if (hasAnalysisDate()) {
    setWorkflowStep(3);
  } else {
    setWorkflowStep(2);
  }
}

// =====================
// DRAW EVENTS
// =====================

map.on(L.Draw.Event.CREATED, e => {
  drawnItems.clearLayers();
  resultLayer.clearLayers();

  setResultsVisible(false);
  document.getElementById("btn-save-dashboard").style.display = "block";

  drawnItems.addLayer(e.layer);
  currentPolygon = e.layer.getLatLngs()[0];

  updateStats(currentPolygon);
});

map.on(L.Draw.Event.EDITED, () => {
  const layers = drawnItems.getLayers();

  if (layers.length) {
    currentPolygon = layers[0].getLatLngs()[0];
    updateStats(currentPolygon);
    resultLayer.clearLayers();
    setResultsVisible(false);
    btnSaveDashboard.classList.remove("visible");
    document.getElementById("btn-save-dashboard").style.display = "none";
  }
});

map.on(L.Draw.Event.DELETED, () => {
  switchToFieldMode();

  currentPolygon = null;

  ["stat-points", "stat-area"].forEach(id =>
    document.getElementById(id).textContent = "–"
  );

  document.getElementById("stat-status").textContent = MAP_UI.no_polygon;
  hideAnalysisHint();

  resultLayer.clearLayers();
  setResultsVisible(false);

  const dateInput = document.getElementById("analysis-date");
  if (dateInput) dateInput.value = "";

  setWorkflowStep(1);
});

// =====================
// ANALYSE BUTTON
// =====================

document.getElementById("btn-analyse").addEventListener("click", async () => {
  if (!currentPolygon) {
    showAnalysisHint("field");
    return;
  }

  if (workflowStep < 3 || !hasAnalysisDate()) {
    showAnalysisHint("date");
    return;
  }

  hideAnalysisHint();
  document.getElementById("btn-analyse").disabled = true;
  document.getElementById("loader").classList.add("visible");
  setResultsVisible(false);

  resultLayer.clearLayers();
  setWorkflowStep("running");

  try {
    const res = await fetch(`${API_URL}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        polygon: currentPolygon.map(p => ({ lat: p.lat, lng: p.lng })),
        analysis_date: document.getElementById("analysis-date").value
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.classification) {
      ocClassification = data.classification;
    }

    const fieldRing = currentPolygon.map(p => ({ lat: p.lat, lng: p.lng }));
    const viz = FieldGradientOverlay.addFieldVisualization({
      map,
      polygon: fieldRing,
      zones: data.zones,
      layerGroup: resultLayer,
      classification: data.classification,
      valueToColor,
      formatTooltip: (zone) =>
        `<b>${zone.label}</b><br>${formatOcValue(zone.value)}`,
    });

    const allBounds = [];
    if (viz.borderLayer) allBounds.push(viz.borderLayer.getBounds());
    else if (fieldRing.length >= 3) {
      allBounds.push(L.latLngBounds(fieldRing.map(p => [p.lat, p.lng])));
    }

    // =====================
    // SWITCH MODE AFTER SUCCESS
    // =====================
    switchToAnalysisMode();

    // Zoom to result
    const groupBounds = allBounds.reduce((b, next) => b.extend(next), allBounds[0]);
  map.flyToBounds(groupBounds, {padding: [30, 30], duration: 1.2});

    // Stats
    const values = data.zones.map(z => z.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    latestAnalysisData = {
      date: document.getElementById("analysis-date").value,
      polygon: currentPolygon.map(p => ({
        lat: p.lat,
        lng: p.lng
      })),
      avg_value: avg,
      min_value: Math.min(...values),
      max_value: Math.max(...values),
      zones: data.zones
    };

    document.getElementById("res-zones").textContent = data.zones.length;
    document.getElementById("res-avg").textContent = formatOcValue(avg);
    document.getElementById("res-max").textContent = formatOcValue(Math.max(...values));
    document.getElementById("res-min").textContent = formatOcValue(Math.min(...values));

    setResultsVisible(true);
    btnSaveDashboard.classList.add("visible");
    document.getElementById("btn-save-dashboard").style.display = "block";

    setWorkflowStep("complete");

  } catch (err) {
    if (hasAnalysisDate()) {
      setWorkflowStep(3);
    } else if (currentPolygon) {
      setWorkflowStep(2);
    } else {
      setWorkflowStep(1);
    }
    alert(MAP_UI.backend_unreachable.replace("{msg}", err.message));
  } finally {
    document.getElementById("loader").classList.remove("visible");
  }
});

// =====================
// RESET BUTTON
// =====================

document.getElementById("btn-reset").addEventListener("click", () => {
  drawnItems.clearLayers();
  resultLayer.clearLayers();
  currentPolygon = null;
  if (searchMarker) {
  map.removeLayer(searchMarker);
  searchMarker = null;
}

  ["stat-points", "stat-area"].forEach(id =>
    document.getElementById(id).textContent = "–"
  );

  document.getElementById("stat-status").textContent = MAP_UI.no_polygon;
  hideAnalysisHint();
  setResultsVisible(false);
  document.getElementById("btn-save-dashboard").style.display = "none";

  closeSavePopup();

  btnSaveDashboard.classList.remove("visible");

  switchToFieldMode();

  const dateInput = document.getElementById("analysis-date");
  if (dateInput) {
    dateInput.value = "";
  }

  setWorkflowStep(1);
});

// =====================
// Safe to personal dashboard
// =====================

// =====================
// SAVE POPUP ELEMENTS
// =====================

const savePopup = document.getElementById("save-popup");

const btnSaveDashboard = document.getElementById("btn-save-dashboard");

const closeSavePopupBtn = document.getElementById("close-save-popup");

const confirmDashboardSaveBtn = document.getElementById("confirm-dashboard-save");

const dashboardCropSelect = document.getElementById("dashboard-crop");

const dashboardCustomCrop = document.getElementById("dashboard-custom-crop");

const dashboardFieldName = document.getElementById("dashboard-field-name");

const dashboardNotes = document.getElementById("dashboard-notes");

const dashboardLocationName = document.getElementById("dashboard-location-name");

const saveSuccessPopup = document.getElementById("save-success-popup");
const closeSaveSuccessPopupBtn = document.getElementById("close-save-success-popup");
const btnSaveSuccessClose = document.getElementById("btn-save-success-close");


// =====================
// SAVE POPUP FUNCTIONS
// =====================

function openSavePopup() {
  if (!savePopup) return;

  savePopup.classList.add("visible");
}

function closeSavePopup() {
  if (!savePopup) return;

  savePopup.classList.remove("visible");
}

function openSaveSuccessPopup() {
  if (!saveSuccessPopup) return;
  saveSuccessPopup.classList.add("visible");
  saveSuccessPopup.setAttribute("aria-hidden", "false");
}

function closeSaveSuccessPopup() {
  if (!saveSuccessPopup) return;
  saveSuccessPopup.classList.remove("visible");
  saveSuccessPopup.setAttribute("aria-hidden", "true");
}

// =====================
// SAVE BUTTON EVENTS
// =====================

if (btnSaveDashboard) {
  btnSaveDashboard.addEventListener("click", () => {
    openSavePopup();
  });
}

if (closeSavePopupBtn) {
  closeSavePopupBtn.addEventListener("click", () => {
    closeSavePopup();
  });
}

if (savePopup) {
  savePopup.addEventListener("click", (e) => {
    if (e.target === savePopup) {
      closeSavePopup();
    }
  });
}

if (confirmDashboardSaveBtn) {
  confirmDashboardSaveBtn.addEventListener("click", async () => {

    if (!latestAnalysisData) return;

    let selectedCrop = dashboardCropSelect.value;

    // Falls custom crop gewählt wurde
    if (selectedCrop === "custom") {

      selectedCrop = dashboardCustomCrop.value.trim();

      if (!selectedCrop) {
        alert(MAP_UI.custom_crop_required);
        return;
      }
    }

    // Crop zur Analyse hinzufügen
    const payload = {
      ...latestAnalysisData,

      crop: selectedCrop,

      field_name:
        document.getElementById("dashboard-field-name").value,

      notes:
        document.getElementById("dashboard-notes").value,

      location_name:
        document.getElementById("dashboard-location-name").value
    };

    try {

      const res = await fetch(`${API_URL}/api/save-analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error("Save failed");
      }

      closeSavePopup();
      openSaveSuccessPopup();

    } catch (err) {

      console.error(err);

      alert(MAP_UI.save_failed);
    }

  });
}
// =====================
// CUSTOM CROP
// =====================

dashboardCropSelect.addEventListener("change", () => {

  if (dashboardCropSelect.value === "custom") {
    dashboardCustomCrop.style.display = "block";
  } else {
    dashboardCustomCrop.style.display = "none";
    dashboardCustomCrop.value = "";
  }

});

if (closeSaveSuccessPopupBtn) {
  closeSaveSuccessPopupBtn.addEventListener("click", closeSaveSuccessPopup);
}
if (btnSaveSuccessClose) {
  btnSaveSuccessClose.addEventListener("click", closeSaveSuccessPopup);
}
if (saveSuccessPopup) {
  saveSuccessPopup.addEventListener("click", (e) => {
    if (e.target === saveSuccessPopup) closeSaveSuccessPopup();
  });
}

// ESC close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSavePopup();
    closeSaveSuccessPopup();
    closeClassInfoPopup();
  }
});

// =====================
// OC CLASSIFICATION INFO
// =====================

const classInfoPopup = document.getElementById("class-info-popup");
const btnClassInfo = document.getElementById("btn-class-info");
const closeClassInfoBtn = document.getElementById("close-class-info");

function renderClassInfoPopup(classification) {
  const c = classification || ocClassification;
  if (!c) return;

  const noteEl = document.getElementById("class-info-note");
  const tiersEl = document.getElementById("class-info-tiers");
  const datasetEl = document.getElementById("class-info-dataset");
  const linkEl = document.getElementById("class-info-link");

  if (noteEl) {
    noteEl.textContent = [c.dataset_note, c.colormap_note].filter(Boolean).join(" ");
  }
  if (datasetEl) {
    datasetEl.textContent = `${c.dataset_name} · ${c.n_samples} ${c.n_samples === 1 ? (MAP_UI.point || "point") : (MAP_UI.points || "points")} · ${c.parameter}, ${c.depth_cm} cm`;
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
          const text = c.tier_descriptions[tier] || "";
          return `<li><span class="legend-swatch" style="background:${swatch};display:inline-block;vertical-align:middle;margin-right:8px;"></span>${text}</li>`;
        })
        .join("");
    }
  }
}

function openClassInfoPopup() {
  if (!classInfoPopup) return;
  renderClassInfoPopup(ocClassification);
  classInfoPopup.classList.add("visible");
  classInfoPopup.setAttribute("aria-hidden", "false");
}

function closeClassInfoPopup() {
  if (!classInfoPopup) return;
  classInfoPopup.classList.remove("visible");
  classInfoPopup.setAttribute("aria-hidden", "true");
}

if (btnClassInfo) {
  btnClassInfo.addEventListener("click", openClassInfoPopup);
}
if (closeClassInfoBtn) {
  closeClassInfoBtn.addEventListener("click", closeClassInfoPopup);
}
if (classInfoPopup) {
  classInfoPopup.addEventListener("click", (e) => {
    if (e.target === classInfoPopup) closeClassInfoPopup();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderClassInfoPopup(ocClassification);
});

