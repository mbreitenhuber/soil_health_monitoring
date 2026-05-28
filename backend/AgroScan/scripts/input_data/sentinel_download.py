#!/usr/bin/env python
# Downloads and crops all Sentinel-2 images in the given CSV table (multi-threaded)
# More information with 'sentinel_download.py -h'

## command
# python .\AgroScan\scripts\input_data\sentinel_download.py --input ./data/datasets/LUCAS_SOIL_processed.csv
# python .\AgroScan\scripts\input_data\sentinel_download.py --input ./data/datasets/LUCAS_SOIL_processed.csv --api-threads 1 --download-threads 1 --worker-threads 1  
# python ./AgroScan/scripts/input_data/sentinel_download.py --input ./data/datasets/LUCAS_SOIL_processed_DE.csv --mapping ./data/mapping_test.csv
# test with 2 rows: python ./AgroScan/scripts/input_data/sentinel_download.py --input ./data/datasets/LUCAS_SOIL_processed_DE.csv --mapping ./data/mapping_test.csv --start 4 --end 5

import argparse
import json
import os
import shutil
import sys
import threading
import time
import traceback
import math
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

sys.path.append(str(Path(os.path.abspath(__file__)).parent.parent.parent))
#from AgroScan.satellite_utils.copernicus_api import CopernicusApi # remove AgroScan if necessary
from satellite_utils.copernicus_api import CopernicusApi 

class ThreadPrefix:
    """
    Used to prefix '[Thread Name]' to every output message of a thread.
    """

    def __init__(self, stdout):
        self.prefixes = {}
        self.stdout = stdout
        self.lock = threading.Lock()
        self.line_break = True

    def add_prefix(self, prefix):
        self.prefixes[threading.get_ident()] = prefix

    def write(self, message):
        # prefix every output line
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
file_lock = threading.Lock()  # Lock for thread-safe file writing
raw_scene_lock_guard = threading.Lock()
raw_scene_locks: dict[tuple[str, str], threading.Lock] = {}

download_jobs = []
crop_jobs = []

api_threads = 0
download_threads = 0
crop_threads = 0
mapping_file = ""

dataframe: pd.DataFrame
data_length = 0

api_finished = False
download_finished = False


def _result_path(date: str, latitude: float, longitude: float) -> Path:
    return Path(os.environ["SENTINEL_DIR"]) / date / f"{latitude} {longitude}"


def _raw_cache_root(date: str) -> Path:
    # Raw, un-cropped Sentinel scenes are cached separately from the final
    # per-point cropped outputs so nearby points can reuse the same download.
    return Path(os.environ["SENTINEL_DIR"]) / "_raw" / date


def _raw_scene_path(date: str, scene_id: str) -> Path:
    return _raw_cache_root(date) / scene_id


def _raw_scene_lock(date: str, scene_id: str) -> threading.Lock:
    key = (date, scene_id)
    with raw_scene_lock_guard:
        lock = raw_scene_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            raw_scene_locks[key] = lock
        return lock


def _metadata_path(result_path: Path) -> Path:
    return result_path / "metadata.json"


def _distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate distance in meters between two GPS points."""
    radius_m = 6371000.0
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * radius_m * math.asin(math.sqrt(a))


def _find_cached_result_path(date: str, latitude: float, longitude: float, tolerance_m: float = 10.0) -> Path | None:
    """Find an existing cropped result within tolerance for the same Sentinel date."""
    date_root = Path(os.environ["SENTINEL_DIR"]) / date
    if not date_root.is_dir():
        return None

    best_match: Path | None = None
    best_distance = tolerance_m

    for entry in date_root.iterdir():
        if not entry.is_dir() or entry.name.startswith("_"):
            continue

        metadata_file = _metadata_path(entry)
        if not metadata_file.is_file():
            continue

        try:
            with open(metadata_file, "r") as file:
                metadata = json.load(file)
            cached_lat = float(metadata.get("latitude"))
            cached_lon = float(metadata.get("longitude"))
        except Exception:
            continue

        distance = _distance_meters(latitude, longitude, cached_lat, cached_lon)
        if distance <= best_distance:
            best_distance = distance
            best_match = entry

    return best_match


def _read_cached_sentinel_id(result_path: Path) -> str:
    metadata_file = _metadata_path(result_path)
    if not metadata_file.is_file():
        return "cached"

    try:
        with open(metadata_file, "r") as file:
            metadata = json.load(file)
        return str(metadata.get("sentinel_id", "cached"))
    except Exception:
        return "cached"


def _result_path_coordinates(result_path: Path) -> tuple[str, str]:
    try:
        lat_text, lon_text = result_path.name.split(" ", 1)
        return lat_text, lon_text
    except ValueError:
        return "", ""


def _write_metadata(result_path: Path, job: dict) -> None:
    metadata = {
        "point_id": job["point"],
        "survey_date": job.get("survey_date", ""),
        "latitude": job["lat"],
        "longitude": job["lon"],
        "sentinel_date": job["date"],
        "sentinel_id": job["id"],
    }
    with open(_metadata_path(result_path), "w") as file:
        json.dump(metadata, file, indent=2)


def _ensure_raw_scene(job: dict) -> Path:
    raw_scene_path = _raw_scene_path(job["date"], job["id"])
    lock = _raw_scene_lock(job["date"], job["id"])

    # Multiple grid points can resolve to the same Sentinel scene. Guard the
    # download/extract step so only one thread creates the shared cache entry.
    with lock:
        if raw_scene_path.is_dir():
            print(f"Using raw scene: {raw_scene_path}")
            return raw_scene_path

        os.makedirs(_raw_cache_root(job["date"]), exist_ok=True)
        print(f"Downloading raw scene: {job['id']} -> {raw_scene_path}")
        CopernicusApi.download_data(job["id"], job["id"], target_path=str(_raw_cache_root(job["date"])))
        return raw_scene_path


def _append_mapping_row(point_id: str, survey_date: str, latitude: float, longitude: float, sentinel_date: str, sentinel_id: str) -> None:
    if not mapping_file:
        return

    with file_lock:
        with open(mapping_file, "a") as file:
            print(
                f"{point_id},{survey_date},{latitude},{longitude},{sentinel_date},{sentinel_id}",
                file=file,
            )


def validate_environment_variables() -> None:
    """
    Validates that all required environment variables are set.
    Raises an error if any are missing.
    """
    required_vars = [
        "SENTINEL_DIR",
        "TMP_DIR",
        "COPERNICUS_USER",
        "COPERNICUS_PASSWORD",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ]
    
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    
    if missing_vars:
        error_msg = (
            "❌ Missing required environment variables:\n"
            + "\n".join(f"  - {var}" for var in missing_vars)
            + "\n\nPlease set these variables in your .env file or shell environment."
        )
        print(error_msg, file=sys.stderr)
        sys.exit(1)
    
    print("✓ All required environment variables are set.")


def setup_parser() -> argparse.Namespace:
    """
    Parses command line arguments

    Returns:
        argparse.Namespace: argument values
    """
    global api_threads, download_threads, crop_threads, mapping_file

    parser = argparse.ArgumentParser(
        description="Downloads and crops all Sentinel-2 images in the given CSV table.\n"
        "It is important to balance the amount of threads for every type to the resources available on the machine.\n\n"
        "Required environment variables: \n"
        "SENTINEL_DIR: Target directory for the cropped Sentinel-2 files \n"
        "TMP_DIR: Temporary working directory (ramdisk recommended) \n"
        "COPERNICUS_USER: Copernicus API user \n"
        "COPERNICUS_PASSWORD: Copernicus API password \n"
        "AWS_ACCESS_KEY_ID: Copernicus S3 key ID \n"
        "AWS_SECRET_ACCESS_KEY: Copernicus S3 secret \n",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--api-threads",
        "-a",
        help="Number of Copernicus API threads (balance of network and CPU)",
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
    parser.add_argument(
        "--start", help="First CSV row to download", nargs="?", default="1"
    )
    parser.add_argument(
        "--end", help="Last CSV row to download", nargs="?", default="0"
    )
    parser.add_argument(
        "--input", "-i", help="Path to input LUCAS SOIL CSV file", required=True
    )
    parser.add_argument(
        "--mapping",
        "-m",
        help="Path to save the mapping CSV\n"
        "Needed to map soil data points to downloaded Sentinel-2 datasets later",
        nargs="?",
        default="",
    )
    args = parser.parse_args()

    api_threads = int(args.api_threads)
    download_threads = int(args.download_threads)
    crop_threads = int(args.worker_threads)
    if args.mapping:
        mapping_file = os.path.realpath(args.mapping)

    return args


def api_thread(thread_index: int) -> None:
    """
    Thread for the API workers, needs a balance of network bandwith and CPU power.
    Queries datasets from the Copernicus API and filters clouded images.

    Args:
        thread_index (int): Index of the thread (for log output)
    """
    global dataframe, data_length, api_counter, errors, download_threads, download_jobs
    # prefix every output to identify the thread
    sys.stdout.add_prefix(f"[API Thread {thread_index+1}]")
    sys.stderr.add_prefix(f"[API Thread {thread_index+1}]")

    while True:
        if len(download_jobs) > download_threads * 4:
            # do nothing if there is enough work for the download threads
            time.sleep(0.1)
            continue

        with counter_lock:
            index = api_counter
            api_counter += 1

        if index >= data_length:
            print("Thread finished.")
            return

        try:
            row = dataframe.iloc[index]
            date = pd.to_datetime(str(row["SURVEY_DATE"]).strip(), errors="raise").strftime(
                "%Y-%m-%d"
            )
            latitude = float(row["TH_LAT"])
            longitude = float(row["TH_LONG"])
            print(f"Date: {date}, Lat: {latitude}, Long: {longitude}")

            data = CopernicusApi.get_data(date, latitude, longitude)
            if not data:
                raise ValueError("No Sentinel data found!")

            data = data[0]
            sentinel_date = data["properties"]["startDate"].split("T")[0]
            print(f"Best dataset: {data['id']} ({sentinel_date})")

            result_path = _result_path(sentinel_date, latitude, longitude)
            if result_path.is_dir():
                print(f"Dataset already downloaded: {result_path}")
                lat_text, lon_text = _result_path_coordinates(result_path)
                _append_mapping_row(
                    str(row["POINTID"]),
                    date,
                    lat_text or latitude,
                    lon_text or longitude,
                    sentinel_date,
                    _read_cached_sentinel_id(result_path),
                )
                continue

            cached_result_path = _find_cached_result_path(sentinel_date, latitude, longitude)
            if cached_result_path is not None:
                print(f"Reusing cached dataset within tolerance: {cached_result_path}")
                lat_text, lon_text = _result_path_coordinates(cached_result_path)
                _append_mapping_row(
                    str(row["POINTID"]),
                    date,
                    lat_text or latitude,
                    lon_text or longitude,
                    sentinel_date,
                    _read_cached_sentinel_id(cached_result_path),
                )
                continue

            if mapping_file:
                _append_mapping_row(
                    str(row["POINTID"]),
                    date,
                    latitude,
                    longitude,
                    sentinel_date,
                    data["id"],
                )

            download_jobs.append(
                {
                    "point": str(row["POINTID"]),
                    "id": data["id"],
                    "date": sentinel_date,
                    "survey_date": date,
                    "lat": latitude,
                    "lon": longitude,
                }
            )
        except Exception as e:
            print(e, file=sys.stderr)
            with counter_lock:
                errors += 1


def download_thread(thread_index: int) -> None:
    """
    Thread for the Download workers, needs network bandwith.
    Downloads and extracts full datasets from the Copernicus API.

    Args:
        thread_index (int): Index of the thread (for log output)
    """
    global data_length, errors, crop_threads, download_jobs, crop_jobs, api_finished
    # prefix every output to identify the thread
    sys.stdout.add_prefix(f"[DL Thread {thread_index+1}]")
    sys.stderr.add_prefix(f"[DL Thread {thread_index+1}]")

    while True:
        if not download_jobs and api_finished:
            print("Thread finished.")
            return
        if not download_jobs or len(crop_jobs) > crop_threads * 2:
            # do nothing if there is enough work for the crop threads
            time.sleep(0.1)
            continue

        job = download_jobs.pop(0)

        result_path = _result_path(job["date"], job["lat"], job["lon"])
        if result_path.is_dir():
            print(f"Using existing cropped dataset: {result_path}")
            continue

        cached_result_path = _find_cached_result_path(job["date"], job["lat"], job["lon"])
        if cached_result_path is not None:
            print(f"Using cached cropped dataset within tolerance: {cached_result_path}")
            continue

        try:
            raw_scene_path = _ensure_raw_scene(job)
            print(f"Cropping point {job['point']} from raw scene: {raw_scene_path}")
            crop_jobs.append(job)
        except Exception as e:
            print(e, file=sys.stderr)
            with counter_lock:
                errors += 1


def crop_thread(thread_index: int) -> None:
    """
    Thread for the Image-Cropping workers, needs heavy CPU power.
    Crops downloaded images around the area of interest.

    Args:
        thread_index (int): Index of the thread (for log output)
    """
    global data_length, errors, crop_jobs, download_finished
    # prefix every output to identify the thread
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

        result_path = (
            Path(os.environ["SENTINEL_DIR"])
            / job["date"]
            / f"{job['lat']} {job['lon']}"
        )
        cached_result_path = _find_cached_result_path(job["date"], job["lat"], job["lon"])
        if cached_result_path is not None:
            print(f"Using cached cropped dataset within tolerance: {cached_result_path}")
            _write_metadata(cached_result_path, job)
            continue

        raw_scene_path = _raw_scene_path(job["date"], job["id"])
        tmp_point_path = Path(os.environ["TMP_DIR"]) / job["point"]

        try:
            CopernicusApi.crop_images(
                job["point"],
                job["lat"],
                job["lon"],
                parent_path=os.environ["TMP_DIR"],
                source_path=str(raw_scene_path),
                target_path=str(tmp_point_path),
            )
            os.makedirs(Path(os.environ["SENTINEL_DIR"]) / job["date"], exist_ok=True)
            if result_path.exists():
                shutil.rmtree(result_path, True)
            shutil.move(tmp_point_path, result_path)
            _write_metadata(result_path, job)
            print(f"Point {job['point']} finished.")
        except Exception as e:
            print(e, file=sys.stderr)
            with counter_lock:
                errors += 1
            shutil.rmtree(Path(os.environ["TMP_DIR"]) / job["point"], True)


def main():
    global dataframe, data_length, api_threads, download_threads, crop_threads, api_finished, download_finished, mapping_file

    # Validate environment variables before starting
    validate_environment_variables()
    
    args = setup_parser()

    # create a fresh Sentinel mapping file for this run
    if mapping_file:
        with open(mapping_file, "w") as file:
            print(
                "POINTID,SURVEY_DATE,TH_LAT,TH_LONG,SENTINEL_DATE,SENTINEL_ID",
                file=file,
            )

    data = pd.read_csv(args.input, sep=",", header=0)
    #data = data[5:6]

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

    # create all threads
    threads_api = []
    threads_download = []
    threads_crop = []
    for i in range(api_threads):
        threads_api.append(threading.Thread(target=api_thread, args=(i,)))
    for i in range(download_threads):
        threads_download.append(threading.Thread(target=download_thread, args=(i,)))
    for i in range(crop_threads):
        threads_crop.append(threading.Thread(target=crop_thread, args=(i,)))

    sys.stdout = ThreadPrefix(sys.__stdout__)
    sys.stderr = ThreadPrefix(sys.__stderr__)

    # start all threads
    for thread in threads_api + threads_download + threads_crop:
        thread.start()

    # wait for all API threads to finish
    for thread in threads_api:
        thread.join()
    api_finished = True

    # wait for all Download threads to finish
    for thread in threads_download:
        thread.join()
    download_finished = True

    # wait for the last crop threads and display results
    for thread in threads_crop:
        thread.join()
    print(f"--- Finished downloading {data_length} Sentinel-2 datasets.")
    print(f"Failed: {errors}")


if __name__ == "__main__":
    main()
