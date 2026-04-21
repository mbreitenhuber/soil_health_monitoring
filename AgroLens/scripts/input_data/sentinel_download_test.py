import requests
import json

# 1. Configuration & Credentials
username = "margarete.breitenhuber@gmx.de"
password = "Nebula26+AI4Good"
# GPS Coordinates (Longitude, Latitude)
lon, lat = 12.4964, 41.9028  # Example: Rome, Italy

# 2. Get OAuth2 Token
auth_server = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
data = {
    "client_id": "cdse-public",
    "username": username,
    "password": password,
    "grant_type": "password",
}

token_res = requests.post(auth_server, data=data)
access_token = token_res.json()["access_token"]
headers = {"Authorization": f"Bearer {access_token}"}

# 3. Query for products at your GPS location
# We use Intersects(area=geography'SRID=4326;POINT(lon lat)')
search_url = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
filter_query = (
    f"OData.CSC.Intersects(area=geography'SRID=4326;POINT({lon} {lat})') "
    "and Collection/Name eq 'SENTINEL-2' "
    "and ContentDate/Start gt 2024-01-01T00:00:00.000Z"
)

response = requests.get(
    search_url,
    headers=headers,
    params={
        "$filter": filter_query,
        "$top": 1,
    },
)
response.raise_for_status()
payload = response.json()

if "value" not in payload or not payload["value"]:
    raise RuntimeError(f"No products returned from catalogue query: {payload}")

product = payload["value"][0]
product_id = product['Id']
product_name = product['Name']

print(f"Found product: {product_name} (ID: {product_id})")

# 4. Download the product
download_url = f"https://zipper.dataspace.copernicus.eu/odata/v1/Products({product_id})/$value"

with requests.get(download_url, headers=headers, stream=True) as r:
    r.raise_for_status()
    with open(f"{product_name}.zip", 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)

print("Download complete!")