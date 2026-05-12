#!/usr/bin/env python
"""
Wrapper to run the full GPS -> Sentinel -> features -> NN prediction pipeline.

Steps performed:
  1. Downloads & crops Sentinel-2 datasets for the provided GPS points (sentinel_download.py)
  2. Extracts pixel values to CSV (sentinel_to_csv.py)
  3. Normalizes dataset (normalize_data.py)
  4. Computes feature transforms (feature_transformation.py)
  5. Runs predictions using the trained NN (predict_nn.py)

The script relies on environment variables set in the project's .env (SENTINEL_DIR, TMP_DIR, DATASET_PATH, MODEL_PATH, etc.).
"""

# python AgroLens/nutrients_predictor/run_pipeline_from_gps.py --gps data/datasets/LUCAS_SOIL_processed_DE.csv --flatten --normalize --output data/datasets/sample_gps_input_predictions.csv --start 4 --end 5

from pathlib import Path
import subprocess
import sys
import os
import argparse


def run_cmd(cmd, env=None):
    print("Running:", " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True, env=env)


def parse_args():
    p = argparse.ArgumentParser(description="Run full pipeline from GPS-only CSV to OC predictions")
    p.add_argument("--gps", "-g", required=True, help="Input GPS CSV (POINTID,SURVEY_DATE,TH_LAT,TH_LONG)")
    p.add_argument("--model-config", default="Model_A", help="Model config name (default: Model_A)")
    p.add_argument("--target", default="OC", help="Target column name (default: OC)")
    p.add_argument("--shape", default="9x9", help="Sentinel pixel shape for extraction (default: 9x9)")
    p.add_argument("--flatten", action="store_true", help="Flatten pixel matrices when extracting")
    p.add_argument("--normalize", action="store_true", help="Normalize band values when loading to .csv")
    p.add_argument("--mapping", help="Path to write mapping CSV (optional)")
    p.add_argument("--model", help="Path to trained .pth model (optional)")
    p.add_argument("--output","-o",help="Path for the final predictions CSV (default: <input>_predicted.csv)")
    p.add_argument("--start", help="First CSV row to download", nargs="?", default="1")
    p.add_argument("--end", help="Last CSV row to download", nargs="?", default="0")
    return p.parse_args()


def main():
    args = parse_args()

    project_root = Path(__file__).resolve().parents[2]
    scripts_dir = project_root / "AgroLens" / "scripts"
    input_dir = scripts_dir / "input_data"

    gps_input = Path(args.gps)
    if not gps_input.is_file():
        raise FileNotFoundError(f"GPS input file not found: {gps_input}")

    # Resolve dataset path (DATASET_PATH env or default)
    dataset_path = Path(os.environ.get("DATASET_PATH", project_root / "data" / "datasets"))
    dataset_path.mkdir(parents=True, exist_ok=True)

    mapping_file = Path(args.mapping) if args.mapping else dataset_path / "mapping_from_gps.csv"
    sentinel_csv = dataset_path / f"{args.model_config}.csv"
    transformed_csv = dataset_path / f"{args.model_config}_trans.csv"
    predictions_csv = (
        Path(args.output)
        if args.output
        else input_dir.parent / f"{gps_input.stem}_predicted.csv"
    )

    env = os.environ.copy()
    # ensure scripts see the same dataset path
    env["DATASET_PATH"] = str(dataset_path)

    # 1) Download sentinel data (creates mapping CSV)
    sentinel_download = input_dir / "sentinel_download.py"
    #cmd = [sys.executable, str(sentinel_download), "--input", str(gps_input), "--mapping", str(mapping_file), "--api-threads", "1", "--download-threads", "1", "--worker-threads", "1"]
    cmd = [sys.executable, str(sentinel_download), "--input", str(gps_input), "--mapping", str(mapping_file)]
    if args.start and args.start != "1":  # Only add if not the default
        cmd.append("--start")
        cmd.append(str(args.start))
    if args.end and args.end != "0":  # Only add if not the default
        cmd.append("--end")
        cmd.append(str(args.end))
    run_cmd(cmd, env=env)

    # 2) Extract pixel values to CSV
    sentinel_to_csv = input_dir / "sentinel_to_csv.py"
    csv_cmd = [sys.executable, str(sentinel_to_csv), "--input", str(gps_input), "--mapping", str(mapping_file), "--output", str(sentinel_csv), "--shape", args.shape]
    if args.flatten:
        csv_cmd.append("--flatten")
    if args.normalize:
        csv_cmd.append("--normalize")
    run_cmd(csv_cmd, env=env)

    # 3) Normalize dataset (normalize_data.py expects DATASET_PATH environment variable)
    #normalize_script = scripts_dir / "normalize_data.py"
    #run_cmd([sys.executable, str(normalize_script)], env=env)
    ## normalization now integrated into feature_transformation.py

    # 4) Feature transformation (feature_transformation.py reads MODEL_PATH env variable)
    # set MODEL_PATH to the normalized csv so the transformer picks it up
    #env["MODEL_PATH"] = str(dataset_path / f"{args.model_config}_norm.csv")
    env["MODEL_PATH"] = str(dataset_path / f"{args.model_config}.csv")
    feature_transform = scripts_dir / "feature_transformation.py"
    run_cmd([sys.executable, str(feature_transform)], env=env)

    # Reset MODEL_PATH to the correct models directory for prediction
    env["MODEL_PATH"] = os.environ.get("MODEL_PATH", "./data/models")

    # 5) Predict with neural network
    predict_script = project_root / "AgroLens" / "nutrients_predictor" / "predict_nn.py"
    predict_cmd = [
        sys.executable,
        str(predict_script),
        "--input",
        str(transformed_csv),
        "--output",
        str(predictions_csv),
        "--model-config",
        args.model_config,
        "--target",
        args.target,
    ]
    if args.model:
        predict_cmd += ["--model", args.model]
    run_cmd(predict_cmd, env=env)

    print("Pipeline finished. Predictions written to:", predictions_csv)


if __name__ == "__main__":
    main()
