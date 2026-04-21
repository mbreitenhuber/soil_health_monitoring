#!/usr/bin/env python
# Preprocesses the LUCAS SOIL CSV

import os
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Get paths from environment
DATASET_PATH = os.environ.get("DATASET_PATH", "./data/datasets")
LUCAS_INPUT = os.path.join(DATASET_PATH, "LUCAS-SOIL-2018.csv")
LUCAS_OUTPUT = os.path.join(DATASET_PATH, "LUCAS_SOIL_processed.csv")

# Validate input file exists
if not os.path.isfile(LUCAS_INPUT):
    print(f"Error: Input file not found: {LUCAS_INPUT}")
    print(f"Make sure LUCAS-SOIL-2018.csv is in {DATASET_PATH}")
    sys.exit(1)

print(f"Loading LUCAS data from: {LUCAS_INPUT}")
df = pd.read_csv(LUCAS_INPUT)

# The LUCAS SOIL dataset contains the following columns:
# Depth,POINTID,pH_CaCl2,pH_H2O,EC,OC,CaCO3,P,N,K,OC (20-30 cm),CaCO3 (20-30 cm),Ox_Al,Ox_Fe,NUTS_0,NUTS_1,NUTS_2,NUTS_3,TH_LAT,TH_LONG,SURVEY_DATE,Elev,LC,LU,LC0_Desc,LC1_Desc,LU1_Desc

# Filter to only include rows where 'LC0_Desc' is 'Cropland'
if "LC0_Desc" in df.columns:
    df = df[df["LC0_Desc"] == "Cropland"]
    print(f"Filtered to Cropland rows: {len(df)} remaining")

# Drop unnecessary chemical elements
df.drop(
    columns=[
        "Depth",
        "pH_CaCl2",
        "pH_H2O",
        "EC",
        "CaCO3",
        "P",
        "N",
        "K",
        "CaCO3 (20-30 cm)",
        "Ox_Al",
        "Ox_Fe",
    ],
    inplace=True,
)

#  Dataset now contains the following columns:
#  POINTID,OC,OC (20-30 cm),NUTS_0,NUTS_1,NUTS_2,NUTS_3,TH_LAT,TH_LONG,SURVEY_DATE,Elev,LC,LU,LC0_Desc,LC1_Desc,LU1_Desc

# PointID: 	                Unique identifier of the LUCAS survey point
# OC:                   	Organic carbon content (at depth 0-20cm) in g/kg
# OC (20-30 cm):	        Organic carbon content (at depth 20-30cm) in g/kg
# NUTS_0:	                NUTS code for the country where the sample was taken
# NUTS_1, NUTS_2, NUTS_3:	NUTS 1, 2 and 3 codes for the actual location where the sample was taken (thus based on GPS coordinates)
# TH_LAT, TH_LON:	        Theoretical Coordinates in decimal degrees
# SURVEY_DATE:	            Date of Survey
# Elev:	                    Elevation (in meter) from surveyor GPS
# LC:	                    LUCAS Land Cover Code
# LU:	                    LUCAS Land Use Code
# LC0_Desc:	                Main Land Cover class description
# LC1_Desc:	                Detailed Land Cover class description
# LU1_Desc:	                Detailed Land Use class description
# for more info see readme_lucas_soil 
# TODO: upload this file to repo and link it here


# Drop rows that match "< LOD" in 'OC' and 'OC (20-30 cm)'
rows_before_lod_filter = len(df)
df = df[df["OC"].astype(str).str.contains("< LOD", na=False) == False]
df = df[df["OC (20-30 cm)"].astype(str).str.contains("< LOD", na=False) == False]
rows_deleted_lod_filter = rows_before_lod_filter - len(df)
print(f"Dropped {rows_deleted_lod_filter} rows due to '< LOD' in OC columns")

"""# Impute 'P' where it is below 10 mg/kg (limit of detection) with 5 (Average between 0 and 10) -> total number of imputed records: 4945
if "P" in df.columns:
    df["P"] = df["P"].astype(str).replace("< LOD", "5")
    # Impute 'P' where it is <0.0 with 0 -> total number of imputed records: 1
    df["P"] = df["P"].astype(str).replace("<0.0", "0")

if "P" in df.columns:
    df.dropna(subset=["P"], inplace=True)"""
# TODO: do we need that for OC?

# Convert columns to float
df["OC"] = pd.to_numeric(df["OC"], errors="coerce")
df["OC (20-30 cm)"] = pd.to_numeric(df["OC (20-30 cm)"], errors="coerce")

df["SURVEY_DATE"] = pd.to_datetime(df["SURVEY_DATE"], format="%d-%m-%y", errors="coerce")

# Create output directory if it doesn't exist
os.makedirs(DATASET_PATH, exist_ok=True)

# Save processed data
print(f"Saving processed data to: {LUCAS_OUTPUT}")
df.to_csv(LUCAS_OUTPUT, index=False)
print("✓ Processing complete!")

