#!/usr/bin/env python
# Extracts and saves Sentinel-2 band pixel data to a CSV table
# More information with 'sentinel_to_csv.py -h'

# command
# python AgroScan/scripts/input_data/sentinel_to_csv.py --input ./data/datasets/LUCAS_SOIL_processed.csv --mapping ./data/datasets/mapping.csv --output ./data/datasets/Model_A.csv --shape 9x9 --flatten --normalize
# DE: python AgroScan/scripts/input_data/sentinel_to_csv.py --input ./data/datasets/LUCAS_SOIL_processed_DE.csv --mapping ./data/mapping_S2_DE.csv --output ./data/datasets/Model_A.csv --shape 9x9 --flatten --normalize

import argparse
import os
import sys
from pathlib import Path
from warnings import simplefilter

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn import preprocessing

# Load environment variables from .env
load_dotenv()

sys.path.append(str(Path(os.path.abspath(__file__)).parent.parent.parent))
from satellite_utils.image_utils import ImageUtils # remove AgroScan if necessary


# ============================================================================
# FIXED REFERENCE NORMALIZATION VALUES FOR SENTINEL-2 BANDS
# create .json file with max & min values with:
# python AgroScan/scripts/calculate_band_ranges.py --input ./data/datasets/Model_A_min_max_values.csv --output ./band_ranges.json
# ============================================================================
BAND_REFERENCE_RANGES = {
  "B01": {"min": 0.0,"max": 15.0},
  "B02": {"min": 0.0,"max": 15.0},
  "B03": {"min": 0.0,"max": 20.0},
  "B04": {"min": 0.0,"max": 21.0},
  "B05": {"min": 0.0,"max": 26.0},
  "B06": {"min": 0.0,"max": 44.0},
  "B07": {"min": 0.0,"max": 52.0},
  "B08": {"min": 0.0,"max": 53.0},
  "B8A": {"min": 0.0,"max": 54.0},
  "B09": {"min": 0.0,"max": 54.0},
  "B11": {"min": 0.0,"max": 37.0},
  "B12": {"min": 0.0,"max": 34.0}
}


def setup_parser() -> argparse.Namespace:
    """
    Parses command line arguments

    Returns:
        argparse.Namespace: argument values
    """
    parser = argparse.ArgumentParser(
        description="Extracts and saves Sentinel-2 band pixel data to a CSV table \n\n"
        "Required environment variables: \n"
        "SENTINEL_DIR: Directory with the cropped Sentinel-2 files",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--input", "-i", help="Path to input LUCAS SOIL CSV file", required=True
    )
    parser.add_argument(
        "--mapping", "-m", help="Path to the mapping CSV", required=True
    )
    parser.add_argument(
        "--output", "-o", help="Path to save the output CSV", required=True
    )
    parser.add_argument(
        "--normalize",
        "-n",
        help="Add normalized Sentinel-2 columns?",
        action=argparse.BooleanOptionalAction,
        default=False,
    )
    parser.add_argument(
        "--flatten",
        "-f",
        help="Flatten Sentinel-2 value matrices into separate columns? (Only useful when 'shape' is a matrix)",
        action=argparse.BooleanOptionalAction,
        default=False,
    )
    parser.add_argument(
        "--shape",
        "-s",
        help="Define band shape to set the amount of pixels to include (default: 1x1)",
        nargs="?",
        default="1x1",
    )
    parser.add_argument(
        "--center",
        "-c",
        help="Move the center pixel to the first column of each band when flattening?",
        action=argparse.BooleanOptionalAction,
        default=False,
    )

    args = parser.parse_args()
    # do not flatten a single value
    if args.shape == "1x1":
        args.flatten = False
    elif args.normalize and not args.flatten:
        raise ValueError(
            "You cannot use '--normalize' on a matrix without '--flatten'!"
        )

    return args


def normalize_with_fixed_ranges(data, normalize_columns, band_ranges):
    """
    Normalize data using fixed reference ranges for each band.
    
    This ensures consistent normalization across different datasets,
    avoiding issues with small sample sizes (1-3 rows).
    
    Args:
        data (pd.DataFrame): Input dataframe with band values
        normalize_columns (list): List of column names to normalize
        band_ranges (dict): Dictionary with band min/max reference values
    
    Returns:
        pd.DataFrame: Dataframe with normalized columns appended
    """
    normalized_data = {}
    
    for col in normalize_columns:
        # Extract band name (e.g., "B04_1" -> "B04")
        band_name = col.split('_')[0]
        
        if band_name not in band_ranges:
            print(f"WARNING: No reference range found for band {band_name}. Skipping normalization for {col}.")
            continue
        
        min_val = band_ranges[band_name]["min"]
        max_val = band_ranges[band_name]["max"]
        
        # Normalize using fixed range: (value - min) / (max - min)
        if max_val == min_val:
            print(f"WARNING: min == max for band {band_name}. Setting normalized values to 0.")
            normalized_data[col + "_normalized"] = 0.0
        else:
            normalized_data[col + "_normalized"] = (data[col] - min_val) / (max_val - min_val)
            
            # Clip values to [0, 1] range (in case data exceeds reference range)
            normalized_data[col + "_normalized"] = normalized_data[col + "_normalized"].clip(0, 1)
    
    # Convert to DataFrame and merge
    normalized_df = pd.DataFrame(normalized_data)
    
    return normalized_df


def main():
    args = setup_parser()

    sentinel_path = Path(os.environ["SENTINEL_DIR"])

    # hide pandas warnings when creating columns
    simplefilter(action="ignore", category=pd.errors.PerformanceWarning)

    input = pd.read_csv(args.input, sep=",", header=0, dtype=str)
    mapping = pd.read_csv(args.mapping, sep=",", header=0, dtype=str)

    shape = args.shape.split("x")
    shape = tuple([int(x) for x in shape])

    # Keep the mapped crop coordinates so reused cached folders can be resolved exactly.
    mapping.rename(
        columns={
            "SURVEY_DATE": "MAPPING_SURVEY_DATE",
            "TH_LAT": "MAPPING_TH_LAT",
            "TH_LONG": "MAPPING_TH_LONG",
        },
        inplace=True,
    )

    output = pd.merge(input, mapping, on="POINTID", how="inner")

    if "MAPPING_TH_LAT" in output.columns:
        output["TH_LAT"] = output["MAPPING_TH_LAT"]
    if "MAPPING_TH_LONG" in output.columns:
        output["TH_LONG"] = output["MAPPING_TH_LONG"]

    output.drop(columns=["MAPPING_SURVEY_DATE", "MAPPING_TH_LAT", "MAPPING_TH_LONG"], inplace=True, errors="ignore")

    bands = [
        "B01",
        "B02",
        "B03",
        "B04",
        "B05",
        "B06",
        "B07",
        "B08",
        "B8A",
        "B09",
        "B11",
        "B12",
    ]

    resolutions = ["R10m", "R20m", "R60m"]

    drop = []

    # create columns in output dataset
    normalize_columns = []
    for band in bands:
        if args.flatten:
            for i in range(shape[0] * shape[1]):
                normalize_columns.append(f"{band}_{i+1}")
        else:
            normalize_columns.append(band)

    # create pixel matrix columns
    if args.flatten:
        output[bands] = None

    # create empty columns
    output[normalize_columns] = 0

    for index, row in output.iterrows():
        if (index + 1) % 1000 == 0:
            print(f"Processing row {index+1}...")

        path = (
            sentinel_path
            / row["SENTINEL_DATE"]
            / f"{row['TH_LAT']} {row['TH_LONG']}"
            / "IMG_DATA"
        )

        # Sentinel dataset does not exist, drop row
        try:
            if not path.is_dir():
                drop.append(index)
                continue
        except:
            print(f"Could not open '{path}'!")
            continue

        # iterate over every band and every resolution and try until a value is found
        empty = True
        for band in bands:
            for resolution in resolutions:
                value = None
                file = path / resolution / f"{band}.jp2"
                if file.is_file():
                    try:
                        value = ImageUtils.get_pixel_value(str(file), 50, 50, shape)
                    except:
                        print(
                            f"Could not get value of point {row['POINTID']}, band {band} ({resolution})!",
                            file=sys.stderr,
                        )
                        pass

                if value is not None:
                    output.at[index, band] = value

                    if np.any(value):
                        # drop rows where all bands are zero
                        empty = False
                        if args.flatten:
                            value = value.reshape(-1)  # value to 1d list

                            if args.center:
                                # move the center of the matrix to the beginning
                                # => center pixel is always the first column regardless of matrix shape
                                center = int((len(value) - 1) / 2)
                                center_value = value[center]
                                value = np.delete(value, center)
                                value = np.insert(value, 0, center_value)

                            # copy pixel values from matrix to new columns
                            for i in range(value.shape[0]):
                                output.at[index, f"{band}_{i+1}"] = value[i]

                    break

        # drop rows without any band data
        if empty:
            print("Row empty")
            drop.append(index)
            continue

    # drop all datasets without Sentinel values
    print(f"Dropping {len(drop)} rows...")
    output.drop(output.index[drop], inplace=True)

    # debugging statement
    print(f"Output dataframe shape after dropping rows: {output.shape}")
    print(f"Number of rows in output: {len(output)}")
    if len(output) == 0:
        print("WARNING: Output dataframe is empty!")

    # Create new index column
    # output.drop(output.columns[0], axis=1, inplace=True) # this drops the PointID column
    output.reset_index(drop=True, inplace=True)
    output.index.names = ["Index"]

    if args.normalize:
        print("Normalizing with fixed reference ranges...")
        normalized_df = normalize_with_fixed_ranges(output, normalize_columns, BAND_REFERENCE_RANGES)
        names = [i + "_normalized" for i in normalize_columns]
        normalized_df.columns = names
        output = pd.merge(output, normalized_df, left_index=True, right_index=True)
        print("Normalization complete.")

    if shape != (1, 1):
        # convert numpy arrays to strings
        output[bands] = output[bands].astype(str)
        output.replace("\n", "", regex=True, inplace=True)

    output.to_csv(args.output, sep=",", index=False, header=True)
    print(f"New data table saved to '{args.output}'.")


if __name__ == "__main__":
    main()
