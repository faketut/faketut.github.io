---
layout: post
title: "A Low-Vol Unwind Hiding Inside a Composite Signal"
date: 2026-06-13
tags: [quant, factor-investing, low-volatility, regime-change, signal-design]
---

This is the second post in a series on a price-based Quality factor
("paper-Q") I built for TSX small-caps. The headline result — that
paper-Q does not recover the AQR QMJ-Canada premium — is in
[the previous post](2026-06-06-qmj-tsx-null-result.md). Here I want
to talk about what I found when I cracked the composite open.

If you build any composite signal by averaging *z*-scored components,
the most boring failure mode is also the one that's easiest to
overlook: your components secretly all measure the same thing. A
null result on the composite then tells you nothing about whether
the underlying construct works — it just tells you that the average
of N copies of one signal is, surprise, that signal.

That is essentially what happened to paper-Q.

## The setup

paper-Q averages five sign-aligned, *z*-scored components:

1. idiosyncratic volatility,
2. market beta,
3. maximum drawdown,
4. rolling Sharpe,
5. downside semi-deviation.

Each is supposed to be a proxy for some part of AFP's Safety leg.
Four of them — idio vol, beta, max drawdown, downside semi-dev — are
volatility-flavoured. The fifth, rolling Sharpe, is the only one
with a price-momentum flavour.

To see which components were actually driving the composite, I ran a
**per-component horse race**: each component as a standalone
value-weighted tercile long-short, same 10 bps round-trip cost, three
windows (full sample, pre-COVID, post-COVID).

## The result

The pattern is sharp.

| Component             | Full Sharpe | Pre-COVID | Post-COVID |
| --------------------- | ----------: | --------: | ---------: |
| Idiosyncratic vol     | low / negative | + (0.12 to 0.57 band) | − (−0.53 to −0.92 band) |
| Market beta           | low / negative | +         | −          |
| Max drawdown          | low / negative | +         | −          |
| Downside semi-dev     | low / negative | +         | −          |
| **Rolling Sharpe**    | **+0.32**   | **+0.66** | **−0.10**  |

Two things jump out.

**One.** Four of the five components are mechanically the same
underlying signal — the cross-section of price volatility, viewed
through slightly different statistics. All four post positive
pre-COVID Sharpes between roughly +0.12 and +0.57. All four collapse
to comparable *negative* numbers post-COVID, between −0.53 and −0.92.
This is one factor turning over, not four independent signals
coincidentally agreeing.

**Two.** Rolling Sharpe — the only price-momentum-flavoured component
— behaves qualitatively differently. It has the highest full-sample
Sharpe in the set (+0.32), the highest pre-COVID number (+0.66), and
the shallowest post-COVID drawdown (−0.10).

So the composite's full-sample ≈ 0 Sharpe is, mechanically, the
average of one positive signal and four highly correlated negative
ones. Equal-weighting masked the heterogeneity entirely.

## Why this matters beyond paper-Q

The narrow conclusion is about this strategy: the post-COVID failure
of paper-Q is **specifically a low-volatility unwind**, not a generic
breakdown of price-based signals on TSX small-caps. Every
volatility-flavoured price statistic in my set turned over together
in March 2020 and has not recovered; the price-momentum component
was comparatively unaffected.

The general conclusion is about signal construction. Two practical
rules of thumb that I'd defend more strongly now than I would have
before this exercise:

1. **Always run components standalone before you composite them.**
   The cost is N extra backtests. The benefit is that you find out
   before publication whether you have one factor or N factors.
   Equal-weighting near-collinear components is not "diversification" —
   it's just a noisier version of the underlying signal, with a worse
   story attached.
2. **Decompose first, then design the weighting.** If four of five
   components turn out to be one factor, the right composite weights
   them by *uniqueness*, not equally. PCA residuals are the obvious
   next move — and the next post in this series will work through
   what PCA actually does and does not buy you here. (Short version:
   it explains the regime break cleanly, but it doesn't rescue the
   strategy.)

## A meta-lesson

A composite signal with five inputs and a null full-sample result
*looks* like a clean negative finding. It almost wasn't. The clean
negative finding is the per-component table above. Without it, I
would have written a paper claiming "fundamentals-free Quality
doesn't work on TSX small-caps" when what I had actually shown was
"a particular equal-weighted low-vol composite doesn't work on TSX
small-caps, in a way that says nothing about rolling Sharpe."

Decomposition is cheap. Run it.

---

*Code and the full robustness battery (including the per-component
table above): [github.com/faketut/qmj-tsx](https://github.com/faketut/qmj-tsx).
Reproduce with `make robust`.*
