import glob
import os
import shutil
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile

import boto3
import cv2
import numpy as np
import requests

#from AgroScan.satellite_utils.image_utils import ImageUtils # remove AgroScan if necessary
from satellite_utils.image_utils import ImageUtils

class CopernicusApi:
    """
    Methods to query and download Sentinel 2 or Landsat 8 satellite data
    """

    AUTH_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
    API_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
    DOWNLOAD_URL = (
        "https://zipper.dataspace.copernicus.eu/odata/v1/Products(#product_id#)/$value"
    )
    AWS_ENDPOINT_URL = "https://eodata.dataspace.copernicus.eu"
    AWS_BUCKET = "eodata.dataspace.copernicus.eu"

    session = boto3.session.Session()

    s3 = None

    @classmethod
    def _get_s3_client(cls):
        if cls.s3 is None:
            cls.s3 = boto3.client(
                "s3",
                endpoint_url=cls.AWS_ENDPOINT_URL,
                aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
                aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
                region_name="default",
            )
        return cls.s3

    @classmethod
    def get_data(
        cls,
        date: str,
        latitude: float,
        longitude: float,
        product: str = "Sentinel2",
        span: int = 14,
        filter_clouds: bool = True,
        limit: int = 1,
    ) -> list[dict]:
        """
        Searches for Copernicus datasets

        Parameters:
            date (str): Date in YYYY-MM-DD format
            latitude (float): GPS latitude
            longitude (float): GPS longitude
            product (str, optional): Name of the Copernicus product, defaults to 'Sentinel2'.
            span (int, optional): Maximum span of days to search in each direction (past and future), defaults to 14.
            filter_clouds (bool, optional): Should images with clouds above the GPS position be filtered?, defaults to True.
            limit (int, optional): Maximum number of returned entries, defaults to 1.

        Returns:
            list[dict]: list of datasets, ordered by date difference to the search date
        """
        print(f"Getting {product} features for {date} ({latitude}, {longitude})...")

        date = datetime.fromisoformat(date)
        start = date - timedelta(days=span)
        end = date + timedelta(days=span + 1)

        collection = "SENTINEL-2"
        name_token = "MSIL2A"
        if product.lower().startswith("landsat"):
            collection = "LANDSAT-8-ESA"
            name_token = "L2SP"

        filter_query = (
            f"Collection/Name eq '{collection}' and "
            f"ContentDate/Start ge {start.isoformat()}Z and "
            f"ContentDate/Start lt {end.isoformat()}Z and "
            f"OData.CSC.Intersects(area=geography'SRID=4326;POINT({longitude} {latitude})') and "
            f"contains(Name,'{name_token}')"
        )

        response = requests.get(
            cls.API_URL,
            allow_redirects=True,
            params={
                "$filter": filter_query,
                "$orderby": "ContentDate/Start desc",
                "$top": max(limit * 10, 20),
            },
        )
        response.raise_for_status()
        data = response.json()

        products = data.get("value", [])
        if not products:
            print(
                f"No data available for the chosen date and location!", file=sys.stderr
            )
            return None

        # Keep the legacy feature shape used by the rest of the pipeline.
        features = []
        for item in products:
            s3_path = item.get("S3Path", "")
            product_identifier = s3_path if s3_path else item.get("Name", "")
            features.append(
                {
                    "id": item.get("Id", ""),
                    "properties": {
                        "startDate": item.get("ContentDate", {}).get("Start", ""),
                        "productIdentifier": product_identifier,
                    },
                }
            )

        # sort results by difference to the desired date
        features.sort(key=lambda product: cls._productTimestampDiff(product, date))

        if not filter_clouds:
            return features[:limit]

        result = []
        for feature in features:
            if len(result) >= limit:
                break
            if cls._cloud_covered(feature, latitude, longitude, product):
                print(
                    f"Dataset '{feature['id']}' ({feature['properties']['startDate']}) has been cloud filtered."
                )
            else:
                result.append(feature)

        return result

    @classmethod
    def download_data(
        cls,
        id: str,
        dataset_name: str,
        product: str = "Sentinel2",
        target_path: str = None,
    ) -> None:
        """
        Downloads and extracts a full satellite dataset

        Parameters:
            id (str): ID of the dataset (from Copernicus API)
            dataset_name (str): Name under which the data should be saved
            product (str, optional): Name of the Copernicus product, defaults to 'Sentinel2'.
            target_path (str, optional): Target path to extract to, defaults to $SENTINEL_DIR or $LANDSAT_DIR.
        """
        if target_path is None:
            target_path = os.environ.get("SENTINEL_DIR", "")
            if product.lower().startswith("landsat"):
                target_path = os.environ.get("LANDSAT_DIR", "")

        if (Path(target_path) / dataset_name).exists():
            print(
                f"The satellite dataset '{dataset_name}' has already been downloaded."
            )
            return

        os.makedirs(target_path, exist_ok=True)
        zipfile = Path(target_path) / f"{dataset_name}.zip"

        cls.authenticate()

        try:
            # download zipfile from server and display progress
            with requests.get(
                cls.DOWNLOAD_URL.replace("#product_id#", id),
                allow_redirects=True,
                stream=True,
                headers={"Authorization": f"Bearer {os.environ['COPERNICUS_TOKEN']}"},
            ) as response:
                response.raise_for_status()
                with open(zipfile, "wb") as file:
                    total = int(response.headers.get("content-length"))
                    downloaded = 0
                    last_reported_bucket = -1
                    print(f"Downloading {round(total / 1048576)} MB to '{zipfile}'...")
                    for chunk in response.iter_content(
                        chunk_size=8388608
                    ):  # 8 MB chunks
                        if chunk:
                            file.write(chunk)
                            if sys.stdout.isatty():
                                downloaded += len(chunk)
                                progress = round(downloaded * 100 / total)
                                progress_bucket = progress // 10
                                if progress_bucket > last_reported_bucket:
                                    last_reported_bucket = progress_bucket
                                    print(
                                        f"Download progress: {progress}% ({round(downloaded / 1048576)} / {round(total / 1048576)} MB)"
                                    )

                    print("Download complete")

                    cls._extract(zipfile, Path(target_path) / dataset_name, product)
        except Exception as e:
            try:
                shutil.rmtree(Path(target_path) / dataset_name, True)
                shutil.rmtree(Path(target_path) / f"{dataset_name}_tmp", True)
                os.remove(zipfile)
            except:
                pass
            raise

    @staticmethod
    def crop_images(
        dataset_name: str,
        latitude: float,
        longitude: float,
        product: str = "Sentinel2",
        parent_path: str = None,
        source_path: str = None,
        target_path: str = None,
    ) -> None:
        """
        Crops all satellite images in the dataset to 100px around the given location to save disk space

        Parameters:
            dataset_name (str): Name of the dataset folder
            latitude (float): GPS latitude
            longitude (float): GPS longitude
            product (str, optional): Name of the Copernicus product, defaults to 'Sentinel2'.
            target_path (str, optional): Parent path of the dataset folder, defaults to $SENTINEL_DIR.
        """
        landsat = product.lower().startswith("landsat")

        if landsat:
            if parent_path is None:
                parent_path = os.environ.get("LANDSAT_DIR", "")
            extension = "tif"
        else:
            if parent_path is None:
                parent_path = os.environ.get("SENTINEL_DIR", "")
            extension = "jp2"

        source_root = Path(source_path) if source_path else Path(parent_path) / dataset_name
        path = source_root / "IMG_DATA"
        output_root = Path(target_path) if target_path else source_root

        print(f"Cropping images in '{path}'...")

        for file in glob.glob(f"**/*.{extension}", root_dir=path, recursive=True):
            file_path = str(path / file)
            target_file_path = str(output_root / "IMG_DATA" / file)
            Path(target_file_path).parent.mkdir(parents=True, exist_ok=True)
            ImageUtils.crop_location(file_path, target_file_path, latitude, longitude, 50)

        if landsat:
            path = source_root / "QI_DATA"
            print(f"Cropping images in '{path}'...")
            for file in glob.glob(f"**/*.{extension}", root_dir=path, recursive=True):
                file_path = str(path / file)
                target_file_path = str(output_root / "QI_DATA" / file)
                Path(target_file_path).parent.mkdir(parents=True, exist_ok=True)
                ImageUtils.crop_location(file_path, target_file_path, latitude, longitude, 50)

    @staticmethod
    def _productTimestampDiff(product: dict, date: datetime) -> int:
        """
        Calculates the difference between the product date and the given date in seconds.
        Used to sort the api result list

        Args:
            product (dict): Sentinel 2 product dict
            date (datetime): Desired date

        Returns:
            int: Time difference in seconds
        """
        start_date_raw = product["properties"].get("startDate", "")
        if not start_date_raw:
            return 10**18
        if start_date_raw.endswith("Z"):
            start_date_raw = start_date_raw.replace("Z", "+00:00")
        startDate = datetime.fromisoformat(start_date_raw)
        return abs(date.timestamp() - startDate.timestamp())

    @classmethod
    def authenticate(cls) -> None:
        """
        Authenticates with the Sentinel API using $COPERNICUS_USER and $COPERNICUS_PASSWORD
        and saves the authentication token to $COPERNICUS_TOKEN.
        Authentication is skipped if there is already a valid token.
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
        """
        Checks if the authentication token stored in $COPERNICUS_TOKEN is present and not expired.

        Returns:
            bool: Returns True if the script is already authenticated
        """
        if not os.environ.get("COPERNICUS_TOKEN"):
            return False
        if not os.environ.get("COPERNICUS_TOKEN_EXPIRES"):
            return True
        return int(os.environ["COPERNICUS_TOKEN_EXPIRES"]) > time.time()

    @classmethod
    def _extract(cls, source_path: Path, target_path: Path, product: str) -> None:
        """
        Extracts the contents of the sentinel dataset zipfile, deletes unneccesary files
        and renames the image files for easier access.
        The following directory structure is achieved (Sentinel):
        ├── AUX_DATA
        │   └── <...>
        ├── IMG_DATA
        │   ├── R10m
        │   │   ├── AOT.jp2
        │   │   ├── B02.jp2
        │   │   ├── B03.jp2
        │   │   └── <...>.jp2
        │   ├── R20m
        │   │   └── <...>.jp2
        │   └── R60m
        │       └── <...>.jp2
        ├── QI_DATA
        │   └── <...>
        ├── MTD_MSIL2A.xml
        └── MTD_TL.xml

        Directory structure for Landsat:
        ├── IMG_DATA
        │   ├── B1.tif
        │   ├── B2.tif
        │   └── <...>.tif
        ├── QI_DATA
        │   └── <...>
        ├── ANG.txt
        ├── MTL.json
        └── <...>

        Parameters:
            source_path (Path): Path of the downloaded sentinel zipfile
            target_path (Path): Target folder to extract to
            product (str): Name of the Copernicus product
        """
        print("Extracting...")
        shutil.rmtree(target_path, True)

        with ZipFile(source_path, "r") as zip:
            zip.extractall(target_path.parent / f"{source_path.stem}_tmp")
            os.remove(source_path)

        # get data path
        os.mkdir(target_path)
        root = target_path.parent / f"{source_path.stem}_tmp"
        root = root / os.listdir(root)[0]

        if product.lower().startswith("landsat"):
            cls._restructure_landsat(target_path, root)
        else:
            cls._restructure_sentinel(target_path, root)

        shutil.rmtree(root.parent)

    @staticmethod
    def _restructure_sentinel(target_path: Path, root_path: Path) -> None:
        """
        Restructures the Sentinel-2 dataset folder by moving and renaming
        all files according to a defined standard (documented under _extract).

        Parameters:
            target_path (Path): Target folder to extract to
            root_path (Path): Root path of the unzipped Landsat dataset
        """

        # get image directory
        path = root_path / "GRANULE"
        path = path / os.listdir(path)[0]
        img_path = target_path / "IMG_DATA"

        os.rename(path, target_path)
        img_path = target_path / "IMG_DATA"
        os.rename(root_path / "MTD_MSIL2A.xml", target_path / "MTD_MSIL2A.xml")

        # rename image files to "<band>.jp2"
        for dir in os.listdir(img_path):
            for file in os.listdir(img_path / dir):
                band = file.split("_")[2]
                os.rename(
                    img_path / dir / file,
                    img_path / dir / f"{band}.jp2",
                )
        for file in glob.glob("*_PVI.jp2", root_dir=target_path / "QI_DATA"):
            os.rename(
                target_path / "QI_DATA" / file,
                target_path / "QI_DATA" / "PVI.jp2",
            )

    @staticmethod
    def _restructure_landsat(target_path: Path, root_path: Path) -> None:
        """
        Restructures the Landsat dataset folder by moving and renaming
        all files according to a defined standard (documented under _extract).

        Parameters:
            target_path (Path): Target folder to extract to
            root_path (Path): Root path of the unzipped Landsat dataset
        """
        os.rename(root_path, target_path)
        os.mkdir(target_path / "IMG_DATA")
        os.mkdir(target_path / "QI_DATA")

        for file in os.listdir(target_path):
            if not Path(target_path / file).is_file():
                continue
            name, extension = os.path.splitext(file)
            band = name.split("_")[-1]
            if extension.lower() != ".tif":
                os.rename(target_path / file, target_path / f"{band}{extension}")
            elif band[0] == "B":
                os.rename(target_path / file, target_path / "IMG_DATA" / f"{band}.tif")
            else:
                os.rename(target_path / file, target_path / "QI_DATA" / f"{band}.tif")

        os.remove(target_path / "small.jpeg")
        os.rename(target_path / "large.jpeg", target_path / "thumbnail.jpg")

    @classmethod
    def _cloud_covered(
        cls, feature: dict, latitude: float, longitude: float, product: str
    ) -> bool:
        """
        Checks if there is a cloud on the given GPS position of the given product
        by downloading and checking the cloud mask from S3.
        Works only for Sentinel-2 data.

        Parameters:
            feature (dict): Feature dict from the Copernicus API
            latitude (float): GPS latitude
            longitude (float): GPS longitude
            product (str): Name of the Copernicus product

        Returns:
            bool: Returns True if there is a cloud on the given position
        """
        # never filter Landsat images
        if product.lower().startswith("Landsat"):
            return False

        image_file = Path(os.environ["TMP_DIR"]) / "cloud_masks" / f"{uuid.uuid4()}.jp2"

        try:
            if not image_file.is_file():
                s3_client = cls._get_s3_client()
                response = s3_client.list_objects_v2(
                    Bucket="eodata",
                    Prefix=feature["properties"]["productIdentifier"].split("/", 2)[2],
                )

                cloud_mask = False
                if "Contents" in response:
                    for obj in response["Contents"]:
                        if obj["Key"].endswith("/MSK_CLDPRB_20m.jp2"):
                            cloud_mask = obj["Key"]

                os.makedirs(image_file.parent, exist_ok=True)
                s3_client.download_file("eodata", cloud_mask, image_file)

            x, y = ImageUtils.location_to_pixel(image_file, latitude, longitude)
            result = cls._check_cloud_pixel(image_file, x, y)
        except:
            raise
        finally:
            try:
                os.remove(image_file)
            except:
                pass

        return result

    @staticmethod
    def _check_cloud_pixel(
        input_file: str, x: int, y: int, radius: int = 5, threshold: int = 20
    ) -> bool:
        """
        Checks whether the given pixel and its neighboring pixels are covered by clouds. (Sentinel-2 only)

        Parameters:
            input_file (str): Path to the input file (GeoTIFF with bands).
            x (int): Pixel x-coordinate
            y (int): Pixel y-coordinate
            radius (int): Pixel radius to check.
            threshold (int): Threshold value for cloud probability.

        Returns:
            bool: True if clouds cover the middle pixel or neighboring pixels, otherwise False.
        """
        img = cv2.imread(str(input_file), 0)
        region = img[
            y - radius : y + radius,
            x - radius : x + radius,
        ]
        # Check whether a pixel is above the threshold value
        cloud_present = np.any(region >= threshold)

        return cloud_present
