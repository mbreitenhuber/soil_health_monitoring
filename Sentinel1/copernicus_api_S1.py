import glob
import os
import shutil
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile

import requests

# Make SoilMonitoring utilities importable from this standalone folder.
SOIL_MONITORING_ROOT = Path(__file__).resolve().parents[1] / "SoilMonitoring"
if str(SOIL_MONITORING_ROOT) not in sys.path:
    sys.path.append(str(SOIL_MONITORING_ROOT))

from satellite_utils.image_utils import ImageUtils


class CopernicusApiS1:
    """
    Sentinel-1 specific Copernicus Data Space API helper.
    """

    AUTH_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
    API_URL = "https://catalogue.dataspace.copernicus.eu/resto/api/collections/Sentinel1/search.json"
    DOWNLOAD_URL = (
        "https://zipper.dataspace.copernicus.eu/odata/v1/Products(#product_id#)/$value"
    )

    @classmethod
    def get_data(
        cls,
        date: str,
        latitude: float,
        longitude: float,
        span: int = 14,
        limit: int = 1,
        product_type: str = "GRD",
        sensor_mode: str = "IW",
        polarization: str = "VV,VH",
    ) -> list[dict]:
        """
        Query Sentinel-1 products around a location and date.
        """
        print(f"Getting Sentinel-1 features for {date} ({latitude}, {longitude})...")
        cls.authenticate()

        date_obj = datetime.fromisoformat(date)
        start = date_obj - timedelta(days=span)
        end = date_obj + timedelta(days=span + 1)

        query = (
            f"{cls.API_URL}"
            f"?productType={product_type}"
            f"&startDate={start.isoformat()}Z"
            f"&completionDate={end.isoformat()}Z"
            f"&lat={latitude}"
            f"&lon={longitude}"
            "&radius=500"
            "&sortParam=startDate"
            "&sortOrder=descending"
            f"&sensorMode={sensor_mode}"
            f"&polarisation={polarization}"
        )

        response = requests.get(
            query,
            allow_redirects=True,
            headers={"Authorization": f"Bearer {os.environ['COPERNICUS_TOKEN']}"},
        )
        response.raise_for_status()
        data = response.json()

        features = data.get("features", [])
        if not features:
            print("No Sentinel-1 data available for this date/location.", file=sys.stderr)
            return []

        # Sort by absolute distance to the requested survey date.
        features.sort(key=lambda product: cls._product_timestamp_diff(product, date_obj))
        return features[:limit]

    @classmethod
    def download_data(
        cls,
        product_id: str,
        dataset_name: str,
        target_path: str | None = None,
    ) -> None:
        """
        Download and extract one Sentinel-1 dataset.
        """
        if target_path is None:
            target_path = os.environ.get("SENTINEL1_DIR", "")

        dataset_dir = Path(target_path) / dataset_name
        if dataset_dir.exists():
            print(f"The Sentinel-1 dataset '{dataset_name}' has already been downloaded.")
            return

        os.makedirs(target_path, exist_ok=True)
        zipfile_path = Path(target_path) / f"{dataset_name}.zip"
        cls.authenticate()

        try:
            with requests.get(
                cls.DOWNLOAD_URL.replace("#product_id#", product_id),
                allow_redirects=True,
                stream=True,
                headers={"Authorization": f"Bearer {os.environ['COPERNICUS_TOKEN']}"},
            ) as response:
                response.raise_for_status()
                with open(zipfile_path, "wb") as file:
                    total = int(response.headers.get("content-length", 0))
                    downloaded = 0
                    if total > 0:
                        print(f"Downloading {round(total / 1048576)} MB to '{zipfile_path}'...")
                    else:
                        print(f"Downloading dataset to '{zipfile_path}'...")

                    for chunk in response.iter_content(chunk_size=8388608):
                        if chunk:
                            file.write(chunk)
                            if total > 0 and sys.stdout.isatty():
                                downloaded += len(chunk)
                                progress = round(downloaded * 100 / total)
                                print(f"  {progress}%", end="\r")
                    print("Download complete")

            cls._extract(zipfile_path, dataset_dir)
        except Exception:
            shutil.rmtree(dataset_dir, True)
            shutil.rmtree(Path(target_path) / f"{dataset_name}_tmp", True)
            try:
                os.remove(zipfile_path)
            except OSError:
                pass
            raise

    @staticmethod
    def crop_images(
        dataset_name: str,
        latitude: float,
        longitude: float,
        parent_path: str | None = None,
        crop_annotation: bool = True,
    ) -> None:
        """
        Crop Sentinel-1 rasters around a location.
        """
        if parent_path is None:
            parent_path = os.environ.get("SENTINEL1_DIR", "")

        dataset_root = Path(parent_path) / dataset_name
        img_path = dataset_root / "IMG_DATA"
        print(f"Cropping Sentinel-1 measurement rasters in '{img_path}'...")
        for file in glob.glob("**/*.[Tt][Ii][Ff]*", root_dir=img_path, recursive=True):
            file_path = str(img_path / file)
            ImageUtils.crop_location(file_path, file_path, latitude, longitude, 50)

        if not crop_annotation:
            return

        annotation_path = dataset_root / "ANNOTATION_RASTER"
        if annotation_path.is_dir():
            print(f"Cropping optional annotation rasters in '{annotation_path}'...")
            for file in glob.glob("**/*.[Tt][Ii][Ff]*", root_dir=annotation_path, recursive=True):
                file_path = str(annotation_path / file)
                ImageUtils.crop_location(file_path, file_path, latitude, longitude, 50)

    @classmethod
    def authenticate(cls) -> None:
        """
        Authenticate with Copernicus Data Space and cache token in env vars.
        """
        if cls._is_authenticated():
            return

        response = requests.post(
            cls.AUTH_URL,
            allow_redirects=True,
            data={
                "username": os.environ["COPERNICUS_USER"],
                "password": os.environ["COPERNICUS_PASSWORD"],
                "client_id": "cdse-public",
                "grant_type": "password",
            },
        )
        response.raise_for_status()
        token = response.json()

        os.environ["COPERNICUS_TOKEN"] = token["access_token"]
        os.environ["COPERNICUS_TOKEN_EXPIRES"] = str(
            round(time.time()) + token["expires_in"] - 10
        )
        print("Copernicus Dataspace authentication successful")

    @staticmethod
    def _is_authenticated() -> bool:
        if not os.environ.get("COPERNICUS_TOKEN"):
            return False
        if not os.environ.get("COPERNICUS_TOKEN_EXPIRES"):
            return True
        return int(os.environ["COPERNICUS_TOKEN_EXPIRES"]) > time.time()

    @staticmethod
    def _product_timestamp_diff(product: dict, date: datetime) -> int:
        start_date = datetime.fromisoformat(product["properties"]["startDate"])
        return abs(date.timestamp() - start_date.timestamp())

    @classmethod
    def _extract(cls, source_path: Path, target_path: Path) -> None:
        """
        Extract a Sentinel-1 zip archive into a normalized lightweight layout:
        target/
          IMG_DATA/
            VV.tiff, VH.tiff, ...
          ANNOTATION_RASTER/  (optional)
          manifest.safe
        """
        print("Extracting...")
        shutil.rmtree(target_path, True)

        tmp_root = target_path.parent / f"{source_path.stem}_tmp"
        with ZipFile(source_path, "r") as zip_file:
            zip_file.extractall(tmp_root)
        os.remove(source_path)

        os.makedirs(target_path, exist_ok=True)
        root = tmp_root
        entries = list(root.iterdir())
        if len(entries) == 1 and entries[0].is_dir():
            root = entries[0]

        safe_root = cls._find_safe_root(root)
        cls._restructure_sentinel1(target_path, safe_root)
        shutil.rmtree(tmp_root, True)

    @staticmethod
    def _find_safe_root(root_path: Path) -> Path:
        if root_path.suffix.upper() == ".SAFE":
            return root_path
        for candidate in root_path.rglob("*.SAFE"):
            if candidate.is_dir():
                return candidate
        raise FileNotFoundError("Could not locate Sentinel-1 .SAFE root after extraction.")

    @staticmethod
    def _restructure_sentinel1(target_path: Path, safe_root: Path) -> None:
        img_target = target_path / "IMG_DATA"
        annotation_target = target_path / "ANNOTATION_RASTER"
        os.makedirs(img_target, exist_ok=True)

        manifest = safe_root / "manifest.safe"
        if manifest.is_file():
            shutil.copy2(manifest, target_path / "manifest.safe")

        # Copy measurement rasters and standardize names by polarization when possible.
        seen = {}
        measurement_dir = safe_root / "measurement"
        if not measurement_dir.is_dir():
            raise FileNotFoundError("Sentinel-1 measurement directory not found in SAFE data.")

        for raster in sorted(measurement_dir.glob("*.[Tt][Ii][Ff]*")):
            lower = raster.name.lower()
            if "-vv-" in lower:
                key = "VV"
            elif "-vh-" in lower:
                key = "VH"
            elif "-hh-" in lower:
                key = "HH"
            elif "-hv-" in lower:
                key = "HV"
            else:
                key = raster.stem.upper()

            seen[key] = seen.get(key, 0) + 1
            suffix = f"_{seen[key]}" if seen[key] > 1 else ""
            target_name = f"{key}{suffix}.tiff"
            shutil.copy2(raster, img_target / target_name)

        # Optional georeferenced rasters in annotation tree.
        annotation_dir = safe_root / "annotation"
        if annotation_dir.is_dir():
            annotation_files = list(annotation_dir.rglob("*.[Tt][Ii][Ff]*"))
            if annotation_files:
                os.makedirs(annotation_target, exist_ok=True)
                for raster in annotation_files:
                    shutil.copy2(raster, annotation_target / raster.name)
