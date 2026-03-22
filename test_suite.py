# ═══════════════════════════════════════════════════════════════
#  DIGITAL RENAISSANCE — TEST SUITE v4
#
#  Section 1: static checks (runs here in the sandbox, offline)
#  Section 2: calls the test runner worker which does everything
#             live — price cross-checks, endpoint validation,
#             shape checks — all server-side with real internet
#
#  Usage (in this sandbox after every change):
#    python3 test_suite.py
#
#  Usage (on your machine, human-readable):
#    open https://dr-test-runner.jamiro-vdw1.workers.dev/run?pretty=1
# ═══════════════════════════════════════════════════════════════
import re, json, urllib.request, ssl, sys, os

TEST_RUNNER = 'https://dr-test-runner.jamiro-vdw1.workers.dev/run'
HTML_FILE   = 'trading_blog.html'
WORKER_FILE = 'worker.js'
GITHUB_RAW  = 'https://raw.githubusercontent.com/jamiroV-code/digital-renaissance/main'   # used if running from CI without local files
errors = []

ctx = ssl.create_default_context()
def fetch_json(url, timeout=25):
    try:
        req = urllib.request.Request(url, headers={'User-Agent':'DR-test/4.0'})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {'_error': str(e)}

# ══════════════════════════════════════════════════════════════
# SECTION 1 — STATIC (offline, instant)
# ══════════════════════════════════════════════════════════════
print('─'*56)
print('SECTION 1 — Static code checks')
print('─'*56)

for f in [HTML_FILE, WORKER_FILE]:
    if not os.path.exists(f): sys.exit(f'ERROR: {f} not found in current directory')

with open(WORKER_FILE) as f: w = f.read()
with open(HTML_FILE)   as f: html = f.read()

fns_def  = set(re.findall(r'(?:async\s+)?function\s+(\w+)\s*\(', w))
fns_call = set(re.findall(r'await\s+(\w+)\s*\(', w))
ignore   = {'fetch','Promise','setTimeout','fetchFn','resolve','reject','res'}
for fn in fns_call - fns_def - ignore:
    errors.append('Worker: ' + fn + '() not defined')
if w.count('{') != w.count('}'): errors.append('Worker: brace mismatch')
for fn in ['fetchSPY','fetchOil','fetchDXY','fetchGold','fetchFREDYield',
           'fetchMacro','massiveBarsFor','fetchCoinGecko','fetchBinanceCrypto',
           'withCache','handleRequest']:
    if fn not in fns_def: errors.append('Worker missing: ' + fn)
for route in ['/macro','/crypto','/bars','/chartdata','/health','/healthcheck']:
    if f"path === '{route}'" not in w: errors.append('Worker route missing: ' + route)
for c in ['MASSIVE_KEY','CORS','FRED_CSV_URL','CACHE_KEY_MACRO','CACHE_KEY_CRYPTO']:
    if 'const ' + c not in w: errors.append('Worker constant: ' + c)
if 'wtiRaw'      not in w: errors.append('Worker: oil sanity guard (wtiRaw) missing')
if 'implausible' not in w: errors.append('Worker: oil implausible-price message missing')
if 'TOLERANCE'   not in w: errors.append('Worker: /healthcheck TOLERANCE map missing')
for ref in ['frankfurter.app','binance.com','fiscaldata.treasury.gov','api-ninjas.com']:
    if ref not in w: errors.append(f'Worker: /healthcheck missing ref: {ref}')

me_s = html.find('<script id="m-engine">') + len('<script id="m-engine">')
me_e = html.find('</script>', me_s); me = html[me_s:me_e]
if me.count('{') != me.count('}'): errors.append('m-engine: brace mismatch')
ce_s = html.find('<script id="chart-engine">')
if ce_s < 0: errors.append('CHART: chart-engine script missing')
else:
    ce_e = html.find('</script>', ce_s); ce = html[ce_s:ce_e]
    if ce.count('{') != ce.count('}'): errors.append('chart-engine: brace mismatch')
    for fn in ['renderYield','renderFNG','renderEthBtc','renderBtcDom','loadCharts']:
        if 'function ' + fn not in ce: errors.append('CHART: ' + fn + ' missing')
    if '/chartdata'    not in ce: errors.append('CHART: not calling /chartdata')
    if 'auto-retrying' not in ce: errors.append('CHART: auto-retry missing')

tb  = html[html.find('id="ticker-bar"'):html.find('id="ticker-bar"')+2000]
tv  = set(re.findall(r'id="tv-(\w+)"', tb))
am  = me[me.find('function applyMacro'):me.find('\n}\n',me.find('function applyMacro'))+3]
for d in set(re.findall(r"setTick\('(\w+)'", am)) - tv:
    errors.append('Dead setTick: ' + d)
for tid in ['btc','eth','ethbtc','gold','oil','dxy','2y']:
    if f'id="tv-{tid}"' not in tb: errors.append('DATA: tv-' + tid + ' missing')
for c in ['chart-yield','chart-fng','chart-ethbtc','chart-btcdom']:
    if f'canvas id="{c}"' not in html: errors.append('CHART: canvas ' + c + ' missing')

ids = ['command','charts','matrix','thesis','sources','ideas']
em  = html.rfind('</div>\n</div>\n\n<script>')
for i, pid in enumerate(ids):
    s = html.find(f'id="panel-{pid}"')
    e = html.find(f'id="panel-{ids[i+1]}"') if i < len(ids)-1 else em
    if s < 0: errors.append(f'panel-{pid}: missing'); continue
    ch = html[s:e]
    if ch.count('<div') != ch.count('</div>'):
        errors.append(f'panel-{pid}: div mismatch (open={ch.count("<div")} close={ch.count("</div>")})')

src = html[html.find('const SOURCES='):html.find(';\n\nfunction renderSources')+1]
if src.count('{') != src.count('}'): errors.append('SOURCES: brace mismatch')
if src.count('[') != src.count(']'): errors.append('SOURCES: bracket mismatch')
am_full = me[me.find('function applyMacro'):me.find('\n}\n',me.find('function applyMacro'))+3]
if "setTick('2y'" not in am_full:    errors.append('DATA: 2Y yield never rendered')
if 'y2.price!=null' not in am_full and 'y2.stale' not in am_full:
    errors.append('DATA: 2Y fallback missing')
if 'oilChg' not in am_full and 'oil.chg' not in am_full:
    errors.append('DATA: oil null chg not handled')
fred_fn = w[w.find('async function fetchFREDYield'):w.find('\n}\n',w.find('async function fetchFREDYield'))+3]
if 'return {price:' not in fred_fn and 'return{price:' not in fred_fn:
    errors.append('DATA: fetchFREDYield missing hardcoded fallback')
fm = w[w.find('async function fetchMacro'):w.find('\n}\n',w.find('async function fetchMacro'))+3]
if 'y2:' not in fm: errors.append('DATA: fetchMacro not returning y2')

main_js = html[html.find('<script>')+8:html.find('</script>')]
if 'function enterBlog' not in main_js: errors.append('INTRO: enterBlog missing')
if 'id="hand-img"' not in html: errors.append('INTRO: hand-img missing')
if 'onclick="enterBlog()"' not in html: errors.append('INTRO: hand onclick missing')
if "hand-img').src='data:image/png;base64," not in html: errors.append('INTRO: hand base64 missing')
if '@keyframes float' not in html: errors.append('INTRO: float animation missing')
for struct, label in [('const MACRO=','MACRO'),('const MATRIX=','MATRIX'),('const SOURCES=','SOURCES')]:
    idx = main_js.find(struct)
    if idx < 0: errors.append(f'DATA: {label} missing'); continue
    end = main_js.find(';\n', idx+100)
    block = main_js[idx:end+1]
    if block.count('[') != block.count(']'): errors.append(f'DATA: {label} bracket mismatch')
feats = {
    'WORKER URL':        'jamiro-vdw1.workers.dev' in me,
    'fetchBars':         'fetchBars' in me,
    'applyBars':         'applyBars' in me,
    'cap-input':         'cap-input' in html,
    'updateCapital':     'function updateCapital' in html,
    'renderSources':     'function renderSources' in html,
    'DOMContentLoaded':  "addEventListener('DOMContentLoaded'" in html,
    'API-Ninjas':        'api-ninjas.com' in w,
    'massiveBarsFor':    'massiveBarsFor' in fns_def,
    'sparkSVG flatline': "if (mx - mn < mn * 0.0005) return ''" in html,
    'no dup calculator': html.count('// YOUR CAPITAL CALCULATOR') == 1,
    'chart auto-retry':  'auto-retrying' in html,
}
for name, ok in feats.items():
    if not ok: errors.append('Missing/broken: ' + name)
all_ids  = re.findall(r'\bid="([^"$<>]+)"', html)
seen_ids = {}
for v in all_ids:
    if '${' in v: continue
    seen_ids[v] = seen_ids.get(v, 0) + 1
for v, c in seen_ids.items():
    if c > 1: errors.append(f'UI: duplicate id="{v}" x{c}')

if errors:
    print(f'{len(errors)} STATIC ERROR(S) — fix before live checks:')
    for e in errors: print('  x ' + e)
    sys.exit(1)
print(f'  All static checks passed')

# ══════════════════════════════════════════════════════════════
# SECTION 2 — LIVE (calls test runner worker)
# ══════════════════════════════════════════════════════════════
print()
print('─'*56)
print('SECTION 2 — Live checks via test runner worker')
print('─'*56)
print(f'  Calling {TEST_RUNNER} ...')

report = fetch_json(TEST_RUNNER, timeout=30)

if '_error' in report:
    print(f'  Cannot reach test runner: {report["_error"]}')
    print()
    print('  NOTE: Deploy test_runner_worker.js to Cloudflare first:')
    print('  Workers & Pages → Create → dr-test-runner → paste → Deploy
  Repo: https://github.com/jamiroV-code/digital-renaissance')
    print()
    print('='*56)
    print('STATIC TESTS PASSED — deploy test runner for live checks')
    print(f'Worker: {len(w)//1024}KB | HTML: {len(html)//1024}KB')
    sys.exit(0)

print(f'  Response: ok={report.get("ok")} pass={report.get("pass")} '
      f'fail={report.get("fail")} warn={report.get("warnings")} '
      f'elapsed={report.get("elapsed_ms")}ms')

live_errors = []
live_warnings = []

for section in report.get('sections', []):
    for check in section.get('checks', []):
        if check.get('pass') is False:
            live_errors.append(f'[{section["section"]}] {check["name"]}: {check.get("detail","")}')
        if check.get('warning'):
            live_warnings.append(f'[{section["section"]}] {check["name"]}: {check["warning"]}')

if live_warnings:
    print(f'\n  {len(live_warnings)} WARNING(S):')
    for w in live_warnings: print('  ! ' + w)

print()
print('='*56)
if not live_errors:
    print('ALL TESTS PASSED — SAFE TO DELIVER')
    print(f'Worker: {len(w)//1024}KB | HTML: {len(html)//1024}KB')
else:
    print(f'{len(live_errors)} LIVE ERROR(S) — DO NOT DELIVER:')
    for e in live_errors: print('  x ' + e)
    sys.exit(1)
