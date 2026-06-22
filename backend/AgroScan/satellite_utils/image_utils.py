import math
from pathlib import Path
from typing import Tuple

import cv2
import numpy as np
from osgeo import gdal, osr


class ImageUtils:
    """
    Various methods for loading and altering image data
    """

    @staticmethod
    def _is_jp2(path: str) -> bool:
        return str(path).lower().endswith(".jp2")

    @staticmethod
    def _read_band_array(source: str) -> np.ndarray:
        gdal.UseExceptions()
        dataset = gdal.Open(source)
        if dataset is None:
            raise OSError(f"Could not load image file: {source}")
        band = dataset.GetRasterBand(1)
        array = band.ReadAsArray()
        if array is None:
            raise OSError(f"Could not read raster data from: {source}")
        return array

    @staticmethod
    def _write_raster(target: str, array: np.ndarray) -> None:
        gdal.UseExceptions()
        target_path = Path(target)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        driver_name = "GTiff"
        driver = gdal.GetDriverByName(driver_name)
        if driver is None:
            raise OSError(f"GDAL driver '{driver_name}' is not available")

        if array.ndim == 2:
            height, width = array.shape
            bands = 1
        else:
            height, width, bands = array.shape

        dtype = gdal.GDT_UInt16 if array.dtype == np.uint16 else gdal.GDT_Byte
        dataset = driver.Create(str(target_path), width, height, bands, dtype)
        if dataset is None:
            raise OSError(f"Could not create output raster: {target}")

        if bands == 1:
            dataset.GetRasterBand(1).WriteArray(array)
        else:
            for index in range(bands):
                dataset.GetRasterBand(index + 1).WriteArray(array[:, :, index])
        dataset.FlushCache()

    @staticmethod
    def location_to_pixel(
        image: str, latitude: float, longitude: float
    ) -> tuple[int, int]:
        """
        Calculates the pixel coordinates inside the given image from GPS coordinates

        Parameters:
            image (str): Path of the image
            latitude (float): GPS latitude
            longitude (float): GPS longitude

        Returns:
            tuple[int, int]: The pixel x and y coordinates in the image
        """
        gdal.UseExceptions()
        dataset = gdal.Open(image)
        if not dataset:
            raise Exception("Could not load image file!")

        transform = dataset.GetGeoTransform()
        projection = dataset.GetProjection()

        source = osr.SpatialReference()
        source.ImportFromWkt(projection)
        target = osr.SpatialReference()
        target.ImportFromEPSG(4326)  # code for WGS84 (latitude and longitude)

        coordinate_transform = osr.CoordinateTransformation(target, source)
        x, y, _ = coordinate_transform.TransformPoint(latitude, longitude)
        pixel_x = int((x - transform[0]) / transform[1])
        pixel_y = int((y - transform[3]) / transform[5])

        return pixel_x, pixel_y

    @staticmethod
    def crop(source: str, target: str, x: int, y: int, width: int, height: int) -> None:
        """
        Crops a image to the given size

        Parameters:
            source (str): Path of the source image
            target (str): Path to save the cropped image
            x (int): Start of the cut (X)
            y (int): Start of the cut (Y)
            width (int): Cropped width
            height (int): Cropped height
        """
        if ImageUtils._is_jp2(source) or str(target).lower().endswith(".tif"):
            gdal.UseExceptions()
            src = gdal.Open(source)
            if src is None:
                raise OSError(f"Could not open {source}")
            Path(target).parent.mkdir(parents=True, exist_ok=True)
            gdal.Translate(
                target,
                src,
                srcWin=[x, y, width, height],
                format="GTiff",
            )
            return

        img = cv2.imread(source)
        cropped = img[y : y + height, x : x + width]
        cv2.imwrite(target, cropped)

    @staticmethod
    def crop_center(source: str, target: str, x: int, y: int, radius: int) -> None:
        """
        Crops the image to a given radius around a center point (in pixels).
        The given point is in the exact center of the cropped image.
        If the given point is too close to the image border, the missing pixels are filled black.

        Parameters:
            source (str): Path of the source image
            target (str): Path to save the cropped image
            x (int): Center point (X)
            y (int): Center point (Y)
            radius (int): Radius (determines the image size -> 2 x radius + 1)
        """
        if ImageUtils._is_jp2(source) or str(target).lower().endswith(".tif"):
            if not str(target).lower().endswith(".tif"):
                target = str(Path(target).with_suffix(".tif"))

            gdal.UseExceptions()
            src = gdal.Open(source)
            if src is None:
                raise OSError(f"Could not open {source}")

            size = 2 * radius + 1
            width, height = src.RasterXSize, src.RasterYSize
            x_start, x_end = x - radius, x + radius + 1
            y_start, y_end = y - radius, y + radius + 1
            crop_x_start = max(0, x_start)
            crop_x_end = min(width, x_end)
            crop_y_start = max(0, y_start)
            crop_y_end = min(height, y_end)
            if crop_x_end <= crop_x_start or crop_y_end <= crop_y_start:
                raise OSError(f"Crop window outside image bounds: {source}")

            patch_ds = gdal.Translate(
                "",
                src,
                format="MEM",
                srcWin=[
                    crop_x_start,
                    crop_y_start,
                    crop_x_end - crop_x_start,
                    crop_y_end - crop_y_start,
                ],
            )
            patch = patch_ds.GetRasterBand(1).ReadAsArray()
            cropped = np.zeros((size, size), dtype=patch.dtype)
            dest_x = max(0, -x_start)
            dest_y = max(0, -y_start)
            cropped[
                dest_y : dest_y + patch.shape[0],
                dest_x : dest_x + patch.shape[1],
            ] = patch

            Path(target).parent.mkdir(parents=True, exist_ok=True)
            mem_drv = gdal.GetDriverByName("MEM")
            out_mem = mem_drv.Create("", size, size, 1, patch_ds.GetRasterBand(1).DataType)
            out_mem.GetRasterBand(1).WriteArray(cropped)
            gtiff_drv = gdal.GetDriverByName("GTiff")
            if gtiff_drv is None:
                raise OSError("GTiff driver is not available")
            result = gtiff_drv.CreateCopy(str(target), out_mem, strict=False)
            if result is None:
                raise OSError(f"Could not write cropped raster: {target}")
            result.FlushCache()
            return

        img = cv2.imread(source)
        size = 2 * radius + 1
        height, width = img.shape[:2]

        # fill result matrix with black
        cropped = np.zeros((size, size, img.shape[2]), dtype=np.uint8)

        # get corner coordinates of the cropping region
        x_start, x_end = x - radius, x + radius + 1
        y_start, y_end = y - radius, y + radius + 1

        # make sure the cropping corners are not outside of the image
        crop_x_start = max(0, x_start)
        crop_x_end = min(width, x_end)
        crop_y_start = max(0, y_start)
        crop_y_end = min(height, y_end)

        # crop pixels out of the original image
        crop = img[crop_y_start:crop_y_end, crop_x_start:crop_x_end]

        # move the cropping coordinates to the right place of the result matrix
        # this makes sure the center pixel is always in the center
        x_start = max(0, -x_start)
        y_start = max(0, -y_start)

        # copy the cropped pixels to the right place in the result matrix
        cropped[
            y_start : y_start + crop.shape[0],
            x_start : x_start + crop.shape[1],
        ] = crop

        cv2.imwrite(target, cropped)

    @classmethod
    def crop_location(
        cls, source: str, target: str, latitude: float, longitude: float, radius: int
    ) -> None:
        """
        Crops the image to a given radius around a center point (GPS location).
        The given point is in the exact center of the cropped image.

        Parameters:
            source (str): Path of the source image
            target (str): Path to save the cropped image
            latitude (float): GPS latitude of the center point
            longitude (float): GPS longitude of the center point
            radius (int): Radius in pixels (determines the image size -> 2 x radius + 1)
        """
        x, y = cls.location_to_pixel(source, latitude, longitude)
        cls.crop_center(source, target, x, y, radius)

    @staticmethod
    def merge_channels(
        image_blue: str, image_green: str, image_red: str, target: str
    ) -> None:
        """
        Generates and saves a true color (RGB) image from three
        separate grayscale images representing red, green and blue channels.

        Parameters:
            image_blue (str): Path of the image representing the blue channel
            image_green (str): Path of the image representing the green channel
            image_red (str): Path of the image representing the red channel
            target (str): Path to save the resulting RGB image
        """
        blue = cv2.imread(image_blue, 0)
        green = cv2.imread(image_green, 0)
        red = cv2.imread(image_red, 0)
        merged = cv2.merge((blue, green, red)) * 3
        cv2.imwrite(target, merged)

    @staticmethod
    def get_pixel_value(
        image: str, x: int, y: int, shape: Tuple[int, int] = (1, 1)
    ) -> int | list:
        """
        Returns the value of the given pixel of a grayscale image.

        Parameters:
            image (str): Path of the image
            x (int): Pixel x-coordinate
            y (int): Pixel y-coordinate
            shape ((int, int), optional): Shape of the resulting matrix (default: single value)

        Returns:
            int | list: Grayscale integer value of a single pixel or a value matrix (depends on shape)
        """
        if ImageUtils._is_jp2(image) or str(image).lower().endswith(".tif"):
            img = ImageUtils._read_band_array(image)
        else:
            img = cv2.imread(image, 0)

        if not shape or shape == (1, 1):
            # return single pixel value
            return img[y, x]

        # cut pixels in the right shape (ceil and floor to allow even shapes, e.g. 2x2)
        radius = [
            math.floor((shape[0] - 1) / 2),
            math.ceil((shape[0] - 1) / 2),
            math.floor((shape[1] - 1) / 2),
            math.ceil((shape[1] - 1) / 2),
        ]
        return img[
            y - radius[2] : y + radius[3] + 1,
            x - radius[0] : x + radius[1] + 1,
        ]
