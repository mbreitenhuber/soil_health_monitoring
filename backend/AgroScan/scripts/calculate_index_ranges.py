#!/usr/bin/env python
"""
Calculates min and max values for each vegetation index across all sample points.

This script reads a CSV file with vegetation indices (column format: INDEX_SAMPLEPOINT, e.g., NDVI_1)
and determines the min/max for each index across all 81 sample points and all rows.

The output can be used to update INDEX_REFERENCE_RANGES in feature_transformation.py

Usage:
    python AgroScan/scripts/calculate_index_ranges.py --input ./data/datasets/Model_A_trans.csv --output ./index_ranges.json
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
        description="Calculate min/max values for vegetation indices from CSV data",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--input", "-i",
        help="Path to input CSV file with vegetation indices (format: INDEX_SAMPLEPOINT)",
        required=True
    )
    parser.add_argument(
        "--output", "-o",
        help="Path to save JSON file with index ranges (default: index_ranges.json)",
        default="index_ranges.json"
    )
    
    return parser.parse_args()


def calculate_index_ranges(csv_path):
    """
    Calculates min and max values for each vegetation index across all sample points.
    
    Args:
        csv_path (str): Path to CSV file with vegetation index data
    
    Returns:
        dict: Dictionary mapping index names to {"min": value, "max": value}
    """
    # Read CSV file
    print(f"Reading CSV file: {csv_path}")
    df = pd.read_csv(csv_path)
    
    # List of all vegetation indices (from feature_transformation.py)
    indices = [
        "RVI", "NDVI", "GNDVI", "NFVI45", "SAVI", "IRECI", "MCARI", "IB", "IB2", "RI", "CI"
    ]
    
    index_ranges = {}
    
    # For each index, find all columns and calculate min/max
    for index in indices:
        # Find all columns for this index (e.g., NDVI_1, NDVI_2, ..., NDVI_81)
        index_columns = [col for col in df.columns if col.startswith(index + "_")]
        
        if not index_columns:
            print(f"WARNING: No columns found for index {index}. Skipping.")
            continue
        
        # Extract values from all sample points of this index
        index_data = df[index_columns].values.flatten()
        
        # Filter out NaN values
        index_data = index_data[~pd.isna(index_data)]
        
        if len(index_data) == 0:
            print(f"WARNING: No valid data found for index {index}. Skipping.")
            continue
        
        # Calculate min and max
        min_val = float(index_data.min())
        max_val = float(index_data.max())
        
        index_ranges[index] = {
            "min": min_val,
            "max": max_val
        }
        
        print(f"  {index}: min={min_val:.4f}, max={max_val:.4f} (found {len(index_columns)} sample points, {len(index_data)} values)")
    
    return index_ranges


def main():
    args = setup_parser()
    
    # Validate input file
    input_path = Path(args.input)
    if not input_path.is_file():
        print(f"ERROR: Input file not found: {input_path}")
        return
    
    # Calculate index ranges
    print("\nCalculating vegetation index ranges...")
    index_ranges = calculate_index_ranges(str(input_path))
    
    # Save to JSON file
    output_path = Path(args.output)
    with open(output_path, 'w') as f:
        json.dump(index_ranges, f, indent=2)
    
    print(f"\n✓ Index ranges saved to: {output_path}")
    
    # Print summary in format suitable for copy-paste into feature_transformation.py
    print("\n" + "="*80)
    print("INDEX_REFERENCE_RANGES for feature_transformation.py:")
    print("="*80)
    print("INDEX_REFERENCE_RANGES = {")
    for index in sorted(index_ranges.keys()):
        min_val = index_ranges[index]["min"]
        max_val = index_ranges[index]["max"]
        print(f'    "{index}": {{"min": {min_val:.6f}, "max": {max_val:.6f}}},')
    print("}")
    print("="*80)


if __name__ == "__main__":
    main()
