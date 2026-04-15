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

# Drop unnecessary chemical elements
df.drop(
    columns=[
        "EC",
        "OC",
        "CaCO3",
        "OC (20-30 cm)",
        "CaCO3 (20-30 cm)",
        "Ox_Al",
        "Ox_Fe",
    ],
    inplace=True,
)
# Drop depth column as it's values are '0-10 cm', '0-20 cm', or '10-20 cm'
df.drop(columns=["Depth"], inplace=True)
# Note: Values for pH exist in 2 columns as they have been tested by 2 separate test methods pH_CaCl2 and pH_H2O
# The patterns are very similar for both, however pH_H2O is about 0.4 higher than pH_CaCl2
# Hence assuming it doesn't matter which of the 2 we use for training

# Drop rows that match "< LOD" in 'N' and 'K' (Total number of deleted rows: 1)
df = df[df["N"].str.contains("< LOD") == False]
df = df[df["K"].str.contains("< LOD") == False]

# Impute 'P' where it is below 10 mg/kg (limit of detection) with 5 (Average between 0 and 10) -> total number of imputed records: 4945
df["P"] = df["P"].replace("< LOD", 5)
# Impute 'P' where it is <0.0 with 0 -> total number of imputed records: 1
df["P"] = df["P"].replace("<0.0", 0)

df.dropna(subset=["P"], inplace=True)
df["pH_CaCl2"] = df["pH_CaCl2"].astype(float)
df["pH_H2O"] = df["pH_H2O"].astype(float)
df["P"] = df["P"].astype(float)
df["N"] = df["N"].astype(float)
df["K"] = df["K"].astype(float)
df["SURVEY_DATE"] = pd.to_datetime(df["SURVEY_DATE"], format="%d-%m-%y")

# Create output directory if it doesn't exist
os.makedirs(DATASET_PATH, exist_ok=True)

# Save processed data
print(f"Saving processed data to: {LUCAS_OUTPUT}")
df.to_csv(LUCAS_OUTPUT, index=False)
print("✓ Processing complete!")

