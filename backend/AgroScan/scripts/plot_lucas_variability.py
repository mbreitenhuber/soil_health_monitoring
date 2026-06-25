import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

# Use website data font if available ('JetBrains Mono'), with sensible fallbacks
plt.rcParams['font.family'] = 'monospace'
plt.rcParams['font.monospace'] = ['JetBrains Mono', 'DejaVu Sans Mono', 'Courier New', 'monospace']

# Read the Excel file
file_path = Path(__file__).parent.parent.parent / "data" / "datasets" / "LUCAS_variability_DE.xlsx"
df = pd.read_excel(file_path, sheet_name="Sheet1")

# Extract data from columns
oc_values = df.iloc[:, 1]  # Column B (0-indexed: column 1)
mean_value = df.iloc[0, 2]  # Column C, first row (0-indexed: column 2)
std_lower = df.iloc[0, 4]   # Column E, first row (0-indexed: column 4)
std_upper = df.iloc[0, 5]   # Column F, first row (0-indexed: column 5)

# Create histogram with 2g/kg intervals
fig, ax = plt.subplots(figsize=(12, 6))

# Calculate bin edges (2g/kg intervals)
min_val = oc_values.min()
max_val = oc_values.max()
bins = np.arange(np.floor(min_val), np.ceil(max_val) + 2, 2)

# Add std deviation area (shaded region) first so it appears in background
# light green shaded area
ax.axvspan(std_lower, std_upper, alpha=0.4, color='#b7e4c7', label='Std Deviation Range', zorder=0)
#ax.axvspan(std_lower, std_upper, alpha=0.25, color='#8B4513', label='Std Deviation Range', zorder=0)

# Plot histogram (light grey columns matching website) with subtle outline matching site borders
# fill: surface color (#F0F1F2), outline: border color (#D4D8DC)
ax.hist(oc_values, bins=bins, alpha=0.95, color="#969696", edgecolor="#505050", linewidth=0.8, zorder=2)

# Add mean line (brown)
ax.axvline(mean_value, color='#8B4513', linestyle='-', linewidth=2, label=f'Mean: {mean_value:.2f}', zorder=3)

# Labels and formatting
ax.set_xlabel('OC (g/kg)', fontsize=12)
ax.set_ylabel('Frequency', fontsize=12)
ax.set_title('LUCAS Soil OC Variability Distribution (Germany)', fontsize=14, fontweight='bold')
ax.legend(loc='upper right')
ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.4, zorder=0)
ax.minorticks_on()
ax.grid(True, which='minor', alpha=0.2, linestyle='--', linewidth=0.4, zorder=0)

# Save the figure
output_dir = Path(__file__).parent.parent.parent / "data" / "datasets" / "LUCAS_variability_DE_plot"
output_dir.mkdir(parents=True, exist_ok=True)
output_path = output_dir / "LUCAS_variability_DE_histogram.png"
fig.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"Plot saved to: {output_path}")

plt.show()
