#!/usr/bin/env python
# Downloads and crops Sentinel-1 images in the given CSV table (multi-threaded)
# More information with 'sentinel1_donwload.py -h'

import argparse
import os
import shutil
import sys
import threading
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from copernicus_api_S1 import CopernicusApiS1

# Load environment variables from .env file
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
print('environment variables:', os.environ)

class ThreadPrefix:
    """
    Prefixes each output line with the current thread label.
    """

    def __init__(self, stdout):
        self.prefixes = {}
        self.stdout = stdout
        self.lock = threading.Lock()
        self.line_break = True

    def add_prefix(self, prefix):
        self.prefixes[threading.get_ident()] = prefix

    def write(self, message):
        with self.lock:
            if self.line_break and threading.get_ident() in self.prefixes:
                self.stdout.write(f"{self.prefixes[threading.get_ident()]} {message}")
            else:
                self.stdout.write(message)
            self.line_break = message[-1] == "\n"

    def flush(self):
        self.stdout.flush()

    def isatty(self):
        return self.stdout.isatty()


api_counter = 0
errors = 0
counter_lock = threading.Lock()

download_jobs = []
crop_jobs = []

api_threads = 0
download_threads = 0
crop_threads = 0
mapping_file = ""

dataframe: pd.DataFrame
data_length: int = 0

api_finished = False
download_finished = False


def check_environment_variables():
    required_vars = [
        "SENTINEL1_DIR",
        "TMP_DIR",
        "COPERNICUS_USER",
        "COPERNICUS_PASSWORD",
    ]
    missing_vars = [var for var in required_vars if var not in os.environ]
    if missing_vars:
        raise EnvironmentError(
            f"Missing required environment variables: {', '.join(missing_vars)}\n"
            "Please set these variables using 'export VAR=value' or in a .env file"
        )


def setup_parser() -> argparse.Namespace:
    global api_threads, download_threads, crop_threads, mapping_file

    parser = argparse.ArgumentParser(
        description="Downloads and crops Sentinel-1 images in the given CSV table.\n"
        "It is important to balance thread counts to your machine resources.\n\n"
        "Required environment variables: \n"
        "SENTINEL1_DIR: Target directory for cropped Sentinel-1 files \n"
        "TMP_DIR: Temporary working directory (ramdisk recommended) \n"
        "COPERNICUS_USER: Copernicus API user \n"
        "COPERNICUS_PASSWORD: Copernicus API password \n",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--api-threads",
        "-a",
        help="Number of Copernicus API threads (network and CPU balance)",
        nargs="?",
        default="4",
    )
    parser.add_argument(
        "--download-threads",
        "-d",
        help="Number of download threads (network heavy)",
        nargs="?",
        default="4",
    )
    parser.add_argument(
        "--worker-threads",
        "-w",
        help="Number of CPU worker threads (CPU heavy)",
        nargs="?",
        default="4",
    )
    parser.add_argument("--start", help="First CSV row to process", nargs="?", default="1")
    parser.add_argument("--end", help="Last CSV row to process", nargs="?", default="0")
    parser.add_argument("--input", "-i", help="Path to input LUCAS SOIL CSV", required=True)
    parser.add_argument(
        "--mapping",
        "-m",
        help="Path to save mapping CSV for soil point -> Sentinel-1 dataset",
        nargs="?",
        default="",
    )
    parser.add_argument(
        "--product-type",
        help="Sentinel-1 product type (default: GRD)",
        nargs="?",
        default="GRD",
    )
    parser.add_argument(
        "--sensor-mode",
        help="Sentinel-1 sensor mode (default: IW)",
        nargs="?",
        default="IW",
    )
    parser.add_argument(
        "--polarization",
        help="Requested polarization string (default: VV,VH)",
        nargs="?",
        default="VV,VH",
    )
    args = parser.parse_args()

    api_threads = int(args.api_threads)
    download_threads = int(args.download_threads)
    crop_threads = int(args.worker_threads)
    if args.mapping:
        mapping_file = os.path.realpath(args.mapping)
    return args


def normalize_date(date_str: str) -> str:
    if "/" in date_str:
        parts = date_str.split("/")
    else:
        parts = date_str.split("-")
    if len(parts) != 3:
        raise ValueError(f"Invalid SURVEY_DATE format: {date_str}")
    return f"{parts[0]}-{parts[1]}-{parts[2]}"


def api_thread(thread_index: int, args: argparse.Namespace) -> None:
    global dataframe, data_length, api_counter, errors, download_threads, download_jobs

    sys.stdout.add_prefix(f"[API Thread {thread_index+1}]")
    sys.stderr.add_prefix(f"[API Thread {thread_index+1}]")

    while True:
        if len(download_jobs) > download_threads * 4:
            time.sleep(0.1)
            continue

        with counter_lock:
            index = api_counter
            api_counter += 1

        if index >= data_length:
            print("Thread finished.")
            return

        row = dataframe.iloc[index]
        latitude = float(row["TH_LAT"])
        longitude = float(row["TH_LON"])

        try:
            date = normalize_date(str(row["SURVEY_DATE"]))
            print(f"Date: {date}, Lat: {latitude}, Long: {longitude}")

            data = CopernicusApiS1.get_data(
                date=date,
                latitude=latitude,
                longitude=longitude,
                limit=1,
                product_type=args.product_type,
                sensor_mode=args.sensor_mode,
                polarization=args.polarization,
            )
            if not data:
                raise ValueError("No Sentinel-1 data found!")

            product = data[0]
            s1_date = product["properties"]["startDate"].split("T")[0]
            print(f"Best dataset: {product['id']} ({s1_date})")

            if mapping_file:
                with open(mapping_file, "a") as file:
                    print(
                        f"{row['POINTID']},{date},{latitude},{longitude},{s1_date},{product['id']}",
                        file=file,
                    )

            download_jobs.append(
                {
                    "point": str(row["POINTID"]),
                    "id": product["id"],
                    "date": s1_date,
                    "lat": latitude,
                    "lon": longitude,
                }
            )
        except Exception as exc:
            print(exc, file=sys.stderr)
            with counter_lock:
                errors += 1


def download_thread(thread_index: int) -> None:
    global errors, crop_threads, download_jobs, crop_jobs, api_finished

    sys.stdout.add_prefix(f"[DL Thread {thread_index+1}]")
    sys.stderr.add_prefix(f"[DL Thread {thread_index+1}]")

    while True:
        if not download_jobs and api_finished:
            print("Thread finished.")
            return
        if not download_jobs or len(crop_jobs) > crop_threads * 2:
            time.sleep(0.1)
            continue

        job = download_jobs.pop(0)
        result_path = (
            Path(os.environ["SENTINEL1_DIR"]) / job["date"] / f"{job['lat']} {job['lon']}"
        )
        if result_path.is_dir():
            print("Dataset already downloaded")
            continue

        try:
            CopernicusApiS1.download_data(
                product_id=job["id"],
                dataset_name=job["point"],
                target_path=os.environ["TMP_DIR"],
            )
            crop_jobs.append(job)
        except Exception as exc:
            print(exc, file=sys.stderr)
            with counter_lock:
                errors += 1


def crop_thread(thread_index: int) -> None:
    global errors, crop_jobs, download_finished

    sys.stdout.add_prefix(f"[Crop Thread {thread_index+1}]")
    sys.stderr.add_prefix(f"[Crop Thread {thread_index+1}]")

    while True:
        if not crop_jobs:
            if download_finished:
                print("Thread finished.")
                return
            time.sleep(0.1)
            continue

        job = crop_jobs.pop(0)
        tmp_dataset = Path(os.environ["TMP_DIR"]) / job["point"]
        result_path = (
            Path(os.environ["SENTINEL1_DIR"]) / job["date"] / f"{job['lat']} {job['lon']}"
        )

        try:
            # Additional crop step: include optional annotation rasters if present.
            CopernicusApiS1.crop_images(
                dataset_name=job["point"],
                latitude=job["lat"],
                longitude=job["lon"],
                parent_path=os.environ["TMP_DIR"],
                crop_annotation=True,
            )

            if not list((tmp_dataset / "IMG_DATA").glob("*.[Tt][Ii][Ff]*")):
                raise FileNotFoundError("No cropped Sentinel-1 raster files found in IMG_DATA")

            os.makedirs(Path(os.environ["SENTINEL1_DIR"]) / job["date"], exist_ok=True)
            shutil.move(tmp_dataset, result_path)
            print(f"Point {job['point']} finished.")
        except Exception as exc:
            print(exc, file=sys.stderr)
            with counter_lock:
                errors += 1
            shutil.rmtree(tmp_dataset, True)


def main():
    global dataframe, data_length, api_finished, download_finished, mapping_file

    args = setup_parser()
    check_environment_variables()

    if mapping_file and not os.path.isfile(mapping_file):
        with open(mapping_file, "w") as file:
            print(
                "POINTID,SURVEY_DATE,TH_LAT,TH_LON,SENTINEL1_DATE,SENTINEL1_ID",
                file=file,
            )

    data = pd.read_csv(args.input, sep=",", header=0)
    os.makedirs(os.environ["TMP_DIR"], exist_ok=True)
    os.chdir(os.environ["TMP_DIR"])

    start = int(args.start) - 1
    end = int(args.end)
    if end > 0:
        dataframe = data.iloc[start:end]
    else:
        dataframe = data.iloc[start:]
    data_length = len(dataframe)

    print(f"Loaded {data_length} rows (lines {start+1}-{end or '∞'}).")

    threads_api = [
        threading.Thread(target=api_thread, args=(i, args)) for i in range(api_threads)
    ]
    threads_download = [
        threading.Thread(target=download_thread, args=(i,)) for i in range(download_threads)
    ]
    threads_crop = [
        threading.Thread(target=crop_thread, args=(i,)) for i in range(crop_threads)
    ]

    sys.stdout = ThreadPrefix(sys.__stdout__)
    sys.stderr = ThreadPrefix(sys.__stderr__)

    for thread in threads_api + threads_download + threads_crop:
        thread.start()

    for thread in threads_api:
        thread.join()
    api_finished = True

    for thread in threads_download:
        thread.join()
    download_finished = True

    for thread in threads_crop:
        thread.join()

    print(f"--- Finished downloading {data_length} Sentinel-1 datasets.")
    print(f"Failed: {errors}")


if __name__ == "__main__":
    main()
