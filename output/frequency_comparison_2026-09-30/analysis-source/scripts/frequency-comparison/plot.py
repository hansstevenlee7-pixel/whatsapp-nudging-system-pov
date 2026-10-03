"""Export research figures from completed seed runs; never plot unfinished seeds as final."""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/private/tmp/frequency-comparison-matplotlib")
os.environ.setdefault("XDG_CACHE_HOME", "/private/tmp/frequency-comparison-cache")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def main():
    out = Path(sys.argv[1]).resolve()
    report = json.loads((out / "results.json").read_text())
    rows = [r for r in report["per_seed"] if r["complete"]]
    policies = ["logistic_regression", "contextual_thompson", "gemini"]
    names = {"logistic_regression": "Logistic regression", "contextual_thompson": "Contextual bandit", "gemini": "Gemini"}
    colors = {"logistic_regression": "#2563a6", "contextual_thompson": "#bf5b17", "gemini": "#148074"}
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False,
                         "axes.spines.right": False, "svg.fonttype": "none"})
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.8), layout="constrained")
    for position, policy in enumerate(policies):
        values = [100 * r["interactions_per_message"] for r in rows if r["policy"] == policy]
        if not values:
            axes[0].text(position, 2, "Incomplete", ha="center", color="#666666")
            continue
        jitter = np.linspace(-0.1, 0.1, len(values))
        axes[0].scatter(position + jitter, values, color=colors[policy], alpha=0.75, s=27)
        axes[0].plot([position - .18, position + .18], [np.mean(values)] * 2, color=colors[policy], lw=3)
    counts = {p: len([r for r in rows if r["policy"] == p]) for p in policies}
    axes[0].set_xticks(range(3), [f"{label}\n(n={counts[p]} seeds)" for p, label in zip(policies, ["LR", "Bandit", "Gemini"])])
    axes[0].set_ylabel("Ordinary interactions / delivered messages (%)")
    axes[0].set_title("A. Seed-level interaction efficiency", loc="left", fontweight="bold", fontsize=11)
    axes[0].set_ylim(bottom=0)
    for index, policy in enumerate(policies[1:]):
        contrast = report["paired_contrasts"].get(policy + "_minus_lr")
        if not contrast:
            axes[1].text(0, index, "No completed paired result", va="center", fontsize=9)
            continue
        metric = contrast["interactions_per_message"]
        point = 100 * metric["mean"]
        if metric["ci95"]:
            lower, upper = np.array(metric["ci95"]) * 100
            axes[1].errorbar(point, index, xerr=[[point - lower], [upper - point]], fmt="o", capsize=5,
                             color=colors[policy], lw=2)
        else:
            axes[1].scatter(point, index, color=colors[policy])
    axes[1].axvline(0, color="#777777", ls="--", lw=1)
    axes[1].set_yticks([0, 1], [f"Bandit − LR\n(n={counts[policies[1]]})", f"Gemini − LR\n(n={counts[policies[2]]})"])
    axes[1].set_ylim(1.6, -.6)
    axes[1].set_xlabel("Difference (percentage points)\n95% paired seed-bootstrap interval")
    axes[1].set_title("B. Paired differences", loc="left", fontweight="bold", fontsize=11)
    for policy in policies:
        subset = [r for r in rows if r["policy"] == policy]
        if not subset:
            continue
        means = [100 * np.mean([next(w for w in r["weeks"] if w["week"] == week)["interactions_per_message"]
                                for r in subset]) for week in range(9, 13)]
        axes[2].plot(range(9, 13), means, marker="o", color=colors[policy],
                     linestyle="--" if len(subset) < 10 else "-", label=f"{names[policy]} (n={len(subset)})")
    axes[2].set_xticks(range(9, 13))
    axes[2].set_xlabel("Evaluation week")
    axes[2].set_ylabel("Mean interaction rate across completed seeds (%)")
    axes[2].set_title("C. Four-week policy trajectories", loc="left", fontweight="bold", fontsize=11)
    axes[2].legend(frameon=False, fontsize=8)
    for ax in axes:
        ax.grid(axis="y", alpha=.15)
    status = "10 seeds · 30 held-out users per seed" if report["complete"] else "INCOMPLETE: completed seeds only; no full three-method conclusion"
    fig.suptitle("Synthetic frequency-policy comparison\n" + status, fontsize=14, fontweight="bold")
    for suffix in ["png", "svg", "pdf"]:
        fig.savefig(out / f"frequency_comparison.{suffix}", dpi=180, facecolor="white")
    plt.close(fig)
    (out / "plot-environment.json").write_text(json.dumps({"python": sys.version, "matplotlib": matplotlib.__version__,
                                                          "numpy": np.__version__}, indent=2) + "\n")


if __name__ == "__main__":
    main()
