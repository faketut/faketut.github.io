---
layout: post
title: "Building a Free-Data Canadian Small-Cap Universe: 109 Tickers, Three Sources, Zero Subscriptions"
date: 2026-07-25
tags: [data-engineering, canadian-equities, yfinance, aqr, ken-french, universe-construction]
---

This is the last post in the [QMJ-TSX series](README.md). It's the
most operational of the lot: how I assembled the data layer for a
Canadian small-cap factor paper using only free, public sources, and
what that constraint forced me to accept.

The pitch is simple. Three data sources, all free, all on the
public internet, all cacheable as parquet:

- **Prices.** Yahoo Finance via `yfinance` (`.TO` for TSX, `.V` for
  TSX Venture).
- **AQR factor series.** [AQR Datasets](https://www.aqr.com/Insights/Datasets)
  — QMJ + BAB Equity monthly, all countries including Canada.
- **Fama–French factors.** [Ken French data library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html)
  — Developed 5-factor + Developed momentum, monthly.

And one hand-curated universe file: 109 TSX small/mid-cap tickers
in `data/raw/universe/tsx_smallcap.csv`.

That's it. No Bloomberg, no Refinitiv, no CRSP, no Compustat, no
S&P Capital IQ. Whether that is sufficient depends on what you
want to claim — which is the rest of the post.

## The three sources, briefly

### yfinance for prices

```python
import yfinance as yf
df = yf.download("SU.TO", start="2011-01-01", interval="1mo")
```

Cached to `data/raw/prices/{ticker}.parquet`. Monthly is sufficient
for a factor paper at this horizon and keeps the cache tiny
(~1 MB total for 109 tickers). The `.TO` suffix is mandatory for
TSX names; `.V` for Venture. Without the suffix you'll silently
get the US listing of a same-symbol unrelated company, which is
its own special failure mode.

Honest limitations:
- Survivorship (see
  [the previous post](2026-07-18-yfinance-survivorship-tsx.md)).
- Adjusted close handling is yfinance's, not yours. For monthly
  rebalanced long-shorts this is fine; for intraday strategies it
  is not.
- Some thinly-traded `.V` names have suspect prints. The 109-ticker
  universe was filtered partly on data sanity.

### AQR datasets for the benchmark

AQR publishes country-level QMJ and BAB series as monthly CSVs.
The QMJ-Canada column is the benchmark for the entire paper:
without it I have nothing to replicate against. The CSV layout is
stable across releases — date column, country columns, one row per
month — and the file is small enough to vendor under
`data/raw/aqr/`.

The replication gate (Sharpe within 0.30 of AFP 2019 Table II) is
defined against this series. The cross-check against Ken French
exists precisely because *both* benchmark series are public and
disagree slightly on what "the Canadian factor cross-section" is.

### Ken French for the cross-check factor library

The [Developed 5-factor](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html)
plus Developed momentum, monthly. Canada is too small a market to
have its own French-style factor library, so Developed-region is
the standard substitute when cross-checking a Canadian series. The
RMW (operating profitability) factor in this library is the one
that QMJ-CAN should load on if the construct is intact; in the
paper it loads at β = +0.61 (*t* = 4.16). That cross-check is what
turns the replication from "the numbers approximately match" into
"the construct approximately matches."

## The universe file

`data/raw/universe/tsx_smallcap.csv` is a hand-curated list of 109
tickers spanning the TSX small/mid-cap range circa late 2025. The
construction principles, in rough order:

1. **Currently listed on TSX or TSX Venture** with a Yahoo ticker.
   This is the survivorship-introducing step. There is no free
   alternative.
2. **Market cap roughly in the small/mid range.** No hard
   cutoff — TSX small-cap definitions vary across providers and I
   wasn't going to invent one. Names that were unambiguously
   large-cap (the big banks, the integrated energy majors) were
   excluded.
3. **At least ~10 years of monthly data** in yfinance. This is
   what bounded the sample to 2011-12 onward. Newer listings were
   excluded so that the cross-section per month was reasonably
   stable.
4. **Sector diversity within what TSX actually is.** Which is to
   say: a lot of energy and materials, some industrials, some
   tech and healthcare, very little consumer. The universe
   reflects the index's actual sectoral skew rather than fighting
   it.
5. **Sanity-check on prices.** Tickers with obvious data
   pathologies in yfinance (long flat stretches, single-print
   spikes, missing months) were dropped at curation time.

None of those steps is forecast-aware — none of them required
peeking at returns. But step 1 is the survivorship door, and I'm
upfront about it in the paper.

## Why no fundamentals?

The AQR QMJ construction uses gross profitability, accruals,
leverage, payout ratios — accounting fundamentals at point-in-time
fidelity for the entire cross-section. The free-data options for
Canadian small-caps are:

- **SEDAR+ filings.** Available, but unparsed and inconsistent.
  Parsing PDF financial statements at production quality for 100+
  small-cap tickers is a separate paper's worth of engineering.
- **Yahoo Finance fundamentals.** Available via `yfinance`, but
  point-in-time-incorrect (the values are as-restated, not
  as-reported on the original filing date). Using them would
  introduce look-ahead bias.
- **SimFin / EOD historical data.** Coverage of TSX small-caps is
  thin and gappy. I checked.

The cost of getting fundamentals right for this universe is
roughly an order of magnitude greater than the cost of doing
everything else combined. That is what drove the entire paper-Q
("price-based proxy") detour: the negative result on paper-Q is
also a measurement of how far you can get *without* paying that
cost. Answer: not as far as you'd hope.

## What it costs to do this right

If I were redoing this with a budget, the priority order would be:

1. **Point-in-time Canadian fundamentals** (Compustat, FactSet,
   or equivalent). Unlocks the actual AFP construction. Highest
   marginal value.
2. **Delisting prices and dates.** Kills the survivorship caveat
   from the [previous post](2026-07-18-yfinance-survivorship-tsx.md).
   Second-highest marginal value.
3. **Index constituent histories** (S&P/TSX SmallCap or TMX
   equivalent, monthly). Lets the universe be reconstituted
   point-in-time rather than as a hand-curated snapshot.

You can publish a credible free-data paper without (1)–(3),
provided you scope the claims to what the data actually supports.
That is what this project tried to do.

## Closing the series

If you've read all eight posts: thank you, that's more attention
than most academic papers get. The whole project — paper, code,
data manifests, blog series — is at
[github.com/faketut/qmj-tsx](https://github.com/faketut/qmj-tsx).
`make all` regenerates the paper from a clean clone. The pull
request template is open if you want to extend the universe, swap
in a better data source, or rerun the per-component decomposition
on a different market.

The single sentence I'd leave you with, across the whole series:
**a pre-registered null result on a free-data universe, with the
decomposition that explains the null, is a more honest research
contribution than a positive result you can't reproduce.**

---

*Series index: [README.md](README.md).*
