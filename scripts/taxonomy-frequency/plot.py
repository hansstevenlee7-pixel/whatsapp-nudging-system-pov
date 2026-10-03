"""Publication-friendly descriptive figures for the versioned synthetic study."""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/private/tmp/taxonomy-frequency-matplotlib")
os.environ.setdefault("XDG_CACHE_HOME", "/private/tmp/taxonomy-frequency-cache")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def main():
    root = Path(sys.argv[1]).resolve()
    result = json.loads((root / "results.json").read_text())
    ablation = json.loads((root / "taxonomy_ablation.json").read_text())
    rows = result["per_seed"]
    policies = ["greedy_logistic", "contextual_thompson", "eligible_random"]
    colors = ["#2563a6", "#bf5b17", "#777777"]
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False, "svg.fonttype": "none"})
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.7), layout="constrained")
    for index, policy in enumerate(policies):
        values = [100 * row["interactions_per_message"] for row in rows if row["policy"] == policy]
        jitter = np.linspace(-.11, .11, len(values))
        axes[0].scatter(index + jitter, values, color=colors[index], s=26, alpha=.75)
        axes[0].plot([index - .18, index + .18], [np.mean(values)] * 2, color=colors[index], lw=3)
    axes[0].set_xticks(range(3), ["Logistic", "Bandit", "Random"])
    axes[0].set_ylabel("Interactions per 100 messages")
    axes[0].set_ylim(bottom=0)
    axes[0].set_title("A. Policy efficiency · 10 seeds", loc="left", fontweight="bold", fontsize=11)
    for index, policy in enumerate(policies):
        subset = [row for row in rows if row["policy"] == policy]
        axes[1].bar(index - .14, np.mean([r["delivered_messages"] for r in subset]), .28,
                    color=colors[index], alpha=.8)
        axes[1].bar(index + .14, np.mean([r["ordinary_interactions"] for r in subset]), .28,
                    color=colors[index], alpha=.35)
    axes[1].set_xticks(range(3), ["Logistic", "Bandit", "Random"])
    axes[1].set_ylabel("Mean count per 30-user cohort")
    axes[1].set_title("B. Message burden and interactions", loc="left", fontweight="bold", fontsize=11)
    axes[1].legend(["Messages (solid)", "Interactions (light)"], frameon=False, fontsize=8)
    for index, split in enumerate(["validation", "test"]):
        a = ablation["across_seeds"][split]
        axes[2].bar(index - .16, a["frequency_only_pr_auc"], .30, color="#777777", label="Frequency features" if index == 0 else None)
        axes[2].bar(index + .16, a["full_pr_auc"], .30, color="#148074", label="+ taxonomy context" if index == 0 else None)
    axes[2].set_xticks([0, 1], ["Validation", "Held-out test"])
    axes[2].set_ylim(0, max(a["full_pr_auc"] for a in ablation["across_seeds"].values()) + .15)
    axes[2].set_ylabel("Mean PR-AUC across seeds")
    axes[2].set_title("C. Taxonomy prediction ablation", loc="left", fontweight="bold", fontsize=11)
    axes[2].legend(frameon=False, fontsize=8)
    for ax in axes:
        ax.grid(axis="y", alpha=.15)
    fig.suptitle("Synthetic taxonomy-grounded frequency experiment · v2\nOnly local policies complete; Gemini comparison pending",
                 fontsize=14, fontweight="bold")
    for suffix in ("png", "svg", "pdf"):
        fig.savefig(root / f"taxonomy_frequency_v2.{suffix}", dpi=180, facecolor="white")
    plt.close(fig)
    (root / "plot-environment.json").write_text(json.dumps({"python": sys.version,
                                                             "matplotlib": matplotlib.__version__,
                                                             "numpy": np.__version__}, indent=2) + "\n")


if __name__ == "__main__":
    main()
