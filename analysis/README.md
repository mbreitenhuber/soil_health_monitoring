**Purpose:** This folder houses the geospatial processing pipeline.

    `/processors`: Logic for converting raw satellite bands into soil health metrics.

    `/utils`: Helper functions for coordinate systems (CRS), cloud masking, and data cleaning.

    `/models`: Trained models or heuristic algorithms for nutrient and salinity prediction.

**Standard:** All new processors must include unit tests in the root `/tests` folder.