/**
 * Clipped smooth gradient fill inside a field polygon (visual only).
 * Measurement values stay on the 60 m grid cells from the API.
 */
(function (global) {
  "use strict";

  const TIER_COLORS = {
    low: "#ef4444",
    medium: "#f59e0b",
    high: "#22c55e",
  };

  function normalizePolygon(ring) {
    if (!ring || !ring.length) return [];
    return ring.map((p) => ({
      lat: p.lat ?? p[0],
      lng: p.lng ?? p[1],
    }));
  }

  function zoneSample(zone) {
    const poly = zone.sub_polygon || [];
    if (!poly.length) return null;
    let lat = 0;
    let lng = 0;
    for (const p of poly) {
      lat += p.lat;
      lng += p.lng;
    }
    return {
      lat: lat / poly.length,
      lng: lng / poly.length,
      value: Number(zone.value),
      label: zone.label || "",
      // Used for "value under cursor": sub-polygon of the 60×60 m cell.
      cellRing: normalizePolygon(poly),
      zone,
    };
  }

  function pointInPolygon(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i].lat;
      const xi = ring[i].lng;
      const yj = ring[j].lat;
      const xj = ring[j].lng;
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng =
      ((lng2 - lng1) * Math.PI) / 180 * Math.cos((lat1 * Math.PI) / 180);
    return R * Math.sqrt(dLat * dLat + dLng * dLng);
  }

  /** Shepard-style weights: smoother than pure 1/d^p (no hard cell edges). */
  function idwWeight(dMeters, power, smoothM) {
    return 1 / (Math.pow(dMeters, power) + Math.pow(smoothM, power));
  }

  function idwRgb(lat, lng, samples, power, smoothM, maxNeighbors) {
    if (!samples.length) return { r: 128, g: 128, b: 128 };

    let pool = samples;
    if (maxNeighbors > 0 && samples.length > maxNeighbors) {
      pool = samples
        .map((s) => ({
          s,
          d: distanceMeters(lat, lng, s.lat, s.lng),
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, maxNeighbors)
        .map((x) => x.s);
    }

    let sumW = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const s of pool) {
      const d = distanceMeters(lat, lng, s.lat, s.lng);
      if (d < 0.25) return { r: s.r, g: s.g, b: s.b };
      const w = idwWeight(d, power, smoothM);
      sumW += w;
      r += w * s.r;
      g += w * s.g;
      b += w * s.b;
    }
    if (sumW <= 0) return { r: pool[0].r, g: pool[0].g, b: pool[0].b };
    return { r: r / sumW, g: g / sumW, b: b / sumW };
  }

  function hexToRgb(hex) {
    const h = (hex || "").replace("#", "");
    const n = parseInt(
      h.length === 3 ? h.split("").map((c) => c + c).join("") : h,
      16
    );
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function lerpRgb(a, b, t) {
    const u = Math.max(0, Math.min(1, t));
    return {
      r: a.r + (b.r - a.r) * u,
      g: a.g + (b.g - a.g) * u,
      b: a.b + (b.b - a.b) * u,
    };
  }

  function valueToColorContinuous(value, classification) {
    const c = classification;
    if (!c || c.threshold_low_gkg == null || c.threshold_high_gkg == null) {
      return TIER_COLORS.medium;
    }
    const low = c.threshold_low_gkg;
    const high = c.threshold_high_gkg;
    const colLow = hexToRgb(c.colors?.low || TIER_COLORS.low);
    const colMid = hexToRgb(c.colors?.medium || TIER_COLORS.medium);
    const colHigh = hexToRgb(c.colors?.high || TIER_COLORS.high);
    const mid = (low + high) / 2;

    if (value <= low) return c.colors?.low || TIER_COLORS.low;
    if (value >= high) return c.colors?.high || TIER_COLORS.high;
    if (value < mid) {
      const t = (value - low) / (mid - low);
      const rgb = lerpRgb(colLow, colMid, t);
      return (
        "#" +
        [rgb.r, rgb.g, rgb.b]
          .map((x) => Math.round(x).toString(16).padStart(2, "0"))
          .join("")
      );
    }
    const t = (value - mid) / (high - mid);
    const rgb = lerpRgb(colMid, colHigh, t);
    return (
      "#" +
      [rgb.r, rgb.g, rgb.b]
        .map((x) => Math.round(x).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function bboxFromRing(ringPx) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ringPx) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function buildColoredSamples(zones, colorForValue) {
    return zones
      .map(zoneSample)
      .filter(Boolean)
      .map((s) => {
        const hex = colorForValue(s.value);
        const rgb = hexToRgb(hex);
        return { lat: s.lat, lng: s.lng, r: rgb.r, g: rgb.g, b: rgb.b, zone: s.zone, label: s.label, value: s.value };
      });
  }

  function renderSmoothField(map, polygon, coloredSamples, ringPx, options) {
    const { minX, minY, maxX, maxY } = bboxFromRing(ringPx);
    const pad = 2;
    const boxW = Math.max(1, Math.ceil(maxX - minX) + pad * 2);
    const boxH = Math.max(1, Math.ceil(maxY - minY) + pad * 2);
    const maxDim = options.renderMaxPx || 384;
    const scale = Math.min(1, maxDim / Math.max(boxW, boxH));
    const w = Math.max(2, Math.ceil(boxW * scale));
    const h = Math.max(2, Math.ceil(boxH * scale));

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d", { willReadFrequently: true });
    const img = octx.createImageData(w, h);
    const data = img.data;

    const power = options.idwPower ?? 2.5;
    const smoothM = options.idwSmoothM ?? 18;
    const maxNeighbors = options.idwMaxNeighbors ?? 10;
    const ox = minX - pad;
    const oy = minY - pad;

    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = ox + (i + 0.5) / scale;
        const y = oy + (j + 0.5) / scale;
        const ll = map.containerPointToLatLng([x, y]);
        const idx = (j * w + i) * 4;
        if (!pointInPolygon(ll.lat, ll.lng, polygon)) {
          data[idx + 3] = 0;
          continue;
        }
        const rgb = idwRgb(
          ll.lat,
          ll.lng,
          coloredSamples,
          power,
          smoothM,
          maxNeighbors
        );
        data[idx] = rgb.r;
        data[idx + 1] = rgb.g;
        data[idx + 2] = rgb.b;
        data[idx + 3] = 255;
      }
    }

    octx.putImageData(img, 0, 0);
    return { offscreen: off, destX: ox, destY: oy, destW: boxW, destH: boxH };
  }

  const FieldGradientLayer = L.Layer.extend({
    initialize(polygonLatLng, zones, options) {
      this._polygon = normalizePolygon(polygonLatLng);
      this._zones = zones || [];
      this._options = L.Util.extend(
        {
          opacity: 0.88,
          idwPower: 2.5,
          idwSmoothM: 18,
          idwMaxNeighbors: 10,
          renderMaxPx: 480,
          upscaleSmoothing: false,
          classification: null,
          valueToColor: null,
        },
        options || {}
      );
      this._rawSamples = this._zones.map(zoneSample).filter(Boolean);
    },

    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "leaflet-field-gradient");
      this._canvas.style.pointerEvents = "none";
      map.getPanes().overlayPane.appendChild(this._canvas);
      this._redraw = this._redraw.bind(this);
      map.on("move zoom resize viewreset", this._redraw, this);
      this._redraw();
    },

    onRemove(map) {
      map.off("move zoom resize viewreset", this._redraw, this);
      L.DomUtil.remove(this._canvas);
      this._canvas = null;
    },

    _colorForValue(value) {
      const fn = this._options.valueToColor;
      if (typeof fn === "function") {
        return fn(value, this._options.classification);
      }
      return valueToColorContinuous(value, this._options.classification);
    },

    _redraw() {
      const map = this._map;
      const canvas = this._canvas;
      if (!map || !canvas || !this._polygon.length || !this._rawSamples.length) return;

      const size = map.getSize();
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(size.x * dpr));
      canvas.height = Math.max(1, Math.floor(size.y * dpr));
      canvas.style.width = size.x + "px";
      canvas.style.height = size.y + "px";

      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);

      const ringPx = this._polygon.map((p) =>
        map.latLngToContainerPoint([p.lat, p.lng])
      );

      const coloredSamples = buildColoredSamples(this._zones, (v) =>
        this._colorForValue(v)
      );

      const rendered = renderSmoothField(
        map,
        this._polygon,
        coloredSamples,
        ringPx,
        this._options
      );

      ctx.save();
      ctx.beginPath();
      ringPx.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.clip();

      ctx.globalAlpha = this._options.opacity;
      ctx.imageSmoothingEnabled = this._options.upscaleSmoothing !== false;
      if (ctx.imageSmoothingEnabled) {
        ctx.imageSmoothingQuality = "medium";
      }
      ctx.drawImage(
        rendered.offscreen,
        0,
        0,
        rendered.offscreen.width,
        rendered.offscreen.height,
        rendered.destX,
        rendered.destY,
        rendered.destW,
        rendered.destH
      );
      ctx.restore();
    },
  });

  /** Find the zone cell under the cursor (fallback: nearest). */
  function sampleForPointer(lat, lng, samples) {
    // First try exact "cell under cursor"
    for (const s of samples) {
      if (s.cellRing && s.cellRing.length >= 3 && pointInPolygon(lat, lng, s.cellRing)) {
        return s;
      }
    }

    // Fallback to nearest cell center (more forgiving at borders / gaps)
    let best = null;
    let bestD = Infinity;
    for (const s of samples) {
      const d = distanceMeters(lat, lng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /**
   * One tooltip for the whole field: follows the cursor, shows nearest cell value.
   * Avoids tiny per-point hit circles and flicker between overlapping tooltips.
   */
  function addFieldHoverTooltip(polygon, samples, formatTooltip, layerGroup) {
    const ring = normalizePolygon(polygon);
    if (ring.length < 3 || !samples.length) return null;

    const fmt =
      typeof formatTooltip === "function"
        ? formatTooltip
        : (zone) =>
            `<b>${zone.label || "–"}</b><br>OC: ${Number(zone.value).toFixed(1)} g/kg`;

    let hoverTooltip = null;
    let hideTimer = null;
    const HIDE_DELAY_MS = 550;

    const hitLayer = L.polygon(
      ring.map((p) => [p.lat, p.lng]),
      {
        fill: true,
        fillOpacity: 0.02,
        color: "transparent",
        weight: 0,
        interactive: true,
        className: "field-hover-hit",
      }
    );

    function clearHideTimer() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }

    function showTooltip(latlng, sample) {
      const map = hitLayer._map;
      if (!map || !sample) return;

      const html = fmt(sample.zone || sample);
      if (!hoverTooltip) {
        hoverTooltip = L.tooltip({
          sticky: true,
          opacity: 0.96,
          className: "field-value-tooltip",
        })
          .setContent(html)
          .setLatLng(latlng);
        hoverTooltip.addTo(map);
      } else {
        hoverTooltip.setContent(html).setLatLng(latlng);
        if (!map.hasLayer(hoverTooltip)) hoverTooltip.addTo(map);
      }
    }

    function hideTooltip() {
      const map = hitLayer._map;
      if (hoverTooltip && map) {
        map.removeLayer(hoverTooltip);
      }
      hoverTooltip = null;
    }

    hitLayer.on("mousemove", (e) => {
      clearHideTimer();
      const sample = sampleForPointer(e.latlng.lat, e.latlng.lng, samples);
      if (sample) showTooltip(e.latlng, sample);
    });

    hitLayer.on("mouseout", () => {
      clearHideTimer();
      hideTimer = setTimeout(hideTooltip, HIDE_DELAY_MS);
    });

    (layerGroup || hitLayer).addLayer(hitLayer);
    return hitLayer;
  }

  /**
   * @returns {{ gradientLayer, tooltipLayer, borderLayer, samples }}
   */
  function addFieldVisualization({
    map,
    polygon,
    zones,
    layerGroup,
    classification,
    valueToColor,
    formatTooltip,
    borderColor = "#C94F4F",
    borderWeight = 2.5,
    /** Extra options for FieldGradientLayer (e.g. renderMaxPx for small maps). */
    gradientOptions = {},
  }) {
    const ring = normalizePolygon(polygon);
    const samples = (zones || []).map(zoneSample).filter(Boolean);
    const target = layerGroup || map;

    const gradientLayer = new FieldGradientLayer(ring, zones, {
      classification,
      valueToColor,
      ...gradientOptions,
    });
    target.addLayer(gradientLayer);

    let borderLayer = null;
    if (ring.length >= 3) {
      borderLayer = L.polygon(
        ring.map((p) => [p.lat, p.lng]),
        { color: borderColor, fill: false, weight: borderWeight, interactive: false }
      );
      target.addLayer(borderLayer);
    }

    const tooltipLayer = addFieldHoverTooltip(
      ring,
      samples,
      formatTooltip,
      target
    );

    return { gradientLayer, tooltipLayer, borderLayer, samples };
  }

  global.FieldGradientOverlay = {
    FieldGradientLayer,
    addFieldVisualization,
    valueToColorContinuous,
    zoneSample,
    normalizePolygon,
    TIER_COLORS,
  };
})(typeof window !== "undefined" ? window : this);
