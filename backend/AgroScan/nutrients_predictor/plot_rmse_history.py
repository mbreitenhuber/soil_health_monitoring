#!/usr/bin/env python
"""
Plot the RMSE evolution of a trained FCNN from its saved checkpoint.

This expects the checkpoint to contain a `training_history` dictionary with
`train_rmse` and `val_rmse` lists. The neural_network_predictor.py training
pipeline writes this history when saving the best model.

Usage:
  python plot_rmse_history.py --model backend/data/models/Model_A/nn/Model_A_nn_OC.pth
  python plot_rmse_history.py --model backend/data/models/Model_A/nn/Model_A_nn_OC.pth --output rmse_plot.png
"""
#docker exec -it nebula-web python /app/AgroScan/nutrients_predictor/plot_rmse_history.py --model /persistent-data/models/Model_A/nn/Model_A_nn_OC.pth --output /persistent-data/models/Model_A/nn/Model_A_nn_OC_rmse.png

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import torch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plot RMSE evolution from a saved FCNN checkpoint")
    parser.add_argument("--model", "-m", required=True, help="Path to the .pth checkpoint")
    parser.add_argument(
        "--output",
        "-o",
        help="Optional output path for the plot PNG. Defaults to <model>_rmse.png.",
    )
    return parser.parse_args()


def load_history(model_path: Path) -> dict:
    checkpoint = torch.load(model_path, map_location=torch.device("cpu"))
    history = checkpoint.get("training_history") or checkpoint.get("history")
    if not history:
        raise ValueError(
            f"No training history found in {model_path}. Retrain the model with the updated training pipeline."
        )
    return history


def plot_history(history: dict, output_path: Path, model_path: Path) -> None:
    train_rmse = history.get("train_rmse", [])
    val_rmse = history.get("val_rmse", [])

    if not train_rmse and not val_rmse:
        raise ValueError("Training history does not contain RMSE values to plot.")

    epochs = range(1, max(len(train_rmse), len(val_rmse)) + 1)

    plt.figure(figsize=(9, 5))
    if train_rmse:
        plt.plot(range(1, len(train_rmse) + 1), train_rmse, marker="o", linewidth=2, label="Train RMSE")
    if val_rmse:
        plt.plot(range(1, len(val_rmse) + 1), val_rmse, marker="o", linewidth=2, label="Validation RMSE")

    plt.xlabel("Epoch")
    plt.ylabel("RMSE")
    plt.title(f"RMSE Evolution for {model_path.stem}")
    plt.grid(True, alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_path, dpi=200)
    print(f"RMSE plot saved to {output_path}")


def main() -> None:
    args = parse_args()
    model_path = Path(args.model)
    if not model_path.is_file():
        raise FileNotFoundError(f"Checkpoint not found: {model_path}")

    output_path = Path(args.output) if args.output else model_path.with_name(f"{model_path.stem}_rmse.png")
    history = load_history(model_path)
    plot_history(history, output_path, model_path)


if __name__ == "__main__":
    main()
