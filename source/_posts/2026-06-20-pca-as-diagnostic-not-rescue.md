---
layout: post
title: "PCA as a Diagnostic, Not a Rescue"
date: 2026-06-20
tags: [quant, pca, signal-design, dimensionality-reduction]
---

This is the third post in the [QMJ-TSX series](README.md). The
[previous post](2026-06-13-low-vol-unwind-hiding-in-a-composite.md)
showed that four of the five components of my paper-Q composite are
mechanically the same low-volatility signal, all flipping sign
post-COVID; the fifth (rolling Sharpe) behaves differently. A natural
follow-up is: just throw PCA at it.

This post is about what that actually does — and what it doesn't do.

## The premise

If your components are near-collinear, equal-weighting them is wrong
both in theory (it understates the effective number of bets) and in
practice (it dilutes whichever component is actually unique). The
disciplined fix is to project the components onto an orthogonal basis
and price each axis separately.

Concretely: stack the five-component panel as a $(\text{date} \times
\text{ticker}) \times 5$ matrix, take the principal components, and
run each PC as its own long-short.

## What PCA finds

| PC  | Variance explained | Interpretation |
| --- | -----------------: | -------------- |
| PC1 | 60%                | Roughly uniform positive loadings across all five components — a clean general-defensive axis. |
| PC2 | 22%                | A contrast between rolling Sharpe (−0.80) and the beta-flavoured direction (+0.53). The momentum-vs-low-vol split that the horse race already surfaced. |

This is the encouraging part. PCA recovers exactly the structure the
per-component decomposition already suggested: one dominant low-vol
factor, plus a second axis that is essentially "rolling Sharpe minus
the rest." The five-dimensional design space is really
two-dimensional, and the two dimensions have economic
interpretations.

## What PCA does not find

Run each PC as a standalone VW tercile long-short, same 10 bps cost
model:

| Signal                    | Full Sharpe | Pre-COVID | Post-COVID |
| ------------------------- | ----------: | --------: | ---------: |
| PC1 (low-vol axis)        | −0.23       | +0.34     | −0.85      |
| PC2 (momentum-vs-low-vol) | −0.11       | −0.14     | −0.08      |
| 2-PC composite (EW)       | −0.16       | —         | —          |
| Unorthogonalised paper-Q  | +0.03       | +0.47     | −0.60      |

Three things to notice.

**One.** **PC1 reproduces the regime flip cleanly.** Pre-COVID +0.34,
post-COVID −0.85. This is the smoking gun for the
[previous post's](2026-06-13-low-vol-unwind-hiding-in-a-composite.md)
claim that the post-pandemic break is a one-factor phenomenon, not
an artefact of equal-weighting correlated proxies. When you collapse
the five proxies onto their dominant common axis, the regime story
becomes *more* visible, not less.

**Two.** **PC2 has no pricing content.** Sharpe is essentially zero in
every subperiod. So the +0.32 full-sample Sharpe of standalone
rolling Sharpe from the horse race was in fact largely riding its
positive correlation with the PC1 low-vol axis. Once that
correlation is purged, the residual rolling-Sharpe-minus-low-vol
contrast does not price on its own in this universe.

**Three.** **Equal-weighting the two PCs underperforms the
unorthogonalised composite.** This is the expected consequence of
(1) and (2): averaging a pricing axis with a non-pricing axis
dilutes signal. The "clean" orthogonal composite is *worse* than the
naive average it was supposed to fix.

## The takeaway

PCA didn't rescue paper-Q. What it did was something more useful
for an honest paper: it collapsed the post-COVID story into a single
dimension. The TSX small/mid-cap low-volatility long-short broke in
2020 and has not recovered. That is a cleaner, more falsifiable
claim than "an equal-weighted composite of five price-derived Safety
proxies has a null Sharpe."

Two generalisable lessons:

1. **PCA can explain a strategy without saving it.** If your
   components are collinear, PCA tells you what the underlying
   dimensions are. Whether *those dimensions* price is an empirical
   question PCA cannot answer for you. Don't confuse "I now
   understand my signal" with "my signal works."
2. **Don't equal-weight PCs either.** Same trap as equal-weighting
   raw components, one level up. If PC1 prices and PC2 doesn't, you
   want PC1, not their average. Variance-explained is not a proxy
   for pricing content.

The honest version of "throw PCA at it" is: use PCA as a
*diagnostic* for what the signal actually is, then make a separate,
deliberate decision about which axes (if any) to trade.

---

*All PCA outputs, loading tables, and PC long-short Sharpes are in
the paper's robustness section and regenerate from `make robust`.
Code: [github.com/faketut/qmj-tsx](https://github.com/faketut/qmj-tsx).*
