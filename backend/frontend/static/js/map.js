/* map.js — Leaflet Karte + Analyse */

const map = L.map("map", {
  zoomAnimation: true,
  fadeAnimation: true,
  markerZoomAnimation: true
}).setView([51.1657, 10.4515], 7);

document.addEventListener("DOMContentLoaded", () => {
  const dateInput = document.getElementById("analysis-date");
  if (dateInput) {
    const today = new Date();
    dateInput.valueAsDate = today;

    // ❗ no future dates allowed
    dateInput.max = today.toISOString().split("T")[0];
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
  placeholder: "Search location or coordinates...",
  errorMessage: "Location not found",
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
  "Satellite": satellite,
  "Analysis": minimal
};

const overlays = {
  "Labels": labels,
  "Drawings": drawnItems,
  "Results": resultLayer
};

L.control.layers(baseLayers, overlays).addTo(map);

// =====================
// DRAW CONTROL
// =====================

map.addControl(new L.Control.Draw({
  edit: { featureGroup: drawnItems },
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
  const c = classification || ocClassification;
  const tier = ocTier(value, c);
  return (c && c.colors && c.colors[tier]) || OC_TIER_COLORS[tier] || OC_TIER_COLORS.medium;
}

function formatOcValue(value) {
  return `${Number(value).toFixed(1)} g/kg`;
}

function setStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById(`step-${i}`);
    el.classList.remove("active", "done");
    if (i < n) el.classList.add("done");
    if (i === n) el.classList.add("active");
  });
}

function updateStats(latlngs) {
  document.getElementById("stat-points").textContent = latlngs.length;
  document.getElementById("stat-area").textContent = calcArea(latlngs).toFixed(2) + " ha";
  document.getElementById("stat-status").textContent = "Bereit ✓";
  document.getElementById("btn-analyse").disabled = false;
  setStep(2);
}

// =====================
// DRAW EVENTS
// =====================

map.on(L.Draw.Event.CREATED, e => {
  drawnItems.clearLayers();
  resultLayer.clearLayers();

  document.getElementById("result-box").classList.remove("visible");
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
    document.getElementById("result-box").classList.remove("visible");
  }
});

map.on(L.Draw.Event.DELETED, () => {
  switchToFieldMode();

  currentPolygon = null;

  ["stat-points", "stat-area"].forEach(id =>
    document.getElementById(id).textContent = "–"
  );

  document.getElementById("stat-status").textContent = "Kein Polygon";
  document.getElementById("btn-analyse").disabled = true;

  resultLayer.clearLayers();
  document.getElementById("result-box").classList.remove("visible");

  setStep(1);

});

// =====================
// ANALYSE BUTTON
// =====================

document.getElementById("btn-analyse").addEventListener("click", async () => {
  if (!currentPolygon) return;

  document.getElementById("btn-analyse").disabled = true;
  document.getElementById("loader").classList.add("visible");
  document.getElementById("result-box").classList.remove("visible");

  resultLayer.clearLayers();
  setStep(3);

  document.getElementById("steps-container").classList.add("hidden");

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

    const allBounds = [];

    data.zones.forEach(zone => {
      const color = valueToColor(zone.value, data.classification);

      const poly = L.polygon(
        zone.sub_polygon.map(c => [c.lat, c.lng]),
        {
          color,
          fillColor: color,
          fillOpacity: 0.65,
          weight: 0.5,
          opacity: 0.4
        }
      );

      poly.bindTooltip(
        `<b>${zone.label}</b><br>${formatOcValue(zone.value)}`,
        { sticky: true }
      );

      resultLayer.addLayer(poly);
      allBounds.push(poly.getBounds());
    });

    const fieldBorder = L.polygon(
      currentPolygon.map(p => [p.lat, p.lng]),
      { color: "#C94F4F", fill: false, weight: 2.5 }
    );

    resultLayer.addLayer(fieldBorder);
    allBounds.push(fieldBorder.getBounds());

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

    document.getElementById("result-box").classList.add("visible");
    btnSaveDashboard.classList.add("visible");
    document.getElementById("btn-save-dashboard").style.display = "block";

  } catch (err) {
    alert("Backend nicht erreichbar:\n" + err.message);
  } finally {
    document.getElementById("loader").classList.remove("visible");
    document.getElementById("btn-analyse").disabled = false;
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

  document.getElementById("stat-status").textContent = "Kein Polygon";
  document.getElementById("btn-analyse").disabled = true;
  document.getElementById("result-box").classList.remove("visible");
  document.getElementById("btn-save-dashboard").style.display = "none";

  closeSavePopup();

  btnSaveDashboard.classList.remove("visible");

  switchToFieldMode();
  setStep(1);

  document.getElementById("steps-container").classList.remove("hidden");
  document.getElementById("btn-save-dashboard").style.display = "none";

  const dateInput = document.getElementById("analysis-date");
  if (dateInput) {
    dateInput.valueAsDate = new Date();
  }
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
        alert("Please enter a custom crop name");
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

      alert("Analysis saved to dashboard ✓");

    } catch (err) {

      console.error(err);

      alert("Could not save analysis");
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

// ESC close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSavePopup();
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

  if (noteEl) noteEl.textContent = c.dataset_note || "";
  if (datasetEl) {
    datasetEl.textContent = `${c.dataset_name} · ${c.n_samples} ${c.n_samples === 1 ? "point" : "points"} · ${c.parameter}, ${c.depth_cm} cm`;
  }
  if (linkEl && c.reference_url) linkEl.href = c.reference_url;

  if (tiersEl && c.tier_descriptions) {
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