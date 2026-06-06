---
layout: post
title: "What yfinance Survivorship Does to a TSX Small-Cap Backtest"
date: 2026-07-18
tags: [data-quality, survivorship-bias, yfinance, backtesting, tsx, canadian-equities]
---

In the [QMJ-TSX paper](https://github.com/faketut/qmj-tsx) I flag
yfinance survivorship as a likely contaminant of the paper-Q
extension's results. This post unpacks what that actually means,
why it's worse for small-caps than for large-caps, and what an
honest researcher with a free-data constraint can do about it.

The short version: if you build a TSX small-cap universe from
"tickers that still trade today" and then backtest over 2011–2025,
your historical universe is silently missing every delisting,
every reverse-merger reshuffle, and every junior-resource zero.
Whatever strategy you test will look better than it would have on
the real cross-section that was investable in 2011.

## What yfinance gives you

yfinance is a Yahoo Finance scraper. For any ticker that
currently has a Yahoo page (e.g. `XYZ.TO` for TSX, `XYZ.V` for TSX
Venture), it returns historical daily OHLCV back to the listing
date. That is genuinely useful and has the unbeatable property of
being free.

What it does *not* give you:

1. **Delisted tickers.** A ticker that traded on TSX in 2014 and
   delisted in 2017 — for any reason — generally has no Yahoo
   page today. yfinance returns "no data" or silently skips.
2. **Reverse-merged or renamed tickers** without a careful symbol
   trail. A junior that was acquired, reverse-merged, or rolled
   into a SPAC becomes effectively invisible.
3. **Point-in-time index membership.** "The TSX small-cap universe
   in 2014" is not a thing yfinance can tell you. The best you can
   do is "tickers in the small-cap bucket *today* that have data
   going back to 2014," which is exactly the survivorship trap.

For US large-caps, the gap between (1)–(3) and reality is small
enough that yfinance is a defensible free data source. For TSX
small/mid-caps it is structurally large.

## Why small-caps are the worst case

Three reasons compound:

**Base rate of delisting is high.** Junior energy, mining, and
biotech names — which dominate the TSX small/mid-cap universe — fail
at rates that have nothing in common with S&P 500 attrition. A
universe drawn from "what survived" is not a random subsample of
"what was investable"; it is the right tail.

**Index reconstitutions are large and frequent.** The TSX
small/mid-cap bucket has meaningful turnover every year. Even if
you somehow had a perfect snapshot today, projecting it backward
implies an unrealistic constancy of membership.

**The risk being measured is asymmetric.** This is the one that
matters most for a Quality / Safety-style strategy. A "low
volatility" name that quietly delisted in 2018 doesn't show up in
your backtest's loss distribution. The survivors you do test on
include disproportionately many names whose volatility *was* low
*because* they didn't blow up. Your backtest gets the reward of
defensiveness without paying the tail cost. The whole construct's
premium comes from avoiding tail events, so this is exactly the
worst place to have survivorship.

## What it does to paper-Q specifically

The paper-Q long-short on TSX small/mid-caps over 2011-12 to 2025-11
has a full-sample Sharpe near zero. My honest assessment is that the
true number — on a survivorship-corrected universe — is probably
*worse*, not better, for a structural reason:

- A defensiveness-tilted long leg benefits most from removing the
  worst-performing junior resource and biotech names.
- yfinance survivorship removes exactly those names from the
  universe.
- So the *long* leg of paper-Q is the part most contaminated by
  survivorship; the short leg less so.
- Removing survivorship would tend to *hurt* the long leg's measured
  Sharpe and improve the short leg's.

Net direction on a long-short: roughly negative. The null result
likely understates how badly the strategy actually performs.

That is an uncomfortable thing to say in a paper, which is why I
say it. The pre-COVID +0.47 Sharpe is the one I trust least on
this account: the bull run of 2011–2019 generated a lot of names
that quietly disappeared by 2025 and are missing from my universe
today.

## What you can do with a free-data constraint

Two practical interventions worth the effort, two not worth it:

**Worth it.**

1. **Snapshot the universe at multiple historical dates if you
   can.** Archive.org and historical TSX/TMX bulletins sometimes
   preserve old constituent lists. Even three or four historical
   snapshots, used as additional "as-of" universes, expose how
   much the surviving-today list misses.
2. **Report the cross-section size over time.** If your 2011
   "universe" has the same 109 tickers as your 2025 universe, you
   are not running a 2011 backtest — you are running a 2025
   backtest on 2011 prices. Putting the cross-section count on a
   chart per month makes this visible to readers.

**Not worth it for a working paper.**

3. **Don't fake a survivorship correction.** Without delisting
   prices and dates, you cannot impute returns for missing tickers
   honestly. A made-up −90% return on a delisted name is
   research fraud in a coat.
4. **Don't buy CRSP / Compustat just for this.** If you can,
   great. But the right move for a free-data paper is to *flag
   the limitation honestly* and design the conclusions around it,
   not to pretend you have data you don't.

## The honest framing

The paper's framing reflects the constraint. The headline claim is
not "paper-Q doesn't work on TSX small-caps." It is "in a
universe constructed from currently-listed TSX small-caps with
free price data, a fundamentals-free price proxy fails to recover
the AQR QMJ-Canada premium, and the failure is concentrated in
the post-COVID low-volatility unwind." Every clause in that
sentence is true on the data I actually have.

If you are doing a free-data quant project: name your data
limitations specifically, and design your claims so they survive
the limitations being real. That is the cheap version of
academic honesty, and it is much more useful than a confident
claim built on data that can't support it.

---

*Universe file:
[`data/raw/universe/tsx_smallcap.csv`](https://github.com/faketut/qmj-tsx/blob/main/data/raw/universe/tsx_smallcap.csv).
A companion post on
[how that universe was built](2026-07-25-building-a-free-data-universe.md)
covers the construction in more detail.*
