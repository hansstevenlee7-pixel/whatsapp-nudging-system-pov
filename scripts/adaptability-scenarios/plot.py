"""Weekly mean frequency vs hidden preference, by profile group (Part A).

Reads weekly.csv from an adaptability-scenarios output folder and writes
adaptability_trajectories.{png,pdf} beside it. Presentation only; no metric is
computed here.

    python3 scripts/adaptability-scenarios/plot.py output/adaptability_scenarios_2026-10-02
"""
import csv
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "output/adaptability_scenarios_2026-10-02")
ARMS = [  # fixed categorical order, validated light-mode slots 1-3; markers are the secondary encoding
    ("deterministic", "Deterministic rules", "#2a78d6", "o"),
    ("model_selector", "Model + selector (replay arm)", "#eb6834", "s"),
    ("model_operative", "Model + deployed policy", "#1baf7a", "^"),
]
GROUPS = [("stable", "Stable preference"), ("shifted_up", "Preference shifts up after week 6"),
          ("shifted_down", "Preference shifts down after week 6")]
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e4e3df"

rows = list(csv.DictReader(open(OUT / "weekly.csv")))
series = {}
for row in rows:
    series.setdefault((row["arm"], row["group"]), []).append((int(row["week"]), float(row["mean_frequency"]), float(row["mean_preference"])))

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
                     "xtick.color": MUTED, "ytick.color": MUTED})
fig, axes = plt.subplots(1, 3, figsize=(10, 3.4), sharey=True)
for axis, (group, title) in zip(axes, GROUPS):
    preference = sorted(series[("oracle", group)])
    axis.plot([w for w, _, _ in preference], [p for _, _, p in preference], color=INK, linewidth=1.5, linestyle="--", zorder=2)
    for arm, label, color, marker in ARMS:
        points = sorted(series[(arm, group)])
        axis.plot([w for w, _, _ in points], [f for _, f, _ in points], color=color, linewidth=2, marker=marker,
                  markersize=4.5, markeredgecolor="white", markeredgewidth=0.8, label=label, zorder=3)
    axis.axvline(6.5, color=MUTED, linewidth=1, linestyle=":", zorder=1)
    axis.set_title(title, fontsize=9.5, color=INK, loc="left")
    axis.set_xticks([1, 3, 5, 7, 9, 11])
    axis.set_xlim(0.6, 12.4)
    axis.set_ylim(0.9, 3.1)
    axis.set_yticks([1, 1.5, 2, 2.5, 3])
    axis.grid(axis="y", color=GRID, linewidth=0.8)
    axis.set_axisbelow(True)
    for side in ("top", "right"):
        axis.spines[side].set_visible(False)
    axis.set_xlabel("Week")
axes[0].set_ylabel("Mean messages per week")
handles, labels = axes[0].get_legend_handles_labels()
handles.insert(0, plt.Line2D([], [], color=INK, linestyle="--", linewidth=1.5))
labels.insert(0, "Hidden preference (oracle)")
fig.legend(handles, labels, loc="upper center", ncol=4, frameon=False, fontsize=8.5, bbox_to_anchor=(0.5, 1.02))
fig.text(0.5, -0.03, "Mean over 10 seeds x 300 synthetic profiles; dotted line marks the preference shift. Simulation assumptions only.",
         ha="center", fontsize=7.5, color=MUTED)
fig.tight_layout(rect=(0, 0, 1, 0.93))
for suffix in ("png", "pdf"):
    fig.savefig(OUT / f"adaptability_trajectories.{suffix}", dpi=200, bbox_inches="tight")
print(f"Wrote {OUT / 'adaptability_trajectories.png'}")
