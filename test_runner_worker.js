// ═══════════════════════════════════════════════════════════════
//  DIGITAL RENAISSANCE — TEST RUNNER WORKER
//  Deploy to: dr-test-runner.jamiro-vdw1.workers.dev
//
//  GET /run          — full test suite, returns JSON report
//  GET /run?pretty=1 — human-readable HTML report
//
//  This worker:
//  1. Hits /healthcheck on the main worker (live price cross-checks)
//  2. Hits each individual endpoint and validates response shape
//  3. Returns a complete pass/fail report
//
//  The main worker calls it like this from the sandbox:
//  fetch('https://dr-test-runner.jamiro-vdw1.workers.dev/run')
// ═══════════════════════════════════════════════════════════════

const MAIN_WORKER = 'https://dr-prices.jamiro-vdw1.workers.dev';
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
};

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url  = new URL(request.url);
  const path = url.pathname;
  if (path === '/run') return runTests(url.searchParams.get('pretty') === '1');
  return new Response('DR Test Runner — GET /run to execute test suite', { status: 200, headers: CORS });
}

// ── Individual endpoint validators ───────────────────────────

async function validateMacro() {
  const checks = [];
  let raw;
  try {
    const r = await fetch(MAIN_WORKER + '/macro', { headers: { 'User-Agent': 'DR-testrunner/1.0' } });
    if (!r.ok) return [{ name: '/macro HTTP', pass: false, detail: 'HTTP ' + r.status }];
    raw = await r.json();
  } catch(e) {
    return [{ name: '/macro fetch', pass: false, detail: e.message }];
  }

  checks.push({ name: '/macro response shape', pass: !!raw.macro && typeof raw.macro === 'object',
    detail: raw.macro ? 'ok' : 'missing macro key' });

  const expected = ['spx','oil','dxy','gold','y2'];
  for (const key of expected) {
    const d = raw.macro?.[key];
    const hasPrice = d && d.price != null && !isNaN(+d.price);
    const hasError = d && d.error;
    checks.push({
      name: `/macro.${key}`,
      pass: hasPrice,
      detail: hasError ? 'error: ' + d.error : hasPrice ? `${d.price} (${d.date||'no date'})` : 'missing or null',
      warning: d?.stale ? 'stale/fallback value' : null,
    });
  }

  // oil-specific: chg can be null (API-Ninjas limitation) but price must exist
  const oil = raw.macro?.oil;
  if (oil && !oil.error) {
    checks.push({ name: '/macro.oil.label honest', pass: oil.label?.includes('WTI') || oil.label?.includes('USO'),
      detail: oil.label || 'no label' });
  }

  // y2 stale warning
  const y2 = raw.macro?.y2;
  if (y2?.stale) {
    checks.push({ name: '/macro.y2 freshness', pass: true, warning: 'yield is stale — source: ' + (y2.source||'unknown') });
  }

  checks.push({ name: '/macro cached flag', pass: typeof raw.cached === 'boolean', detail: 'cached=' + raw.cached });
  return checks;
}

async function validateCrypto() {
  const checks = [];
  let raw;
  try {
    const r = await fetch(MAIN_WORKER + '/crypto', { headers: { 'User-Agent': 'DR-testrunner/1.0' } });
    if (!r.ok) return [{ name: '/crypto HTTP', pass: false, detail: 'HTTP ' + r.status }];
    raw = await r.json();
  } catch(e) {
    return [{ name: '/crypto fetch', pass: false, detail: e.message }];
  }

  const data = raw.data || raw.crypto || {};
  checks.push({ name: '/crypto response shape', pass: !!data.bitcoin, detail: data.bitcoin ? 'ok' : 'missing bitcoin key' });

  const coins = ['bitcoin','ethereum','ondo-finance','pendle','chainlink','bittensor','render-token','fetch-ai'];
  for (const coin of coins) {
    const d = data[coin];
    checks.push({
      name: `/crypto.${coin}`,
      pass: d?.usd != null && !isNaN(d.usd) && d.usd > 0,
      detail: d ? `$${d.usd} (24h: ${d.usd_24h_change?.toFixed(2)}%)` : 'missing',
    });
  }
  return checks;
}

async function validateBars() {
  const checks = [];
  let raw;
  try {
    const r = await fetch(MAIN_WORKER + '/bars', { headers: { 'User-Agent': 'DR-testrunner/1.0' } });
    if (!r.ok) return [{ name: '/bars HTTP', pass: false, detail: 'HTTP ' + r.status }];
    raw = await r.json();
  } catch(e) {
    return [{ name: '/bars fetch', pass: false, detail: e.message }];
  }

  const bars = raw.bars || {};
  checks.push({ name: '/bars response shape', pass: typeof bars === 'object', detail: 'keys: ' + Object.keys(bars).join(',') });

  for (const sym of ['spx','oil','dxy']) {
    const b = bars[sym];
    const ok = Array.isArray(b) && b.length >= 2;
    const flat = ok && (Math.max(...b) - Math.min(...b)) / Math.min(...b) < 0.0005;
    checks.push({
      name: `/bars.${sym}`,
      pass: ok,
      detail: ok ? `${b.length} bars, range ${Math.min(...b).toFixed(2)}–${Math.max(...b).toFixed(2)}` : 'missing or empty',
      warning: flat ? 'bars are flat — sparkline will be hidden' : null,
    });
  }
  return checks;
}

async function validateChartdata() {
  const checks = [];
  let raw;
  try {
    const r = await fetch(MAIN_WORKER + '/chartdata', { headers: { 'User-Agent': 'DR-testrunner/1.0' } });
    if (!r.ok) return [{ name: '/chartdata HTTP', pass: false, detail: 'HTTP ' + r.status }];
    raw = await r.json();
  } catch(e) {
    return [{ name: '/chartdata fetch', pass: false, detail: e.message }];
  }

  checks.push({ name: '/chartdata.yield', pass: Array.isArray(raw.yield) && raw.yield.length > 10,
    detail: raw.yield ? `${raw.yield.length} points` : 'null — yield chart will be blank' });
  checks.push({ name: '/chartdata.fng', pass: Array.isArray(raw.fng) && raw.fng.length > 10,
    detail: raw.fng ? `${raw.fng.length} points` : 'null' });
  checks.push({ name: '/chartdata.ethbtc', pass: Array.isArray(raw.ethbtc) && raw.ethbtc.length > 10,
    detail: raw.ethbtc ? `${raw.ethbtc.length} points` : 'null' });
  checks.push({ name: '/chartdata.btcDom', pass: raw.btcDom != null && !isNaN(raw.btcDom),
    detail: raw.btcDom ? `${raw.btcDom.toFixed(1)}%` : 'null' });
  return checks;
}

async function validatePrices() {
  // Calls /healthcheck on main worker — it does all the cross-checking internally
  // against Frankfurter, Binance, Treasury, API-Ninjas
  const checks = [];
  let raw;
  try {
    const r = await fetch(MAIN_WORKER + '/healthcheck', { headers: { 'User-Agent': 'DR-testrunner/1.0' } });
    raw = await r.json();
  } catch(e) {
    return [{ name: '/healthcheck fetch', pass: false, detail: e.message }];
  }

  checks.push({ name: 'healthcheck overall', pass: raw.ok === true,
    detail: `pass=${raw.pass} fail=${raw.fail} ref_unavail=${raw.ref_unavail} elapsed=${raw.elapsed_ms}ms` });

  // Individual price checks
  for (const [key, result] of Object.entries(raw.checks || {})) {
    const label = { oil:'WTI Oil', eurusd:'EUR/USD', yield:'2Y Yield', gold:'Gold', btc:'BTC', eth:'ETH' }[key] || key;
    if (result.pass === null) {
      checks.push({ name: `price.${label}`, pass: true,
        warning: `ref source unavailable — could not cross-check (worker=${result.worker})` });
    } else {
      checks.push({
        name:   `price.${label}`,
        pass:   result.pass,
        detail: result.pass != null
          ? `worker=${result.worker} ref=${result.ref} diff=${result.diff_pct}% (tol±${result.tolerance_pct}%)`
          : result.reason,
        warning: result.worker_error ? 'worker error: ' + result.worker_error : null,
      });
    }
  }
  return checks;
}

// ── Main test runner ──────────────────────────────────────────

async function runTests(pretty) {
  const t0 = Date.now();

  const [macroChecks, cryptoChecks, barsChecks, chartChecks, priceChecks] = await Promise.all([
    validateMacro(),
    validateCrypto(),
    validateBars(),
    validateChartdata(),
    validatePrices(),
  ]);

  const all = [
    { section: 'Macro endpoint',     checks: macroChecks  },
    { section: 'Crypto endpoint',    checks: cryptoChecks },
    { section: 'Bars endpoint',      checks: barsChecks   },
    { section: 'Chartdata endpoint', checks: chartChecks  },
    { section: 'Price cross-checks', checks: priceChecks  },
  ];

  const flat     = all.flatMap(s => s.checks);
  const failed   = flat.filter(c => c.pass === false);
  const passed   = flat.filter(c => c.pass === true);
  const warnings = flat.filter(c => c.warning);
  const allPass  = failed.length === 0;

  const report = {
    ok:           allPass,
    pass:         passed.length,
    fail:         failed.length,
    warnings:     warnings.length,
    elapsed_ms:   Date.now() - t0,
    ts:           new Date().toISOString(),
    sections:     all,
    failures:     failed,
  };

  if (!pretty) {
    return new Response(JSON.stringify(report, null, 2), {
      status:  allPass ? 200 : 502,
      headers: CORS,
    });
  }

  // ── Pretty HTML report ────────────────────────────────────
  const rows = all.map(s => {
    const sectionFail = s.checks.filter(c => c.pass === false).length;
    const sectionWarn = s.checks.filter(c => c.warning).length;
    const icon = sectionFail > 0 ? '✗' : sectionWarn > 0 ? '⚠' : '✓';
    const col  = sectionFail > 0 ? '#ff4466' : sectionWarn > 0 ? '#f5a623' : '#1ed660';
    const rows = s.checks.map(c => {
      const ci   = c.pass === false ? '✗' : c.pass === null ? '?' : '✓';
      const cc   = c.pass === false ? '#ff4466' : c.pass === null ? '#888' : '#1ed660';
      const warn = c.warning ? `<div style="color:#f5a623;font-size:11px;margin-top:2px">⚠ ${c.warning}</div>` : '';
      return `<tr>
        <td style="color:${cc};font-weight:700;width:20px">${ci}</td>
        <td style="font-family:monospace;font-size:12px;color:#e0d8c8">${c.name}</td>
        <td style="font-size:11px;color:#8a8070">${c.detail||''}${warn}</td>
      </tr>`;
    }).join('');
    return `<tr style="background:rgba(200,168,107,.04)">
      <td colspan="3" style="padding:8px 12px;font-family:monospace;font-size:12px;color:${col};font-weight:700">
        ${icon} ${s.section} (${s.checks.filter(c=>c.pass===true).length}/${s.checks.length} pass)
      </td></tr>${rows}`;
  }).join('<tr style="height:8px"></tr>');

  const statusCol = allPass ? '#1ed660' : '#ff4466';
  const statusTxt = allPass ? 'ALL TESTS PASSED' : `${failed.length} FAILURE(S)`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>DR Test Runner</title>
<style>
  body{background:#0c0b14;color:#e0d8c8;font-family:'Inter',sans-serif;margin:0;padding:24px}
  h1{font-family:monospace;font-size:14px;letter-spacing:.15em;color:#c8a86b;margin:0 0 4px}
  .status{font-family:monospace;font-size:22px;font-weight:700;margin:12px 0;color:${statusCol}}
  .meta{font-size:11px;color:#6a6050;margin-bottom:20px;font-family:monospace}
  table{width:100%;border-collapse:collapse}
  td{padding:4px 10px;vertical-align:top;border-bottom:1px solid rgba(200,168,107,.04)}
  .fail-box{background:rgba(255,68,102,.08);border:1px solid rgba(255,68,102,.2);border-radius:6px;padding:12px 16px;margin-bottom:16px}
  .fail-box h2{font-family:monospace;font-size:12px;color:#ff4466;margin:0 0 8px;letter-spacing:.1em}
  .fail-item{font-family:monospace;font-size:11px;color:#ff8888;padding:3px 0}
</style></head><body>
<h1>DR // TEST RUNNER</h1>
<div class="status">${statusTxt}</div>
<div class="meta">${new Date().toISOString()} · ${Date.now()-t0}ms · pass=${passed.length} fail=${failed.length} warn=${warnings.length}</div>
${failed.length > 0 ? `<div class="fail-box"><h2>FAILURES</h2>${failed.map(f=>`<div class="fail-item">✗ ${f.name} — ${f.detail||''}</div>`).join('')}</div>` : ''}
<table>${rows}</table>
</body></html>`;

  return new Response(html, {
    status:  allPass ? 200 : 502,
    headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store',
               'Access-Control-Allow-Origin': '*' },
  });
}
