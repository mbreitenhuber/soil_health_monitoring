import pandas as pd
import geopandas as gpd
import matplotlib.pyplot as plt
from shapely.geometry import Point

# -------------------------------------------------------------------
# 1. Read Excel file
# -------------------------------------------------------------------

# Replace with your Excel file path
excel_file = "/Users/clarabuller/PycharmProjects/Nebula/Visualization/LUCAS_SOIL_processed_DE.xls"

# Read the Excel file
df = pd.read_excel(excel_file)

# Keep only latitude and longitude columns
df = df[["TH_LAT", "TH_LONG"]].dropna()

# -------------------------------------------------------------------
# 2. Create GeoDataFrame from coordinates
# -------------------------------------------------------------------

geometry = [
    Point(xy) for xy in zip(df["TH_LONG"], df["TH_LAT"])
]

gdf = gpd.GeoDataFrame(
    df,
    geometry=geometry,
    crs="EPSG:4326"  # WGS84 coordinate system
)

# -------------------------------------------------------------------
# 3. Load Germany boundary map
# -------------------------------------------------------------------

url = (
    "https://naturalearth.s3.amazonaws.com/"
    "110m_cultural/ne_110m_admin_0_countries.zip"
)

world = gpd.read_file(url)

germany = world[world["ADMIN"] == "Germany"]

# -------------------------------------------------------------------
# 4. Load German federal states boundaries
# -------------------------------------------------------------------

states_url = (
    "https://raw.githubusercontent.com/"
    "isellsoap/deutschlandGeoJSON/master/2_bundeslaender/1_sehr_hoch.geo.json"
)

states = gpd.read_file(states_url)

# -------------------------------------------------------------------
# 4. Plot map and points
# -------------------------------------------------------------------

fig, ax = plt.subplots(figsize=(10, 12))

# Plot Germany map
germany.plot(
    ax=ax,
    color="whitesmoke",
    edgecolor="black"
)

# Federal state outlines
states.boundary.plot(
    ax=ax,
    color="black",
    linewidth=0.7
)

# Plot coordinate points
gdf.plot(
    ax=ax,
    color="red",
    markersize=20,
    alpha=0.7
)

# Formatting
ax.set_title("Agricultural field sample locations from LUCAS dataset", fontsize=16)
ax.set_xlabel("Longitude")
ax.set_ylabel("Latitude")

plt.tight_layout()
plt.show()