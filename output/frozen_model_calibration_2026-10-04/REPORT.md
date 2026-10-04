# Frozen model calibration and uncertainty (4 October 2026)

Post hoc descriptive analysis of `landing/api/_models/frequency-logistic-v1.json` (read, not refitted). Declared method: see the header of `scripts/frozen-model-calibration/run.js`. Stored Brier scores are reproduced exactly before anything else is computed.

Model SHA-256 `971e347d95f2d2eaf207db7d0d9978defe97df871eeb94068903eb989321aaa2`; dataset SHA-256 `b332923d43e528836c39259fbc35f99485601c60d5db33eddb0d9b3348f3a523`; constant comparator = training prevalence 0.1970.

| Split | Rows (positives) | Model Brier [95% CI] | Constant Brier [95% CI] | Difference [95% CI] | Skill [95% CI] | Resamples with model better |
|---|---|---|---|---|---|---|
| validation | 118 (19) | 0.113 [0.070 to 0.160] | 0.136 [0.089 to 0.198] | 0.024 [-0.009 to 0.073] | 0.173 [-0.071 to 0.426] | 87.4% |
| test | 109 (24) | 0.137 [0.089 to 0.188] | 0.172 [0.116 to 0.235] | 0.035 [0.012 to 0.067] | 0.204 [0.078 to 0.346] | 99.9% |

| Split | Calibration-in-the-large [95% CI] | Calibration intercept | Calibration slope [95% CI] | Prediction range |
|---|---|---|---|---|
| validation | 0.012 [-0.040 to 0.056] | 0.05 | 1.11 [0.18 to 1.89] | 0.071 to 0.635 |
| test | -0.023 [-0.090 to 0.036] | 0.42 | 1.21 [0.76 to 1.79] | 0.071 to 0.635 |

## Reliability, validation (five equal-count bins)

| Bin | Rows | Positives | Mean predicted | Observed rate | Wilson 95% |
|---|---|---|---|---|---|
| 1 | 24 | 2 | 0.071 | 0.083 | 0.023 to 0.258 |
| 2 | 23 | 1 | 0.087 | 0.043 | 0.008 to 0.210 |
| 3 | 24 | 3 | 0.111 | 0.125 | 0.043 to 0.310 |
| 4 | 23 | 4 | 0.191 | 0.174 | 0.070 to 0.371 |
| 5 | 24 | 9 | 0.403 | 0.375 | 0.212 to 0.573 |

## Reliability, test (five equal-count bins)

| Bin | Rows | Positives | Mean predicted | Observed rate | Wilson 95% |
|---|---|---|---|---|---|
| 1 | 22 | 2 | 0.071 | 0.091 | 0.025 to 0.278 |
| 2 | 22 | 3 | 0.098 | 0.136 | 0.047 to 0.333 |
| 3 | 21 | 2 | 0.133 | 0.095 | 0.027 to 0.289 |
| 4 | 22 | 4 | 0.213 | 0.182 | 0.073 to 0.385 |
| 5 | 22 | 13 | 0.467 | 0.591 | 0.387 to 0.767 |

Bootstrap: whole synthetic profiles resampled with replacement (30 per split), 10000 resamples, seed 5128; resamples with no positive or no negative row are skipped and counted in results.json. With about 20 positives per split, the bin-level rates and the slope are imprecise; they describe this sample and are not a calibration claim across probability ranges.
