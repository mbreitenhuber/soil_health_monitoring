/* ══════════════════════════════════════════════════════
   map.js — Leaflet Karte + Analyse-Logik
   
   Konfiguration:
     API_URL  → Backend-URL (lokal oder Render)
     setView  → Startposition der Karte
                [lat, lng], zoom
                Schweiz gesamt: [46.8182, 8.2275], 8
                Zürich:         [47.37,   8.54  ], 13
══════════════════════════════════════════════════════ */

const API_URL = "http://localhost:8000";

/* ── Karte initialisieren ──────────────────────────── */
const map = L.map("map").setView([46.8182, 8.2275], 8);
window._map = map; // Referenz für nav.js (invalidateSize)

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
}).addTo(map);

/* ── Layer Groups ──────────────────────────────────── */
const drawnItems = new L.FeatureGroup().addTo(map);
const resultLayer = new L.FeatureGroup().addTo(map);

/* ── Zeichenwerkzeuge ──────────────────────────────── */
const drawControl = new L.Control.Draw({
  edit: { featureGroup: drawnItems },
  draw: {
    polygon:      { shapeOptions: { color: "#4ade80", fillOpacity: 0.15 } },
    polyline:     false,
    rectangle:    false,
    circle:       false,
    marker:       false,
    circlemarker: false
  }
});
map.addControl(drawControl);

/* ── State ─────────────────────────────────────────── */
let currentPolygon = null;

/* ── Hilfsfunktionen ───────────────────────────────── */
function calcArea(latlngs) {
  // Shoelace-Formel → Hektar
  const R = 6371000;
  let area = 0;
  const n = latlngs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = latlngs[i].lng * Math.PI / 180 * R * Math.cos(latlngs[i].lat * Math.PI / 180);
    const yi = latlngs[i].lat * Math.PI / 180 * R;
    const xj = latlngs[j].lng * Math.PI / 180 * R * Math.cos(latlngs[j].lat * Math.PI / 180);
    const yj = latlngs[j].lat * Math.PI / 180 * R;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2) / 10000;
}

function valueToColor(value) {
  if (value >= 0.66) return `hsl(${120 * value}, 70%, 45%)`;
  if (value >= 0.33) return `hsl(${120 * value}, 80%, 48%)`;
  return `hsl(${120 * value}, 75%, 45%)`;
}

function setStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById(`step-${i}`);
    el.classList.remove("active", "done");
    if (i < n)  el.classList.add("done");
    if (i === n) el.classList.add("active");
  });
}

function updateStats(latlngs) {
  document.getElementById("stat-points").textContent = latlngs.length;
  document.getElementById("stat-area").textContent   = calcArea(latlngs).toFixed(2) + " ha";
  document.getElementById("stat-status").textContent = "Bereit ✓";
  document.getElementById("btn-analyse").disabled    = false;
  setStep(2);
}

/* ── Polygon gezeichnet ────────────────────────────── */
map.on(L.Draw.Event.CREATED, function (e) {
  drawnItems.clearLayers();
  resultLayer.clearLayers();
  document.getElementById("result-box").classList.remove("visible");
  drawnItems.addLayer(e.layer);
  currentPolygon = e.layer.getLatLngs()[0];
  updateStats(currentPolygon);
});

map.on(L.Draw.Event.EDITED, function () {
  const layers = drawnItems.getLayers();
  if (layers.length > 0) {
    currentPolygon = layers[0].getLatLngs()[0];
    updateStats(currentPolygon);
    resultLayer.clearLayers();
    document.getElementById("result-box").classList.remove("visible");
  }
});

map.on(L.Draw.Event.DELETED, function () {
  currentPolygon = null;
  document.getElementById("stat-points").textContent = "–";
  document.getElementById("stat-area").textContent   = "–";
  document.getElementById("stat-status").textContent = "Kein Polygon";
  document.getElementById("btn-analyse").disabled    = true;
  document.getElementById("result-box").classList.remove("visible");
  resultLayer.clearLayers();
  setStep(1);
});

/* ── Analyse starten ───────────────────────────────── */
document.getElementById("btn-analyse").addEventListener("click", async () => {
  if (!currentPolygon) return;

  document.getElementById("btn-analyse").disabled = true;
  document.getElementById("loader").classList.add("visible");
  document.getElementById("result-box").classList.remove("visible");
  resultLayer.clearLayers();
  setStep(3);

  const payload = {
    polygon: currentPolygon.map(p => ({ lat: p.lat, lng: p.lng }))
  };

  try {
    const response = await fetch(`${API_URL}/predict`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Zonen auf Karte zeichnen
    data.zones.forEach(zone => {
      const coords = zone.sub_polygon.map(c => [c.lat, c.lng]);
      const color  = valueToColor(zone.value);
      const poly   = L.polygon(coords, {
        color, fillColor: color, fillOpacity: 0.65, weight: 0.5, opacity: 0.4
      });
      poly.bindTooltip(
        `<b>${zone.label}</b><br>${data.unit}: ${(zone.value * 100).toFixed(1)}%`,
        { sticky: true, className: "leaflet-tooltip-dark" }
      );
      resultLayer.addLayer(poly);
    });

    // Polygon-Umriss über die Zonen legen
    resultLayer.addLayer(
      L.polygon(currentPolygon.map(p => [p.lat, p.lng]),
        { color: "#4ade80", fill: false, weight: 2.5 })
    );

    // Statistiken
    const values = data.zones.map(z => z.value);
    const avg    = values.reduce((a, b) => a + b, 0) / values.length;
    document.getElementById("res-zones").textContent = data.zones.length;
    document.getElementById("res-avg").textContent   = (avg * 100).toFixed(1) + "%";
    document.getElementById("res-max").textContent   = (Math.max(...values) * 100).toFixed(1) + "%";
    document.getElementById("res-min").textContent   = (Math.min(...values) * 100).toFixed(1) + "%";
    document.getElementById("result-box").classList.add("visible");

  } catch (err) {
    alert("Fehler beim Verbinden mit dem Backend:\n" + err.message +
          "\n\nStarte das Backend mit: uvicorn main:app --reload");
  } finally {
    document.getElementById("loader").classList.remove("visible");
    document.getElementById("btn-analyse").disabled = false;
  }
});

/* ── Reset ─────────────────────────────────────────── */
document.getElementById("btn-reset").addEventListener("click", () => {
  drawnItems.clearLayers();
  resultLayer.clearLayers();
  currentPolygon = null;
  document.getElementById("stat-points").textContent = "–";
  document.getElementById("stat-area").textContent   = "–";
  document.getElementById("stat-status").textContent = "Kein Polygon";
  document.getElementById("btn-analyse").disabled    = true;
  document.getElementById("result-box").classList.remove("visible");
  setStep(1);
});
