# The Digital Renaissance — Crypto Cycle Intelligence

Single-file trading intelligence site with live price data.

## Files
| File | Description |
|---|---|
| `trading_blog.html` | Complete single-file site |
| `worker.js` | Cloudflare Worker — price data API |
| `test_runner_worker.js` | Cloudflare Worker — automated test runner |
| `test_suite.py` | Test suite (static + live via test runner worker) |

## Deploy

### Main worker
Cloudflare Dashboard → Workers & Pages → `dr-prices` → paste `worker.js` → Save and Deploy

### Test runner worker (one-time setup)
Cloudflare Dashboard → Workers & Pages → Create → name `dr-test-runner` → paste `test_runner_worker.js` → Save and Deploy

### Site
Host `trading_blog.html` anywhere — Cloudflare Pages, GitHub Pages, or open locally.

## Test Suite
```bash
python3 test_suite.py
```
- Runs static code checks instantly (offline)
- Calls `https://dr-test-runner.jamiro-vdw1.workers.dev/run` for live price cross-checks
- Live HTML report: `https://dr-test-runner.jamiro-vdw1.workers.dev/run?pretty=1`

CI runs automatically on every push via GitHub Actions.

## Worker Endpoints
| Endpoint | Description | Cache |
|---|---|---|
| `/macro` | SPX, Gold, Oil, EUR/USD, 2Y Yield | 30 min |
| `/crypto` | BTC, ETH, ONDO, TAO + alts | 5 min |
| `/bars` | Sparkline bars for ticker | 24h |
| `/chartdata` | 4 signal charts (180d) | 6h |
| `/health` | Version + source info | none |
| `/healthcheck` | Live price cross-validation report | none |

## Author
Jamiro V. — 2026
