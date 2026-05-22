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
LUCAS_REFERENCE_URL = "https://esdac.jrc.ec.europa.eu/content/lucas-soil-data"
LUCAS_REFERENCE_TITLE = "LUCAS Soil Data (ESDAC, European Commission JRC)"

# Fallback if the CSV is missing (computed from LUCAS_SOIL_processed_DE.csv, n=332)
_FALLBACK_LOW_GKG = 13.1
_FALLBACK_HIGH_GKG = 19.7
_FALLBACK_N = 332

TIER_COLORS = {
    "low": "#ef4444",
    "medium": "#f59e0b",
    "high": "#22c55e",
}


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


def oc_classification_meta(lang: str = "de") -> dict[str, Any]:
    low, high, n = lucas_oc_percentile_thresholds()
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
    }
