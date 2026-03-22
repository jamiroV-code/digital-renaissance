# PROJECT: The Digital Renaissance — Crypto Cycle Intelligence Blog

## FILES
| File | Location | Purpose |
|---|---|---|
| `trading_blog.html` | GitHub + Cloudflare Pages | Complete single-file site |
| `worker.js` | GitHub + Cloudflare Workers (dr-prices) | Price data API |
| `test_runner_worker.js` | GitHub + Cloudflare Workers (dr-test-runner) | Automated test runner |
| `test_suite.py` | GitHub | Test suite (static + live) |
| `STATUS.md` | GitHub | This file — AI handoff document |

## REPO
`https://github.com/jamiroV-code/digital-renaissance`

## HOW WE WORK
1. User uploads `trading_blog.html` + `worker.js` + `STATUS.md` at start of session
2. AI reads all three before touching anything
3. AI proposes before implementing — never patches blindly
4. AI runs `python3 test_suite.py` after every change
5. Section 1 (static) runs in sandbox instantly
6. Section 2 (live) calls `https://dr-test-runner.jamiro-vdw1.workers.dev/run`
7. AI only delivers when ALL TESTS PASSED
8. AI delivers updated STATUS.md alongside files whenever anything changes

## TEST SUITE
```bash
# In sandbox (static only — no internet):
python3 test_suite.py

# Live HTML report (full — needs test runner deployed):
https://dr-test-runner.jamiro-vdw1.workers.dev/run?pretty=1

# CI runs automatically on every GitHub push via .github/workflows/test.yml
```

---

## SITE STRUCTURE

### Tabs (6)
`COMMAND` · `CHARTS` · `PROBABILITY MATRIX` · `THE THESIS` · `DATA SOURCES` · `MARKET IDEAS`

### Intro screen
Video background + Michelangelo hand image (base64 embedded). Click hand → enters blog.
All assets base64-embedded — site works as a standalone file with no external dependencies.

### Ticker bar (7 tickers)
`BTC` · `ETH` · `ETH/BTC` · `2Y YIELD` · `XAU/USD` · `WTI OIL` · `EUR/USD`
Each has sparkline. Flat sparklines (range < 0.05%) are hidden automatically.

---

## WORKER ENDPOINTS

| Endpoint | Source | Cache | Notes |
|---|---|---|---|
| `/macro` | Polygon SPY×10, API-Ninjas WTI, Polygon EURUSD, CoinGecko XAUT, FRED/Treasury 2Y | 30 min | All macro tickers |
| `/crypto` | CoinGecko → Binance fallback | 5 min | BTC, ETH + 6 alts |
| `/bars` | Polygon daily bars | 24h | Sparklines for SPX, oil, DXY |
| `/chartdata` | FRED CSV → Treasury fallback + CoinGecko + alternative.me | 6h | 4 signal charts |
| `/health` | — | none | Version + source info |
| `/healthcheck` | Fetches worker data + 4 independent refs in parallel | none | Live price cross-validation |

---

## DATA SOURCES PER TICKER

| Ticker | Primary | Fallback | Notes |
|---|---|---|---|
| BTC, ETH | CoinGecko via Worker | Binance | Live |
| ONDO, TAO + alts | CoinGecko via Worker | Binance | Live |
| Gold (XAU/USD) | CoinGecko tether-gold (XAUT) | — | ~$4,600 |
| Oil (WTI) | API-Ninjas CME data | Polygon USO ETF raw price | Sanity: $5–$200 absolute bounds |
| EUR/USD | Polygon C:EURUSD /prev | — | DXY proxy |
| S&P 500 | Polygon SPY×10 | — | Not in ticker bar |
| 2Y Yield | FRED DGS2 CSV | US Treasury fiscaldata → edge cache → hardcoded 3.71% | Triple fallback |

## PRICE CROSS-CHECK TOLERANCES (/healthcheck)
| Ticker | Ref Source | Tolerance |
|---|---|---|
| WTI Oil | API-Ninjas (fresh call) | ±5% |
| EUR/USD | Frankfurter.app | ±3% |
| 2Y Yield | US Treasury fiscaldata | ±8% |
| Gold | Binance XAUUSDT | ±5% |
| BTC | Binance BTCUSDT | ±5% |
| ETH | Binance ETHUSDT | ±5% |

---

## FRAMEWORK (Playbook v3)

### Allocation (Phase 3 full deployment)
ETH 53% (€63.6K) · BTC 10% (€12K) · TAO 15% (€18K) · ONDO 15% (€18K) · USDT 7% (€8.4K)

### Phase triggers
- **Phase 1→2:** 2Y yield 2 consecutive weekly closes below 3.80% AND CE-FIM 2 green closes
- **Phase 2→3:** Alt Index daily > 40 → enter TAO · Alt Index > 50 → enter ONDO
- **Exit:** F&G > 85 + BTC.D rebounds + Pi Cycle crosses

### Current regime (March 2026)
Phase 1 — ACCUMULATE. 2Y yield at 3.71%, bouncing toward 3.80% resistance.
3.80% is resistance, not support. Yield needs to FAIL at 3.80% and resume falling.
Two consecutive weekly closes BELOW 3.80% = Phase 2 trigger.

### Capital calculator
Top of COMMAND tab. Visitor enters own capital → loan (50%), allocations, P&L scenarios auto-calculate.

---

## SIGNAL CHARTS (CHARTS tab)
4 charts with phase threshold lines:
1. **2Y Treasury Yield** — 3.80% resistance line. Source: FRED → Treasury fallback
2. **Fear & Greed** — 20 buy zone, 85 exit zone. Source: alternative.me
3. **ETH/BTC Ratio** — 0.022 structural low, 0.040 Phase 3 trigger. Source: CoinGecko
4. **BTC Dominance** — 65% alts suppressed, 55% rotation begins. Source: CoinGecko global

Chart auto-retries after 6s if yield canvas is still blank.

---

## PROBABILITY MATRIX (9 cards, all forward-looking 2026)
1. Fed cut by December 2026 — 61%
2. Fed cut by June 2026 — 18%
3. Zero cuts in 2026 — 17%
4. US recession 2026 — 34%
5. US-Iran escalation — 68%
6. Oil above $90 Q2 2026 — 62%
7. ETH below $1,500 — 64%
8. BTC tests $54-55K — 61%
9. Warsh confirmed Fed Chair — 71%

---

## KNOWN ISSUES / OPEN ITEMS
- **Test runner deployed, worker not yet updated** — user needs to deploy new worker.js to Cloudflare. All 5 test runner checks will turn green once deployed.
- **Oil price** — API-Ninjas returns real WTI from CME (~$93–98 as of Mar 2026). Sanity guard rejects anything outside $5–$200. If rejected, falls back to USO ETF raw price.
- **2Y yield chart** — FRED CSV sometimes fails from Cloudflare. Fixed with Treasury API fallback. Auto-retries after 6s if blank.
- **S&P 500** — fetched by Worker (SPY×10) but no tv-spx ticker bar element. Not displayed in ticker bar.
- **Sparklines** — flat bars (range < 0.05%) are suppressed. Oil and DXY had this issue — fixed.

---

## API KEYS
- **Polygon/Massive:** `8KLhaYEEiKb3oEC1uwc3Pbt4Gw6F0rGR` (free plan, 5 req/min, EOD data)
- **API-Ninjas:** `AoI8ULLZUmSpXzv1O7uXyBaBO5VoPBKziWRfiedc` (free, 10k/month, WTI oil)
- **CoinGecko:** no key (public API, 30 req/min)
- **Binance:** no key (public API)
- **FRED:** no key (public CSV)
- **US Treasury:** no key (public API)
- **alternative.me:** no key (public API)
- **Frankfurter.app:** no key (public API, EUR/USD cross-check)

---

## CLOUDFLARE WORKERS
| Worker | URL | Deploy |
|---|---|---|
| Main (prices) | `https://dr-prices.jamiro-vdw1.workers.dev` | Workers & Pages → dr-prices → Edit Code → paste worker.js |
| Test runner | `https://dr-test-runner.jamiro-vdw1.workers.dev` | Workers & Pages → dr-test-runner → Edit Code → paste test_runner_worker.js |

Free tier: 100k requests/day. Edge cache means actual API calls are a tiny fraction.

## GITHUB
Repo: `https://github.com/jamiroV-code/digital-renaissance`
CI: `.github/workflows/test.yml` — runs test_suite.py on every push to main

## AUTHOR
Jamiro V. — March 2026
