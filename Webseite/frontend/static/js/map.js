/* map.js — Leaflet Karte + Analyse
   API_URL und Übersetzungen werden von Jinja2 in analysis.html gesetzt
*/

const map = L.map("map").setView([46.8182, 8.2275], 8); // Schweiz gesamt

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors", maxZoom: 19
}).addTo(map);

const drawnItems = new L.FeatureGroup().addTo(map);
const resultLayer = new L.FeatureGroup().addTo(map);

map.addControl(new L.Control.Draw({
  edit: { featureGroup: drawnItems },
  draw: {
    polygon: { shapeOptions: { color: "#5A3A33" , fillOpacity: 0.15 } },
    polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
  }
}));

let currentPolygon = null;

function calcArea(latlngs) {
  const R = 6371000; let area = 0; const n = latlngs.length;
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

function valueToColor(v) {
  if (v >= 0.66) return `hsl(${120*v},70%,45%)`;
  if (v >= 0.33) return `hsl(${120*v},80%,48%)`;
  return `hsl(${120*v},75%,45%)`;
}

function setStep(n) {
  [1,2,3].forEach(i => {
    const el = document.getElementById(`step-${i}`);
    el.classList.remove("active","done");
    if (i < n) el.classList.add("done");
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

map.on(L.Draw.Event.CREATED, e => {
  drawnItems.clearLayers(); resultLayer.clearLayers();
  document.getElementById("result-box").classList.remove("visible");
  drawnItems.addLayer(e.layer);
  currentPolygon = e.layer.getLatLngs()[0];
  updateStats(currentPolygon);
});

map.on(L.Draw.Event.EDITED, () => {
  const layers = drawnItems.getLayers();
  if (layers.length) { currentPolygon = layers[0].getLatLngs()[0]; updateStats(currentPolygon); resultLayer.clearLayers(); document.getElementById("result-box").classList.remove("visible"); }
});

map.on(L.Draw.Event.DELETED, () => {
  currentPolygon = null;
  ["stat-points","stat-area"].forEach(id => document.getElementById(id).textContent = "–");
  document.getElementById("stat-status").textContent = "Kein Polygon";
  document.getElementById("btn-analyse").disabled = true;
  document.getElementById("result-box").classList.remove("visible");
  resultLayer.clearLayers(); setStep(1);
});

document.getElementById("btn-analyse").addEventListener("click", async () => {
  if (!currentPolygon) return;
  document.getElementById("btn-analyse").disabled = true;
  document.getElementById("loader").classList.add("visible");
  document.getElementById("result-box").classList.remove("visible");
  resultLayer.clearLayers(); setStep(3);
  try {
    const res = await fetch(`${API_URL}/api/predict`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ polygon: currentPolygon.map(p => ({ lat: p.lat, lng: p.lng })) })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    data.zones.forEach(zone => {
      const color = valueToColor(zone.value);
      const poly = L.polygon(zone.sub_polygon.map(c => [c.lat, c.lng]),
        { color, fillColor: color, fillOpacity: 0.65, weight: 0.5, opacity: 0.4 });
      poly.bindTooltip(`<b>${zone.label}</b><br>${data.unit}: ${(zone.value*100).toFixed(1)}%`, { sticky: true });
      resultLayer.addLayer(poly);
    });
    resultLayer.addLayer(L.polygon(currentPolygon.map(p => [p.lat, p.lng]),
      { color: "#5A3A33", fill: false, weight: 2.5 }));
    const values = data.zones.map(z => z.value);
    const avg = values.reduce((a,b) => a+b, 0) / values.length;
    document.getElementById("res-zones").textContent = data.zones.length;
    document.getElementById("res-avg").textContent   = (avg*100).toFixed(1) + "%";
    document.getElementById("res-max").textContent   = (Math.max(...values)*100).toFixed(1) + "%";
    document.getElementById("res-min").textContent   = (Math.min(...values)*100).toFixed(1) + "%";
    document.getElementById("result-box").classList.add("visible");
  } catch(err) {
    alert("Backend nicht erreichbar:\n" + err.message + "\n\nuvicorn main:app --reload");
  } finally {
    document.getElementById("loader").classList.remove("visible");
    document.getElementById("btn-analyse").disabled = false;
  }
});

document.getElementById("btn-reset").addEventListener("click", () => {
  drawnItems.clearLayers(); resultLayer.clearLayers(); currentPolygon = null;
  ["stat-points","stat-area"].forEach(id => document.getElementById(id).textContent = "–");
  document.getElementById("stat-status").textContent = "Kein Polygon";
  document.getElementById("btn-analyse").disabled = true;
  document.getElementById("result-box").classList.remove("visible");
  setStep(1);
});