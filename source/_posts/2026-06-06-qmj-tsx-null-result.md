---
layout: post
title: "When a Famous Anomaly Refuses to Travel: QMJ on TSX Small-Caps"
date: 2026-06-06
tags: [quant, factor-investing, replication, canadian-equities]
---

The Quality Minus Junk (QMJ) factor of Asness, Frazzini, and Pedersen
(2019) is one of the better-documented anomalies of the past decade:
high-quality firms — profitable, growing, safe, well-managed — earn
persistently higher risk-adjusted returns than low-quality firms across
24 developed markets. AQR even publishes the monthly QMJ-Canada series
on its [datasets page](https://www.aqr.com/Insights/Datasets), so the
headline is independently verifiable by anyone with a spreadsheet.

What AQR does *not* publish is the underlying long-short on TSX
small-caps. That universe is where I wanted to deploy the strategy —
and the fundamentals AQR uses (gross profitability, accruals, leverage,
payout ratios) are not free at the coverage or point-in-time fidelity
the construction requires.

So I asked a narrower question: **can a price-derived proxy recover the
QMJ premium on TSX small-caps?** This post is the headline answer.
Spoiler: no, and the *way* it fails turns out to be more interesting
than a clean replication would have been.

## Step 1: replicate what we *can* replicate

Before extending anything, the replication gate. Using the public AQR
QMJ-Canada series (1989-07 to 2026-03, 441 monthly observations):

| Statistic                          | Value      |
| ---------------------------------- | ---------- |
| Annualised excess return           | 8.6%       |
| Annualised volatility              | 13.4%      |
| Sharpe                             | 0.64       |
| Max drawdown                       | −37.0%     |
| Carhart-CAN 4-factor monthly α     | 0.70% (*t* = 4.46) |
| → annualised α                     | ≈ 8.8%     |

The Sharpe falls within 0.30 of the 0.65 reported in AFP 2019 Table II
for Canada — comfortably inside my pre-registered tolerance. As an
external cross-check, regressing the same series on Ken French's
Developed FF5 + momentum panel keeps α positive and significant
(0.52%/month, *t* = 3.00) and produces the predicted loading on the
profitability factor RMW (β = +0.61, *t* = 4.16). The construct is
intact. The published premium is real. Replication gate passed.

## Step 2: the extension that doesn't work

To deploy on TSX small-caps without fundamentals, I built **paper-Q** —
a fundamentals-free quality proxy from five price- and return-derived
components, sign-aligned to AFP's Safety leg:

1. idiosyncratic volatility,
2. market beta,
3. maximum drawdown,
4. rolling Sharpe,
5. downside semi-deviation.

Cross-sectionally z-scored, equal-weight composited, value-weighted
tercile long-short, monthly rebalance. 109-ticker hand-curated TSX
small/mid-cap universe. Sample 2011-12 to 2025-11 (168 months).

Headline:

| Statistic                                   | Value   |
| ------------------------------------------- | ------- |
| Annualised gross return (VW)                | +1.0%   |
| Annualised volatility                       | 30.6%   |
| Sharpe (VW)                                 | 0.03    |
| Sharpe (EW)                                 | −0.33   |
| Avg. monthly leg turnover                   | 7.4%    |

The key diagnostic — does paper-Q capture the same construct as
AQR QMJ? — is also clean and disappointing. Regressing paper-Q on
QMJ-CAN gives β = −0.08 (*t* = −0.38), R² ≈ 0, contemporaneous
correlation **−0.03**. My pre-registered calibration gate (Spearman
ρ ≥ 0.3) is not met. A Carhart-CAN regression of paper-Q itself
produces an insignificant α (*t* = 0.26).

The price-derived proxy, in this universe, is essentially
uncorrelated with fundamentals-based Quality. Falsification.

## Why the null is the result

A null that you *pre-registered against* is a different object from
a null you stumbled into. I committed in advance to a tolerance band
on the replication Sharpe and a calibration floor on the
paper-Q-vs-QMJ-CAN correlation. The replication passed; the
extension failed. That is publishable evidence about the limits of
fundamentals-free proxies in resource-heavy small-cap universes,
not a strategy I'm now going to fish for.

There are at least three plausible mechanisms behind the failure:

1. **Sectoral contamination.** Junior energy and mining names
   dominate the TSX small-cap universe. The "low-volatility" leg
   of any price-based Safety proxy ends up holding defensives whose
   risk is structurally distinct from operational Quality.
2. **Accounting inputs that don't have price analogues.** Accruals
   and payout ratios depend on balance-sheet flows whose price
   proxies are dominated by sector exposure.
3. **Survivorship in the free data.** yfinance only shows me names
   that still trade — likely biasing toward winners and blunting any
   defensive premium. (Separate post coming on this.)

## What's actually interesting

The full-sample null masks a clean **regime break** around COVID:

| Period                  | Annualised return | Net Sharpe |
| ----------------------- | ----------------: | ---------: |
| 2011-12 → 2020-02       | +14.3%            | +0.47      |
| 2020-03 → 2025-11       | −18.1%            | −0.60      |

That flip is what the next two posts in this series are about. A
sector-exclusion cut (dropping Energy + Materials) only recovers
about a third of the post-COVID damage — so this is not purely a
resource-sector story. A per-component decomposition shows that
four of the five paper-Q components are essentially the same
low-volatility signal in different statistical clothing, and they
all turned over together. That's the real finding hiding inside the
composite, and it is what I think generalises beyond this paper.

---

*Paper, code, and reproducible pipeline:
[github.com/faketut/qmj-tsx](https://github.com/faketut/qmj-tsx).
`make all` regenerates every number above in under a minute on a
modern laptop.*
