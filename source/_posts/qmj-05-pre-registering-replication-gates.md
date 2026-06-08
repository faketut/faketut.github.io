---
layout: post
title: "Pre-Registering Replication Gates for a Solo Quant Project"
date: 2026-07-04
tags: [reproducibility, pre-registration, statistics, research-process, quant]
---

The QMJ-TSX paper has two findings: a successful replication of the
AQR QMJ-Canada series, and an *un*successful extension to a
price-based proxy on TSX small-caps. The reason I'm comfortable
publishing the negative result is that I wrote down the bar for
"success" *before* I ran the test.

This is what people mean by pre-registration. In medicine and
psychology it is a formal mechanism; in solo quant work it is
usually just a habit, and a rare one. This post is the case for
adopting it even when nobody is forcing you to.

## The two gates

I committed to two numerical gates in writing before the analysis:

**Gate 1 — Replication tolerance.** The Sharpe ratio of my
recomputed AQR QMJ-Canada series, over the comparable sample, must
fall within ±0.30 of the 0.65 figure reported in AFP (2019) Table II
for Canada.

> Outcome: replicated Sharpe = 0.64. Within tolerance. **Pass.**

**Gate 2 — Calibration of the extension.** The Spearman rank
correlation between my fundamentals-free paper-Q long-short and the
AQR QMJ-Canada series, over the common sample, must be ≥ 0.3 for me
to claim paper-Q "captures the same construct."

> Outcome: contemporaneous correlation = −0.03, regression β = −0.08
> (*t* = −0.38), R² ≈ 0. **Fail.**

These are not p-values. They are pre-committed numerical bands on
the actual quantities the paper is making claims about. Setting them
in advance is the whole point.

## Why this matters more for a solo project, not less

The standard argument for pre-registration is to defend against
researcher degrees of freedom — the small choices (sample window,
weighting, winsorisation, sector exclusions) that, taken together,
let you nudge a borderline result into significance. In a *team*
setting there is at least social friction against this. In a solo
setting there is none. You can rerun any cell any number of times,
and the only person who would notice is you.

A pre-registered gate creates artificial friction. Once it is
written down, moving it requires you to *consciously* admit you are
moving it. That is a low bar, but it turns out to be a meaningful
one.

## The asymmetry that makes nulls publishable

There is a respectable version of "my strategy didn't work" and a
disrespectable one. The disrespectable version reads:

> I tried a bunch of variants. None of them were significant. I'm
> calling that a negative result.

The respectable version reads:

> I committed in advance to the following falsifiable test.
> The test failed in this specific way. Here is what we learn from
> the failure.

Only the second version contains information. The first is
indistinguishable from a strategy that almost worked, dressed up as
humility.

For the paper-Q work, gate 2 is what makes the null *informative*.
The pre-committed claim — "if a price-based proxy captures the same
underlying Quality construct, rank correlation with the
fundamentals-based version should be at least 0.3" — is the
thing being tested. The observed correlation of −0.03 is not "small
and inconclusive." It is "comprehensively below the bar I set." That
is publishable evidence about the limits of fundamentals-free
proxies, not a strategy I am still fishing for.

## How to actually do it, lightly

Solo pre-registration does not require ritual. A few things that
worked for me:

1. **Write the gates into the project plan, not just into your
   head.** I keep them in `memories/session/plan.md` with timestamps.
   Anything not in writing didn't happen.
2. **Make the gates numerical.** "Reasonable replication" is not a
   gate; "Sharpe within ±0.30 of the published number" is.
3. **State the consequence in advance.** "If gate 2 fails, the
   paper's claim shifts from 'paper-Q recovers QMJ' to 'paper-Q
   fails to recover QMJ, and here is the per-component
   decomposition that tells us why.'" The fallback analysis is part
   of the pre-registration, not a post-hoc rescue.
4. **Don't tune the gate to the data.** The temptation is real. If
   the observed Spearman is 0.18 and your gate was 0.3, the answer
   is "fail," not "0.15 is fine, actually."
5. **Report the result *against the pre-committed gate*** in the
   paper. Not just the number — the comparison to the bar.

That is the whole methodology. Five sentences in a markdown file
and a discipline about not editing them after the fact.

## A second-order benefit

A pleasant side effect of gate 2 failing is that the
[per-component decomposition](2026-06-13-low-vol-unwind-hiding-in-a-composite.md)
and the [PCA analysis](2026-06-20-pca-as-diagnostic-not-rescue.md)
became the most interesting parts of the paper. If the gate had
passed I would have written a competent replication-plus-extension
paper that nobody would have cared about. Because it failed, I was
forced to ask *why* it failed — and the answer ("a one-factor
post-COVID low-vol unwind that the composite was masking") is the
generalisable finding.

Pre-registration didn't just protect me from a soft positive
result. It pointed me at the real one.

---

*Paper, gates, and the full results table:
[github.com/faketut/qmj-tsx](https://github.com/faketut/qmj-tsx).*
