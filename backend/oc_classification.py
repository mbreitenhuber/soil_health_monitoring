"""
Soil organic carbon (OC) quality tiers based on the LUCAS reference distribution.

Tiers use the 30th and 70th percentiles of OC (g/kg, 0–20 cm) in the processed
Germany LUCAS subset — bottom 30 % → low, middle 40 % → medium, top 30 % → high.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import pandas as pd

Tier = Literal["low", "medium", "high"]

LUCAS_DE_DATASET = Path(__file__).resolve().parent / "data" / "datasets" / "LUCAS_SOIL_processed_DE.csv"
LUCAS_REFERENCE_URL = "https://esdac.jrc.ec.europa.eu/content/lucas-2018-topsoil-data"
LUCAS_REFERENCE_TITLE = "LUCAS Soil Data (ESDAC, European Commission JRC)"

# Fallback if the CSV is missing (computed from LUCAS_SOIL_processed_DE.csv, n=332)
_FALLBACK_LOW_GKG = 13.1
_FALLBACK_HIGH_GKG = 19.7
_FALLBACK_N = 332

# Upper bounds per LUCAS DE reference (g/kg OC); finer steps in the mid-range (25–85 %)
_FALLBACK_DISCRETE_BOUNDARIES_GKG = [
    9.9,
    11.7,
    12.6,
    13.1,
    14.08,
    14.7,
    15.6,
    16.0,
    17.01,
    17.7,
    18.62,
    19.77,
    20.73,
    22.08,
    24.63,
    29.48,
    54.7,
]
_DISCRETE_PERCENTILES = [
    0.10,
    0.20,
    0.25,
    0.30,
    0.35,
    0.40,
    0.45,
    0.50,
    0.55,
    0.60,
    0.65,
    0.70,
    0.75,
    0.80,
    0.85,
    0.90,
    0.99,
]
_DISCRETE_PERCENTILE_LABELS = [
    10,
    20,
    25,
    30,
    35,
    40,
    45,
    50,
    55,
    60,
    65,
    70,
    75,
    80,
    85,
    90,
    99,
]

TIER_COLORS = {
    "low": "#ef4444",
    "medium": "#f59e0b",
    "high": "#22c55e",
}


@lru_cache(maxsize=1)
def lucas_oc_discrete_boundaries() -> tuple[list[float], int]:
    """Return (upper bounds per percentile step in g/kg, sample count)."""
    if not LUCAS_DE_DATASET.is_file():
        return list(_FALLBACK_DISCRETE_BOUNDARIES_GKG), _FALLBACK_N

    df = pd.read_csv(LUCAS_DE_DATASET)
    oc = pd.to_numeric(df["OC"], errors="coerce").dropna()
    if oc.empty:
        return list(_FALLBACK_DISCRETE_BOUNDARIES_GKG), _FALLBACK_N

    bounds = [round(float(oc.quantile(p)), 2) for p in _DISCRETE_PERCENTILES]
    return bounds, int(len(oc))


@lru_cache(maxsize=1)
def plasma_discrete_colors(n: int = 10) -> list[str]:
    """Sample the matplotlib plasma colormap into *n* discrete hex colors (low → high)."""
    import matplotlib.colors as mcolors
    import matplotlib.pyplot as plt

    cmap = plt.cm.plasma
    return [mcolors.to_hex(cmap(i / (n - 1))) for i in range(n)]


def oc_discrete_bin_index(value_gkg: float, boundaries_gkg: list[float]) -> int:
    """Map OC (g/kg) to bin 0 … len(boundaries)-1 using percentile upper bounds."""
    for i, upper in enumerate(boundaries_gkg):
        if value_gkg <= upper:
            return i
    return len(boundaries_gkg) - 1


def oc_discrete_color(value_gkg: float, boundaries_gkg: list[float], colors: list[str]) -> str:
    idx = oc_discrete_bin_index(value_gkg, boundaries_gkg)
    return colors[min(idx, len(colors) - 1)]


@lru_cache(maxsize=1)
def lucas_oc_percentile_thresholds() -> tuple[float, float, int]:
    """Return (30th percentile, 70th percentile, sample count) in g/kg OC."""
    if not LUCAS_DE_DATASET.is_file():
        return _FALLBACK_LOW_GKG, _FALLBACK_HIGH_GKG, _FALLBACK_N

    df = pd.read_csv(LUCAS_DE_DATASET)
    oc = pd.to_numeric(df["OC"], errors="coerce").dropna()
    if oc.empty:
        return _FALLBACK_LOW_GKG, _FALLBACK_HIGH_GKG, _FALLBACK_N

    return (
        float(oc.quantile(0.30)),
        float(oc.quantile(0.70)),
        int(len(oc)),
    )


def oc_tier(value_gkg: float, threshold_low: float, threshold_high: float) -> Tier:
    if value_gkg < threshold_low:
        return "low"
    if value_gkg < threshold_high:
        return "medium"
    return "high"


def oc_tier_label(value_gkg: float, threshold_low: float, threshold_high: float, lang: str = "de") -> str:
    tier = oc_tier(value_gkg, threshold_low, threshold_high)
    labels = {
        "de": {"low": "Niedrig", "medium": "Mittel", "high": "Hoch"},
        "en": {"low": "Low", "medium": "Medium", "high": "High"},
    }
    return labels.get(lang, labels["de"])[tier]


def _discrete_bin_labels_short(
    boundaries_gkg: list[float],
    percentiles: list[int],
) -> list[str]:
    return [f"P{pct} · ≤{upper:.1f}" for upper, pct in zip(boundaries_gkg, percentiles)]


def _discrete_bin_labels(
    boundaries_gkg: list[float],
    percentiles: list[int],
    lang: str,
) -> list[str]:
    labels: list[str] = []
    prev = 0.0
    for i, (upper, pct) in enumerate(zip(boundaries_gkg, percentiles)):
        if lang == "en":
            if i == 0:
                labels.append(f"≤ {upper:.1f} g/kg (≤ {pct}th percentile)")
            else:
                labels.append(f"> {prev:.1f} – {upper:.1f} g/kg (≤ {pct}th percentile)")
        else:
            if i == 0:
                labels.append(f"≤ {upper:.1f} g/kg (≤ {pct}. Perzentil)")
            else:
                labels.append(f"> {prev:.1f} – {upper:.1f} g/kg (≤ {pct}. Perzentil)")
        prev = upper
    return labels


def _format_percentile_list(percentiles: list[int], lang: str) -> str:
    if not percentiles:
        return ""
    if lang == "en":
        parts = [f"{p}th" for p in percentiles]
        if len(parts) == 1:
            return parts[0]
        return ", ".join(parts[:-1]) + f", and {parts[-1]}"
    parts = [f"{p}." for p in percentiles]
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + f" und {parts[-1]}"


def _howto_tier_groups(
    boundaries: list[float],
    colors: list[str],
    percentiles: list[int],
    threshold_low: float,
    threshold_high: float,
    n_samples: int,
    lang: str,
) -> tuple[str, list[dict[str, Any]]]:
    low_idx = [i for i, p in enumerate(percentiles) if p <= 30]
    med_idx = [i for i, p in enumerate(percentiles) if 30 < p <= 70]
    high_idx = [i for i, p in enumerate(percentiles) if p > 70]

    pct_steps = ", ".join(str(p) for p in percentiles)

    if lang == "en":
        intro = (
            f"AgroScan compares each grid cell's predicted soil organic carbon (SOC, g/kg in the "
            f"0–20 cm topsoil) with the distribution of measured OC from the LUCAS Soil survey in "
            f"Germany ({n_samples} agricultural sampling points in our processed subset). "
            f"<strong>Percentile thresholds</strong> are computed from that reference: the 30th percentile "
            f"({threshold_low:.1f} g/kg), for example, is the value below which 30 % of LUCAS (DE) "
            f"measurements fall. On the map, SOC is shown with the <strong>plasma</strong> colormap in "
            f"{len(boundaries)} discrete steps at reference percentiles ({pct_steps}) so you can "
            f"see variation within your field. The three bands below group those shades by "
            f"<strong>recommended actions</strong> (bottom 30 %, middle 40 %, top 30 % of the LUCAS distribution) "
            f"— finer color steps do not change what we suggest you do."
        )
        groups = [
            {
                "tier": "high",
                "colors": [colors[i] for i in high_idx],
                "title": (
                    f"High SOC — top 30 % of LUCAS (DE), SOC ≥ {threshold_high:.1f} g/kg"
                ),
                "map_steps": (
                    f"Plasma shades on the map: {_format_percentile_list([percentiles[i] for i in high_idx], lang)} percentile"
                    + ("s" if len(high_idx) != 1 else "")
                ),
                "body": (
                    "These zones show strong indicators of high soil organic carbon content. "
                    "They are in the top 30th percentile of the SOC distribution of agricultural "
                    "fields in Germany. Fields or sub-areas in this range are performing well. "
                    "Your sustainable soil management practices are likely to be working. Feel free "
                    "to share your experience in the upcoming community forum for farmers in your area!"
                ),
            },
            {
                "tier": "medium",
                "colors": [colors[i] for i in med_idx],
                "title": (
                    f"Medium SOC — middle 40 %, {threshold_low:.1f} – {threshold_high:.1f} g/kg"
                ),
                "map_steps": (
                    f"Plasma shades on the map: {_format_percentile_list([percentiles[i] for i in med_idx], lang)} percentiles"
                ),
                "body": (
                    "These zones are within an acceptable range, but some show variability. Try "
                    "implementing sustainable soil management practices (SSM) like reduced tillage, "
                    "crop diversification and cover cropping. Monitoring these areas over successive "
                    "analyses can help identify whether SOC content is increasing or decreasing. "
                    "We are in the process of implementing a community forum where you can find out "
                    "what farmers in your area are doing to increase their SOC level and share your progress."
                ),
            },
            {
                "tier": "low",
                "colors": [colors[i] for i in low_idx],
                "title": (
                    f"Low SOC — bottom 30 % of LUCAS (DE), SOC &lt; {threshold_low:.1f} g/kg"
                ),
                "map_steps": (
                    f"Plasma shades on the map: {_format_percentile_list([percentiles[i] for i in low_idx], lang)} percentile"
                    + ("s" if len(low_idx) != 1 else "")
                ),
                "body": (
                    "These zones flag areas that may require attention. They are in the bottom 30th "
                    "percentile of the SOC distribution of agricultural fields in Germany. Try "
                    "implementing sustainable soil management practices and continuous monitoring to "
                    "assess their impact. In the upcoming community forum, you can learn about SSM "
                    "practices that farmers in your area are employing."
                ),
            },
        ]
        return intro, groups

    intro = (
        f"AgroScan vergleicht den vorhergesagten organischen Kohlenstoff (SOC, g/kg in "
        f"0–20 cm) jeder Rasterzelle mit der Verteilung gemessener OC-Werte aus der "
        f"LUCAS-Bodenerhebung in Deutschland ({n_samples} landwirtschaftliche Messpunkte in "
        f"unserer aufbereiteten Stichprobe). <strong>Perzentil-Schwellen</strong> werden aus dieser Referenz "
        f"berechnet: Das 30. Perzentil ({threshold_low:.1f} g/kg) ist z. B. der Wert, unter dem "
        f"30 % der LUCAS (DE)-Messungen liegen. Auf der Karte wird SOC mit der <strong>Plasma</strong>-Farbskala "
        f"in {len(boundaries)} diskreten Stufen an Referenzperzentilen ({pct_steps}) dargestellt. "
        f"Die drei Bänder unten fassen diese Farbtöne nach <strong>empfohlenen Massnahmen</strong> zusammen "
        f"(unteres 30 %, mittleres 40 %, oberes 30 % der LUCAS-Verteilung) — feinere Farbstufen "
        f"ändern nicht, was wir empfehlen."
    )
    groups = [
        {
            "tier": "high",
            "colors": [colors[i] for i in high_idx],
            "title": f"Hoher SOC — oberes 30 % (LUCAS DE), SOC ≥ {threshold_high:.1f} g/kg",
            "map_steps": (
                f"Plasma-Farbtöne auf der Karte: {_format_percentile_list([percentiles[i] for i in high_idx], lang)} Perzentil"
                + ("e" if len(high_idx) != 1 else "")
            ),
            "body": (
                "Diese Zonen zeigen starke Hinweise auf hohen organischen Kohlenstoff im Boden. "
                "Sie liegen im oberen 30. Perzentil der SOC-Verteilung landwirtschaftlicher Flächen "
                "in Deutschland. Ihre nachhaltigen Bodenbewirtschaftungspraktiken wirken vermutlich. "
                "Teilen Sie gern Ihre Erfahrungen im geplanten Forum für Landwirtinnen und Landwirte in Ihrer Region."
            ),
        },
        {
            "tier": "medium",
            "colors": [colors[i] for i in med_idx],
            "title": (
                f"Mittlerer SOC — mittleres 40 %, {threshold_low:.1f} – {threshold_high:.1f} g/kg"
            ),
            "map_steps": (
                f"Plasma-Farbtöne auf der Karte: {_format_percentile_list([percentiles[i] for i in med_idx], lang)} Perzentile"
            ),
            "body": (
                "Diese Zonen liegen in einem akzeptablen Bereich, zeigen aber teils Variabilität. "
                "Probieren Sie nachhaltige Bodenbewirtschaftung (z. B. reduzierte Bearbeitung, "
                "Fruchtfolge, Zwischenfrüchte). Wiederholte Analysen zeigen, ob der SOC steigt oder fällt."
            ),
        },
        {
            "tier": "low",
            "colors": [colors[i] for i in low_idx],
            "title": f"Niedriger SOC — unteres 30 % (LUCAS DE), SOC &lt; {threshold_low:.1f} g/kg",
            "map_steps": (
                f"Plasma-Farbtöne auf der Karte: {_format_percentile_list([percentiles[i] for i in low_idx], lang)} Perzentil"
                + ("e" if len(low_idx) != 1 else "")
            ),
            "body": (
                "Diese Zonen können Aufmerksamkeit brauchen — unteres 30. Perzentil der SOC-Verteilung "
                "in Deutschland. Setzen Sie nachhaltige Bodenbewirtschaftung und Monitoring um."
            ),
        },
    ]
    return intro, groups


def oc_classification_meta(lang: str = "de") -> dict[str, Any]:
    low, high, n = lucas_oc_percentile_thresholds()
    boundaries, _ = lucas_oc_discrete_boundaries()
    discrete_colors = plasma_discrete_colors(len(boundaries))
    if lang not in ("en", "de"):
        lang = "de"

    if lang == "en":
        dataset_note = (
            f"Thresholds are the 30th and 70th percentiles of measured topsoil OC (0–20 cm) "
            f"in the processed LUCAS Germany subset ({n} sampling points)."
        )
        tier_descriptions = {
            "low": f"Bottom 30 % of LUCAS (DE): OC &lt; {low:.1f} g/kg",
            "medium": f"Middle 40 %: {low:.1f} – {high:.1f} g/kg",
            "high": f"Top 30 %: OC ≥ {high:.1f} g/kg",
        }
    else:
        dataset_note = (
            f"Schwellen sind das 30. und 70. Perzentil des gemessenen OC (0–20 cm) "
            f"in der aufbereiteten LUCAS-Deutschland-Stichprobe ({n} Messpunkte)."
        )
        tier_descriptions = {
            "low": f"Unteres 30 % (LUCAS DE): OC &lt; {low:.1f} g/kg",
            "medium": f"Mittleres 40 %: {low:.1f} – {high:.1f} g/kg",
            "high": f"Oberes 30 %: OC ≥ {high:.1f} g/kg",
        }

    discrete_labels = _discrete_bin_labels(boundaries, _DISCRETE_PERCENTILE_LABELS, lang)
    discrete_labels_short = _discrete_bin_labels_short(boundaries, _DISCRETE_PERCENTILE_LABELS)
    howto_map_intro, howto_tier_groups = _howto_tier_groups(
        boundaries,
        discrete_colors,
        _DISCRETE_PERCENTILE_LABELS,
        low,
        high,
        n,
        lang,
    )
    pct_list = ", ".join(str(p) for p in _DISCRETE_PERCENTILE_LABELS)
    if lang == "en":
        colormap_note = (
            f"Map colors use the plasma colormap in {len(boundaries)} discrete steps "
            f"(full spectrum, finer steps between the 30th and 70th percentile). "
        )
    else:
        colormap_note = (
            f"Kartenfarben: Plasma-Skala in {len(boundaries)} Stufen "
            f"(volles Spektrum, feinere Stufen zwischen dem 30. und 70. Perzentil). "
        )

    return {
        "unit": "g/kg",
        "parameter": "OC",
        "depth_cm": "0–20",
        "percentile_low": 30,
        "percentile_high": 70,
        "threshold_low_gkg": round(low, 2),
        "threshold_high_gkg": round(high, 2),
        "n_samples": n,
        "dataset_name": "LUCAS_SOIL_processed_DE.csv",
        "reference_url": LUCAS_REFERENCE_URL,
        "reference_title": LUCAS_REFERENCE_TITLE,
        "dataset_note": dataset_note,
        "tier_descriptions": tier_descriptions,
        "colors": TIER_COLORS,
        "colormap": "plasma",
        "colormap_mode": "discrete",
        "percentile_boundaries_gkg": boundaries,
        "discrete_percentiles": _DISCRETE_PERCENTILE_LABELS,
        "discrete_colors": discrete_colors,
        "discrete_bin_labels": discrete_labels,
        "discrete_bin_labels_short": discrete_labels_short,
        "colormap_note": colormap_note,
        "howto_map_intro": howto_map_intro,
        "howto_tier_groups": howto_tier_groups,
    }
