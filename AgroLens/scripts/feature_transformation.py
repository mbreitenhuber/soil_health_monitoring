# Creates features based on Sentinel 2 data using locations selected based on LUCAS

import os
from pathlib import Path

import numpy as np
import pandas as pd

# Read Sentinel-2 bands from CSV (project-relative by default).
project_root = Path(__file__).resolve().parents[2]
model_path = Path(
    os.environ.get("MODEL_PATH", project_root / "data" / "datasets" / "Model_A.csv")
)
if not model_path.is_file():
    raise FileNotFoundError(f"Model file not found: {model_path}")

output_path = Path(
    os.environ.get(
        "MODEL_TRANSFORMED_PATH",
        project_root / "data" / "datasets" / "Model_A_trans.csv",
    )
)

sentinel2 = pd.read_csv(model_path)

# Dataset structure:
## at each location a 9x9 pixel was evaluated for 10 bands, values were flattened & normalized s.t. for each Band 81 values exist
## Format of column name: BXX_PX_normalized (XX = number of band, PX = number of pixel)

## Selected Bands from Sentinel 2
# **B2 (Blue), B3 (Green), B4 (Red): The visible spectrum. (10 m res)
# **B8 (Near-Infrared - NIR):**Highly sensitive to  vegetation health. (10 m res)
# **B5, B6, B7 (Red Edge):**Unique bands that sit between Red and NIR. They are extremely sensitive to chlorophyll content and plant stress. (20 m res)
# **B8A (Narrow NIR):** Used for more precise vegetation analysis. (20 m res)
# **B11, B12 (Short-Wave Infrared - SWIR):** Great for detecting moisture in plants/soil and distinguishing between snow, ice, and clouds. (20 m res)

# Remove unnecessary columns
#specified_columns = ['POINTID', 'OC', 'NUTS_0', 'NUTS_1', 'NUTS_2', 'NUTS_3', 'TH_LAT', 'TH_LONG', 'SURVEY_DATE', 'LC', 'LU', 'LC1_Desc', 'LU1_Desc']  # Adjust as needed
#normalized_columns = [col for col in sentinel2.columns if col.endswith('_normalized')]
#columns_to_keep = specified_columns + normalized_columns
#sentinel2 = sentinel2[columns_to_keep]

## Feature Transformation -> per pixel
# Ratio Vegetation Index (RVI): NIR/RED = B8/B4
# Normalized Difference Vegetation index (NDVI): (NIR-RED)/(NIR+RED) = (B8-B4)/(B8+B4)
# Green Normalized Vegetation Difference Index (GNDVI): (NIR-GREEN)/(NIR+GREEN) = (B8-B3)/(B8+B3)
# Normalized Difference Index Using B4 and B5 (NDVI45): (RE1-RED)/(RE1+RED) = (B5-B4)/(B5+B4)
# Soil Adjusted Vegetation Index (SAVI): ((NIR-RED)/(NIR+RED+L))*(1+L) = ((B8-B4)/(B8+B4+L))*(1+L)
# Inverted Red-Edge Chlorophyll Index (IRECI): (RE3-RED)/(RE1/RE2) = (B7-B4)/(B5/B6)
# Modified Chlorophyll Absorption in Reflectance Index (MCARI): ((RE1-RED)-0.2*(RE1-GREEN))*(RE1-NIR) = ((B5-B4)-0.2*(B4-B3))*(B5-B8)
# Brightness index (IB): ROOT(((RED^2)+(Green^2))/2) = ROOT(((B4^2)+(B3^2))/2)
# Brightness index 2 (IB2): ROOT(((RED^2)+(Green^2)+(NIR^2))/2) = ROOT(((B4^2)+(B3^2)+(B8^2))/2)
# Redness index (RI): (RED^2) / (GREEN^3) = (B4^2)/B3^3)
# Color index (CI): (RED-GREEN)/(RED+GREEN)

# Extract sample numbers from B08 columns to make it flexible.
b08_columns = [
    col for col in sentinel2.columns if col.startswith(f'B08_') and col.endswith('_normalized')
]
if not b08_columns:
    raise ValueError('No B08 normalized columns found in the input file.')
sample_numbers = [col.split('_')[1] for col in b08_columns]

# Question: When to normalize the features? Before or after feature transformation? Re-normalize results of trans?

# Create feature columns for each sample
for sample in sample_numbers:
    L = 0.5 # soil brightness factor for most conditions, double-check where it applies
    b03_col = f'B03_{sample}'
    b04_col = f'B04_{sample}'
    b05_col = f'B05_{sample}'
    b06_col = f'B06_{sample}'
    b07_col = f'B07_{sample}'
    b08_col = f'B08_{sample}'
    rvi_col = f'RVI_{sample}'
    ndvi_col = f'NDVI_{sample}'
    gndvi_col = f'GNDVI_{sample}'
    ndvi45_col = f'NFVI45_{sample}'
    savi_col = f'SAVI_{sample}'
    ireci_col = f'IRECI_{sample}'
    mcari_col = f'MCARI_{sample}'
    bi_col = f'IB_{sample}'
    bi2_col = f'IB2_{sample}'
    ri_col = f'RI_{sample}'
    ci_col = f'CI_{sample}'
    # Safe division: replace inf/nan with 0
    eps = 1e-8  # Small epsilon to avoid division by zero
    sentinel2[rvi_col] = np.where(np.abs(sentinel2[b04_col]) > eps, sentinel2[b08_col] / sentinel2[b04_col], 0)
    sentinel2[ndvi_col] = np.where(np.abs(sentinel2[b08_col]+sentinel2[b04_col]) > eps, (sentinel2[b08_col]-sentinel2[b04_col])/(sentinel2[b08_col]+sentinel2[b04_col]), 0)
    sentinel2[gndvi_col] = np.where(np.abs(sentinel2[b08_col]+sentinel2[b03_col]) > eps, (sentinel2[b08_col]-sentinel2[b03_col])/(sentinel2[b08_col]+sentinel2[b03_col]), 0)
    sentinel2[ndvi45_col] = np.where(np.abs(sentinel2[b05_col] + sentinel2[b04_col]) > eps, (sentinel2[b05_col] - sentinel2[b04_col]) / (sentinel2[b05_col] + sentinel2[b04_col]), 0)
    sentinel2[savi_col] = np.where(np.abs(sentinel2[b08_col]+sentinel2[b04_col]+L) > eps, (sentinel2[b08_col]-sentinel2[b04_col])/(sentinel2[b08_col]+sentinel2[b04_col]+L)*(1+L), 0)
    sentinel2[ireci_col] = np.where((np.abs(sentinel2[b05_col]/sentinel2[b06_col]) > eps) & (np.abs(sentinel2[b05_col]) > eps), (sentinel2[b07_col]-sentinel2[b04_col])/(sentinel2[b05_col]/sentinel2[b06_col]), 0)
    sentinel2[bi_col] = (np.sqrt(((sentinel2[b04_col] ** 2) + (sentinel2[b03_col] ** 2)) / 2))
    sentinel2[bi2_col] = (np.sqrt(((sentinel2[b04_col]**2)+(sentinel2[b03_col]**2)+(sentinel2[b08_col]**2))/2))
    sentinel2[ri_col] = np.where(np.abs(sentinel2[b03_col]**3) > eps, (sentinel2[b04_col]**2)/(sentinel2[b03_col]**3), 0)
    sentinel2[ci_col] = np.where(np.abs(sentinel2[b04_col]+sentinel2[b03_col]) > eps, (sentinel2[b04_col]-sentinel2[b03_col])/(sentinel2[b04_col]+sentinel2[b03_col]), 0)
    
    # Replace any remaining inf/nan values with 0
    sentinel2[rvi_col] = sentinel2[rvi_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[ndvi_col] = sentinel2[ndvi_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[gndvi_col] = sentinel2[gndvi_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[ndvi45_col] = sentinel2[ndvi45_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[savi_col] = sentinel2[savi_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[ireci_col] = sentinel2[ireci_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[bi_col] = sentinel2[bi2_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[bi2_col] = sentinel2[bi2_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[ri_col] = sentinel2[ri_col].replace([np.inf, -np.inf], 0).fillna(0)
    sentinel2[ci_col] = sentinel2[ci_col].replace([np.inf, -np.inf], 0).fillna(0)


# Remove '_normalized' suffix from column names for cleaner output
sentinel2.rename(columns=lambda col: 'norm_' + col.replace('_normalized', '') if col.endswith('_normalized') else col, inplace=True)

# Remove unnormalized columns
columns_unnormalized = [col for col in sentinel2.columns if col.startswith('B')]
columns_unnamed = [col for col in sentinel2.columns if col.startswith('Unnamed')]
sentinel2.drop(columns=columns_unnormalized, inplace=True)
sentinel2.drop(columns=columns_unnamed, inplace=True)

output_path.parent.mkdir(parents=True, exist_ok=True)
sentinel2.to_csv(output_path, index=False)
