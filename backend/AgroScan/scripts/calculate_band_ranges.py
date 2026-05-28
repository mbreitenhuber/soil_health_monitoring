#!/usr/bin/env python
"""
Calculates min and max values for each Sentinel-2 band across all sample points.

This script reads a CSV file with band values (column format: BAND_SAMPLEPOINT, e.g., B08_1)
and determines the min/max for each band across all 81 sample points and all rows.

The output can be used to update BAND_REFERENCE_RANGES in sentinel_to_csv.py

Usage:
    python AgroScan/scripts/calculate_band_ranges.py --input ./data/datasets/Model_A.csv --output ./AgroLens/scripts/band_ranges.json
"""

import argparse
import json
from pathlib import Path

import pandas as pd


def setup_parser() -> argparse.Namespace:
    """
    Parses command line arguments

    Returns:
        argparse.Namespace: argument values
    """
    parser = argparse.ArgumentParser(
        description="Calculate min/max values for Sentinel-2 bands from CSV data",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--input", "-i",
        help="Path to input CSV file with band values (format: BAND_SAMPLEPOINT)",
        required=True
    )
    parser.add_argument(
        "--output", "-o",
        help="Path to save JSON file with band ranges (default: band_ranges.json)",
        default="band_ranges.json"
    )
    
    return parser.parse_args()


def calculate_band_ranges(csv_path):
    """
    Calculates min and max values for each band across all sample points.
    
    Args:
        csv_path (str): Path to CSV file with band data
    
    Returns:
        dict: Dictionary mapping band names to {"min": value, "max": value}
    """
    # Read CSV file
    print(f"Reading CSV file: {csv_path}")
    df = pd.read_csv(csv_path)
    
    # List of all Sentinel-2 bands
    bands = [
        "B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B09", "B11", "B12"
    ]
    
    band_ranges = {}
    
    # For each band, find all columns and calculate min/max
    for band in bands:
        # Find all columns for this band (e.g., B08_1, B08_2, ..., B08_81)
        band_columns = [col for col in df.columns if col.startswith(band + "_")]
        
        if not band_columns:
            print(f"WARNING: No columns found for band {band}. Skipping.")
            continue
        
        # Extract values from all sample points of this band
        band_data = df[band_columns].values.flatten()
        
        # Filter out NaN values
        band_data = band_data[~pd.isna(band_data)]
        
        if len(band_data) == 0:
            print(f"WARNING: No valid data found for band {band}. Skipping.")
            continue
        
        # Calculate min and max
        min_val = float(band_data.min())
        max_val = float(band_data.max())
        
        band_ranges[band] = {
            "min": min_val,
            "max": max_val
        }
        
        print(f"  {band}: min={min_val:.2f}, max={max_val:.2f} (found {len(band_columns)} sample points, {len(band_data)} values)")
    
    return band_ranges


def main():
    args = setup_parser()
    
    # Validate input file
    input_path = Path(args.input)
    if not input_path.is_file():
        print(f"ERROR: Input file not found: {input_path}")
        return
    
    # Calculate band ranges
    print("\nCalculating band ranges...")
    band_ranges = calculate_band_ranges(str(input_path))
    
    # Save to JSON file
    output_path = Path(args.output)
    with open(output_path, 'w') as f:
        json.dump(band_ranges, f, indent=2)
    
    print(f"\n✓ Band ranges saved to: {output_path}")
    
    # Print summary in format suitable for copy-paste into sentinel_to_csv.py
    print("\n" + "="*80)
    print("BAND_REFERENCE_RANGES for sentinel_to_csv.py:")
    print("="*80)
    print("BAND_REFERENCE_RANGES = {")
    for band in sorted(band_ranges.keys()):
        min_val = band_ranges[band]["min"]
        max_val = band_ranges[band]["max"]
        print(f'    "{band}": {{"min": {min_val}, "max": {max_val}}},')
    print("}")
    print("="*80)


if __name__ == "__main__":
    main()

