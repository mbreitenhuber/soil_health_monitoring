#!/usr/bin/env python
"""
Predict OC with a trained neural network model.

Usage:
  python predict_nn.py --input test_points.csv --model /path/to/Model_A_nn_OC.pth

If `--model` is omitted the script will look for the model at:
  $MODEL_PATH/<model_config>/nn/<model_config>_nn_<target>.pth

The input CSV must contain the feature columns listed in
data/Feature_Cols/model_settings.json for the selected `model_config`.
The script adds a new column `<target>_pred` to the CSV and saves it.
"""
# python ./AgroLens/nutrients_predictor/predict_nn.py --input ./data/test.csv --model ./data/models/Model_A/nn/Model_A_nn_OC.pth

import argparse
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from dotenv import load_dotenv

load_dotenv()

import neural_network_predictor as nn_pred


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resolve_project_path(path_value: str) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def parse_args():
    p = argparse.ArgumentParser(description="Predict OC with a trained NN model")
    p.add_argument(
        "--input",
        "-i",
        required=True,
        help="Input CSV with features"
    )
    p.add_argument(
        "--model",
        "-m",
        required=False,
        help="Path to .pth model file. If omitted, built from $MODEL_PATH",
    )
    p.add_argument(
        "--model-config",
        default="Model_A",
        help="Model config name matching Feature_Cols/model_settings.json (default: Model_A)",
    )
    p.add_argument("--target", default="OC", help="Target column name (default: OC)")
    p.add_argument(
        "--output",
        "-o",
        required=False,
        help="Output CSV path. If omitted the input file will be overwritten.",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=1024,
        help="Batch size to use for predictions (default: 1024)",
    )
    return p.parse_args()


def main():
    args = parse_args()

    input_path = Path(args.input)
    if not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    dataset_path = Path(os.environ.get("DATASET_PATH", ""))
    settings_path = dataset_path / "Feature_Cols" / "model_settings.json"
    if not settings_path.is_file():
        raise FileNotFoundError(f"model_settings.json not found: {settings_path}")

    with open(settings_path, "r") as fh:
        settings = json.load(fh)

    if args.model_config not in settings:
        raise KeyError(f"Model config '{args.model_config}' not found in model_settings.json")

    feature_columns = list(settings[args.model_config].get("feature_columns", []))
    # include optional features if present
    feature_columns += list(settings[args.model_config].get("optional_feature_columns", []))

    df = pd.read_csv(input_path)

    missing = [c for c in feature_columns if c not in df.columns]
    if missing:
        raise ValueError(
            f"Input CSV is missing {len(missing)} required feature columns. Missing example: {missing[:5]}"
        )

    # resolve model path
    if args.model:
        model_path = Path(args.model)
    else:
        model_base = _resolve_project_path(os.environ.get("MODEL_PATH", "./data/models"))
        model_path = model_base / args.model_config / "nn" / f"{args.model_config}_nn_{args.target}.pth"

    if not model_path.is_file():
        raise FileNotFoundError(f"Model file not found: {model_path}")

    print(f"Loading model from {model_path}...")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = nn_pred.TrainingPipeline.load_model(str(model_path))
    model = model.to(device)
    model.eval()

    # prepare features as float32 numpy array
    X = df[feature_columns].values.astype(np.float32)

    # predict in batches to avoid memory issues
    preds = []
    batch_size = int(args.batch_size)
    with torch.no_grad():
        for i in range(0, X.shape[0], batch_size):
            xb = torch.from_numpy(X[i : i + batch_size]).to(device)
            yb = model(xb)
            yb = yb.view(-1).cpu().numpy()
            preds.append(yb)

    preds = np.concatenate(preds, axis=0)

    out_col = f"{args.target}_pred"
    df[out_col] = preds

    out_path = Path(args.output) if args.output else input_path
    df.to_csv(out_path, index=False)
    print(f"Predictions written to {out_path} (column '{out_col}')")


if __name__ == "__main__":
    main()
