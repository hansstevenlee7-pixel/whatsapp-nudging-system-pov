"""Reliability diagram for the frozen frequency model (validation and test).

Reads results.json from a frozen-model-calibration output folder and writes
reliability.{png,pdf} beside it. Presentation only; no metric is computed here.

    python3 scripts/frozen-model-calibration/plot.py output/frozen_model_calibration_2026-10-04
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "output/frozen_model_calibration_2026-10-04")
SPLITS = [("validation", "Validation (118 rows, 19 positives)", "#2a78d6", "o"),
          ("test", "Test (109 rows, 24 positives)", "#eb6834", "s")]
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e4e3df"
result = json.load(open(OUT / "results.json"))

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
                     "xtick.color": MUTED, "ytick.color": MUTED})
fig, axes = plt.subplots(1, 2, figsize=(8.6, 3.6), gridspec_kw={"width_ratios": [1.25, 1]})
axis = axes[0]
axis.plot([0, 0.8], [0, 0.8], color=INK, linestyle="--", linewidth=1.2, label="Perfect calibration", zorder=1)
for offset, (name, label, color, marker) in zip((-0.006, 0.006), SPLITS):
    bins = result["splits"][name]["reliability"]
    x = [b["mean_predicted"] + offset for b in bins]
    y = [b["observed_rate"] for b in bins]
    err = [[b["observed_rate"] - b["observed_wilson_95"][0] for b in bins], [b["observed_wilson_95"][1] - b["observed_rate"] for b in bins]]
    axis.errorbar(x, y, yerr=err, color=color, marker=marker, markersize=5, markeredgecolor="white", markeredgewidth=0.8,
                  linewidth=1.6, capsize=2.5, elinewidth=1, label=label, zorder=3)
axis.set_xlim(0, 0.8); axis.set_ylim(0, 0.8)
axis.set_xlabel("Mean predicted probability (five equal-count bins)")
axis.set_ylabel("Observed interaction rate (Wilson 95%)")
axis.set_title("Reliability", fontsize=9.5, color=INK, loc="left")
axis.legend(frameon=False, fontsize=8, loc="upper left")
axis = axes[1]
for name, label, color, _ in SPLITS:
    probabilities = [row["probability"] for row in result["splits"][name]["predictions"]]
    axis.hist(probabilities, bins=[i / 40 for i in range(0, 29)], color=color, alpha=0.55, label=name.capitalize())
axis.set_xlim(0, 0.7)
axis.set_xlabel("Predicted probability")
axis.set_ylabel("Rows")
axis.set_title("Distribution of predictions", fontsize=9.5, color=INK, loc="left")
axis.legend(frameon=False, fontsize=8)
for axis in axes:
    axis.grid(color=GRID, linewidth=0.8); axis.set_axisbelow(True)
    for side in ("top", "right"):
        axis.spines[side].set_visible(False)
fig.text(0.5, -0.03, "Frozen model frequency-logistic-v1, read without refitting. Synthetic data; about 20 positives per split, so intervals are wide.",
         ha="center", fontsize=7.5, color=MUTED)
fig.tight_layout()
for suffix in ("png", "pdf"):
    fig.savefig(OUT / f"reliability.{suffix}", dpi=200, bbox_inches="tight")
print(f"Wrote {OUT / 'reliability.png'}")
