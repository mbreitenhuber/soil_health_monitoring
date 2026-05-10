#!/usr/bin/env python
# Normalizes all numeric columns in a CSV data table
# Exclusions are possible
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def main():
    """
    This script reads a CSV file, excludes specified columns from normalization,
    and min-max normalizes the remaining numeric columns. Each normalized column
    is then renamed to include the "norm_" prefix, effectively replacing the
    original column name. Finally, the script saves the updated DataFrame
    to a new CSV file.
    """

    # ----- CONFIGURATION -----
    dataset_path = Path(os.environ["DATASET_PATH"])
    input_csv = dataset_path / "Model_A.csv"
    output_csv_normalized = dataset_path / "Model_A_norm.csv"

    # Specify columns to exclude from normalization
    excluded_columns = [
        "Index",
        "POINTID",
        "OC",
        "NUTS_0",
        "NUTS_1",
        "NUTS_2",
        "NUTS_3",
        "TH_LAT",
        "TH_LONG",
        "SURVEY_DATE",
        "LC",
        "LU",
        "LC0_Desc",
        "LC1_Desc",
        "LU1_Desc",
        "SENTINEL_DATE",
        "SENTINEL_ID"
    ]

    # Read the CSV into a pandas DataFrame
    df = pd.read_csv(input_csv)

    # Drop rows without a valid OC target so training labels stay finite.
    before_rows = len(df)
    df = df.dropna(subset=["OC"])
    dropped_rows = before_rows - len(df)
    if dropped_rows:
        print(f"Dropped {dropped_rows} rows with missing OC values")

    # Identify numeric columns
    numeric_cols = df.select_dtypes(include=["number"]).columns

    # Create a copy of the original DataFrame
    df_normalized = df.copy()

    # Perform min-max normalization and rename columns
    for col in numeric_cols:
        if col in excluded_columns:
            # Skip normalization for these columns
            continue

        col_min = df_normalized[col].min()
        col_max = df_normalized[col].max()

        # Avoid division by zero if all values in the column are the same
        if col_max != col_min:
            df_normalized[col] = (df_normalized[col] - col_min) / (col_max - col_min)
        else:
            df_normalized[col] = 0.0

        # Rename the column to include the prefix "norm_"
        df_normalized.rename(columns={col: f"norm_{col}"}, inplace=True)

    # Save the DataFrame to a new CSV file
    df_normalized.to_csv(output_csv_normalized, index=False)
    print(f"Normalization complete. Saved to {output_csv_normalized}")


if __name__ == "__main__":
    main()
