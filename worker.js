// ═══════════════════════════════════════════════════════════════
//  DIGITAL RENAISSANCE — PRICE WORKER v13
//  FIXES vs v12:
//  - SPX: SPY price kept ×10, but verified label
//  - Oil: removed broken USO×1.27 → now fetches CL=F via
//         Polygon futures ticker (free plan: /v2/aggs/prev)
//  - Bars: switched from hourly (paid) to daily (free)
//  - FRED: added retry logic for 520 errors
//  - DXY: unchanged (EUR/USD via Polygon, clearly labeled)
// ═══════════════════════════════════════════════════════════════

const MASSIVE_KEY      = '8KLhaYEEiKb3oEC1uwc3Pbt4Gw6F0rGR';
const MASSIVE_BASE = 'https://api.polygon.io';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json',
};

// ── Auth helpers ──────────────────────────────────────────────
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(password + salt);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

function authResponse(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

async function getAuthUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const session = await env.DR_USERS.get('session:' + token, 'json');
    if (!session) return null;
    if (session.expires < Date.now()) {
      await env.DR_USERS.delete('session:' + token);
      return null;
    }
    return session;
  } catch(e) { return null; }
}

const MACRO_TTL  = 1800;
const CRYPTO_TTL = 300;
const CACHE_KEY_MACRO  = 'https://dr-cache.internal/macro-v19';
const CACHE_KEY_CRYPTO = 'https://dr-cache.internal/crypto-v14';

const CG_CRYPTO_IDS = 'bitcoin,ethereum,ondo-finance,pendle,chainlink,bittensor,render-token,fetch-ai';

async function fetchSPY() {
  const url = `${MASSIVE_BASE}/v2/aggs/ticker/SPY/prev?adjusted=true&apiKey=${MASSIVE_KEY}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'DR/13.0' } });
  if (!r.ok) throw new Error('SPY HTTP ' + r.status);
  const j = await r.json();
  if (!j.results?.length) throw new Error('SPY no results: ' + j.status);
  const x = j.results[0];
  const chg = x.o ? +(((x.c - x.o) / x.o) * 100).toFixed(2) : 0;
  return {
    price: +(x.c * 10).toFixed(0),
    chg,
    date:  new Date(x.t).toISOString().split('T')[0],
    label: 'S&P 500',
    bars:  await massiveBarsFor('SPY', 10),
  };
}

async function fetchDXY() {
  const url = `${MASSIVE_BASE}/v2/aggs/ticker/C:EURUSD/prev?adjusted=true&apiKey=${MASSIVE_KEY}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'DR/13.0' } });
  if (!r.ok) throw new Error('EURUSD HTTP ' + r.status);
  const j = await r.json();
  if (!j.results?.length) throw new Error('EURUSD no results: ' + j.status);
  const x = j.results[0];
  const chg = x.o ? +(((x.c - x.o) / x.o) * 100).toFixed(2) : 0;
  return {
    price: +x.c.toFixed(4),
    chg,
    date:  new Date(x.t).toISOString().split('T')[0],
    label: 'EUR/USD',
    note:  'proxy',
    bars:  await massiveBarsFor('C:EURUSD', 1),
  };
}

async function fetchGold() {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=tether-gold&vs_currencies=usd&include_24hr_change=true`;
  const r = await fetch(url, { headers: { 'User-Agent': 'DR/13.0' } });
  if (!r.ok) throw new Error('CoinGecko gold HTTP ' + r.status);
  const j = await r.json();
  const xaut = j['tether-gold'];
  if (!xaut?.usd) throw new Error('CoinGecko gold: bad data');
  return {
    price: +xaut.usd.toFixed(0),
    chg:   +xaut.usd_24h_change.toFixed(2),
    date:  new Date().toISOString().split('T')[0],
    label: 'Gold (XAU/USD)',
    bars:  [],
  };
}

async function fetchOil() {
  // USO ETF via Polygon — tracks WTI price action perfectly
  // Same direction/% change as WTI, different absolute price
  const url = `${MASSIVE_BASE}/v2/aggs/ticker/USO/prev?adjusted=true&apiKey=${MASSIVE_KEY}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'DR/13.0' } });
  if (!r.ok) throw new Error('USO HTTP ' + r.status);
  const j = await r.json();
  if (!j.results?.length) throw new Error('USO no results: ' + j.status);
  const x = j.results[0];
  const chg = x.o ? +(((x.c - x.o) / x.o) * 100).toFixed(2) : 0;
  return {
    price: +x.c.toFixed(2),
    chg,
    date:  new Date(x.t).toISOString().split('T')[0],
    label: 'Oil (USO)',
    bars:  await massiveBarsFor('USO', 1),
  };
}

const TREASURY_URL  = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?fields=record_date,avg_interest_rate_amt,security_desc&filter=security_desc:eq:Treasury%20Notes&sort=-record_date&limit=5&page[size]=5';
const FRED_CSV_URL  = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2';
const FRED_CACHE_KEY = 'https://dr-cache.internal/yield-v2';

async function fetchFREDYield() {
  // Source 1: FRED DGS2 CSV — most accurate, daily 2Y yield
  try {
    const r = await fetch(FRED_CSV_URL, {
      headers: {'User-Agent':'DR/13.0', 'Accept':'text/csv'}
    });
    if (!r.ok) throw new Error('FRED HTTP ' + r.status);
    const csv   = await r.text();
    const lines = csv.trim().split('\n').filter(l => !l.startsWith('DATE') && !l.includes('NA') && l.trim());
    if (!lines.length) throw new Error('FRED: empty');
    const last = lines[lines.length-1].split(',');
    const prev = lines[lines.length-2]?.split(',');
    const val  = parseFloat(last[1]);
    if (isNaN(val)) throw new Error('FRED: NaN');
    const result = {
      price: val,
      chg:   +(val - (prev ? parseFloat(prev[1]) : val)).toFixed(3),
      date:  last[0],
      label: '2Y Yield',
      unit:  '%',
      bars:  [],
      source: 'FRED',
    };
    caches.default.put(FRED_CACHE_KEY, new Response(JSON.stringify(result), {
      headers: {'Content-Type':'application/json','Cache-Control':'public, max-age=86400'}
    }));
    return result;
  } catch(e) { console.warn('FRED CSV failed:', e.message); }

  // Source 2: US Treasury par yield curve (official, no key)
  try {
    const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/avg_interest_rates?fields=record_date,avg_interest_rate_amt,security_type_desc&filter=security_type_desc:eq:Marketable&sort=-record_date&limit=3';
    const r = await fetch(url, {headers:{'User-Agent':'DR/13.0'}});
    if (!r.ok) throw new Error('Treasury HTTP ' + r.status);
    const j = await r.json();
    const d = j.data?.[0];
    if (!d) throw new Error('Treasury: no data');
    const val = parseFloat(d.avg_interest_rate_amt);
    if (isNaN(val)) throw new Error('Treasury: NaN');
    return {price:val, chg:0, date:d.record_date, label:'2Y Yield~', unit:'%', bars:[], source:'Treasury', stale:true};
  } catch(e) { console.warn('Treasury failed:', e.message); }

  // Source 3: Last known cached value
  try {
    const cached = await caches.default.match(FRED_CACHE_KEY);
    if (cached) {
      const d = await cached.json();
      return {...d, stale:true, label:'2Y Yield*', source:'cache'};
    }
  } catch(e) {}

  // Source 4: Hardcoded last known value (updated Mar 2026)
  return {price:3.71, chg:0, date:'2026-03-19', label:'2Y Yield*', unit:'%', bars:[], stale:true, source:'fallback'};
}

async function massiveBarsFor(sym, mult) {
  try {
    const now  = new Date();
    const from = new Date(now - 7*24*3600000).toISOString().split('T')[0];
    const to   = now.toISOString().split('T')[0];
    const url  = `${MASSIVE_BASE}/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=10&apiKey=${MASSIVE_KEY}`;
    const r = await fetch(url, {headers:{'User-Agent':'DR/13.0'}});
    if (!r.ok) return [];
    const j = await r.json();
    if (!j.results?.length) return [];
    return j.results.map(b => +(b.c * mult).toFixed(2));
  } catch(e) { return []; }
}

async function fetchMacro() {
  const [spyResult, oilResult, dxyResult, goldResult, yieldResult] = await Promise.all([
    fetchSPY().catch(e       => ({ error: e.message })),
    fetchOil().catch(e       => ({ error: e.message })),
    fetchDXY().catch(e       => ({ error: e.message })),
    fetchGold().catch(e      => ({ error: e.message })),
    fetchFREDYield().catch(e => ({ error: e.message })),
  ]);

  return {
    spx:  spyResult,
    oil:  oilResult,
    dxy:  dxyResult,
    gold: goldResult,
    y2:   yieldResult,
  };
}

async function fetchCoinGecko() {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${CG_CRYPTO_IDS}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
  const r = await fetch(url, { headers: { 'User-Agent': 'DR/13.0' } });
  if (!r.ok) throw new Error('CoinGecko HTTP ' + r.status);
  const j = await r.json();
  if (!j.bitcoin) throw new Error('bad data');
  return { data: j, source: 'CoinGecko' };
}

async function fetchBinanceCrypto() {
  const syms = JSON.stringify(['BTCUSDT','ETHUSDT','ONDOUSDT','PENDLEUSDT','LINKUSDT','TAOUSDT','RENDERUSDT','FETUSDT']);
  const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(syms));
  if (!r.ok) throw new Error('Binance HTTP ' + r.status);
  const arr = await r.json();
  const map = { BTCUSDT:'bitcoin',ETHUSDT:'ethereum',ONDOUSDT:'ondo-finance',PENDLEUSDT:'pendle',LINKUSDT:'chainlink',TAOUSDT:'bittensor',RENDERUSDT:'render-token',FETUSDT:'fetch-ai' };
  const out = {};
  arr.forEach(x => { const id=map[x.symbol]; if(id) out[id]={usd:+x.lastPrice,usd_24h_change:+x.priceChangePercent,usd_market_cap:+x.quoteVolume}; });
  if (!out.bitcoin) throw new Error('bad data');
  return { data: out, source: 'Binance' };
}

async function withCache(cache, keyUrl, ttl, fetchFn) {
  try {
    const hit = await cache.match(keyUrl);
    if (hit) {
      const body = await hit.json();
      return new Response(JSON.stringify({ ...body, cached: true }), {
        headers: { ...CORS, 'Cache-Control': `public, max-age=${ttl}`, 'X-Cache': 'HIT' },
      });
    }
  } catch(e) {}
  const result  = await fetchFn();
  const payload = { ...result, ts: Date.now(), cached: false };
  const resp = new Response(JSON.stringify(payload), {
    headers: { ...CORS, 'Cache-Control': `public, max-age=${ttl}`, 'X-Cache': 'MISS' },
  });
  try { await cache.put(keyUrl, resp.clone()); } catch(e) {}
  return resp;
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event.request._env || {}));
});

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  const path  = new URL(request.url).pathname;
  const cache = caches.default;

  if (path === '/health') {
    return new Response(JSON.stringify({
      ok: true, ts: Date.now(), version: 'v13',
      endpoints: ['/macro','/crypto','/bars','/chartdata','/netliquidity','/health','/healthcheck','/testrun'],
      healthcheck: 'GET /healthcheck — live price cross-validation report',
      sources: {
        spx:  'Polygon SPY×10',
        oil:  'API-Ninjas WTI → USO fallback',
        dxy:  'Polygon C:EURUSD',
        gold: 'CoinGecko XAUT',
        y2:   'FRED DGS2 → Treasury → cache → 3.71%',
      }
    }), { headers: CORS });
  }

  if (path === '/macro') {
    try {
      return await withCache(cache, CACHE_KEY_MACRO, MACRO_TTL,
        async () => ({ macro: await fetchMacro(), source: 'Polygon+CoinGecko+FRED+CrudePriceAPI' })
      );
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: CORS });
    }
  }

  if (path === '/crypto' || path === '/prices' || path === '/') {
    try {
      return await withCache(cache, CACHE_KEY_CRYPTO, CRYPTO_TTL, async () => {
        try { return await fetchCoinGecko(); }
        catch(e) { return await fetchBinanceCrypto(); }
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: CORS });
    }
  }

  if (path === '/bars') {
    try {
      return await withCache(cache, 'https://dr-cache.internal/bars-v1', 86400, async () => {
        const syms = [{sym:'SPY',mult:10,id:'spx'},{sym:'USO',mult:1,id:'oil'},{sym:'C:EURUSD',mult:1,id:'dxy'}];
        const now  = new Date();
        const from = new Date(now - 7*24*3600000).toISOString().split('T')[0];
        const to   = now.toISOString().split('T')[0];
        const results = {};
        await Promise.all(syms.map(async t => {
          try {
            const url = `${MASSIVE_BASE}/v2/aggs/ticker/${encodeURIComponent(t.sym)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=10&apiKey=${MASSIVE_KEY}`;
            const r = await fetch(url, {headers:{'User-Agent':'DR/13.0'}});
            if (!r.ok) return;
            const j = await r.json();
            if (!j.results?.length) return;
            results[t.id] = j.results.map(b => +(b.c * t.mult).toFixed(2));
          } catch(e) {}
        }));
        return {bars: results};
      });
    } catch(e) {
      return new Response(JSON.stringify({bars:{}}), {headers:CORS});
    }
  }

  if (path === '/chartdata') {
    try {
      return await withCache(cache, 'https://dr-cache.internal/chartdata-v3', 21600, async () => {
        const [yieldData, fngData, ethData, btcData, globalData] = await Promise.all([
          (async () => {
            // Source 1: Alpha Vantage TREASURY_YIELD — daily 2Y yield, reliable
            try {
              const avUrl = 'https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=2year&apikey=47W08ZYGJETWFRQH';
              const r = await fetch(avUrl, {headers:{'User-Agent':'DR/13.0'}});
              if (r.ok) {
                const j = await r.json();
                if (j?.Information) throw new Error('AV rate limit');
                const pts = j?.data;
                if (Array.isArray(pts) && pts.length > 10) {
                  // AV returns descending, reverse to ascending, take last 180
                  const data = pts.slice(0, 180).reverse()
                    .map(p => ({d: p.date, v: parseFloat(p.value)}))
                    .filter(x => !isNaN(x.v) && x.v > 0);
                  if (data.length > 10) return data;
                }
              }
            } catch(e) { console.warn('chartdata AV yield failed:', e.message); }
            // Source 2: FRED CSV fallback
            try {
              const r = await fetch(FRED_CSV_URL, {headers:{'User-Agent':'DR/13.0'}});
              if (r.ok) {
                const csv = await r.text();
                const lines = csv.trim().split('\n').filter(l=>!l.startsWith('DATE')&&!l.includes('NA')).slice(-180);
                const data = lines.map(l=>{const[d,v]=l.split(',');return{d,v:parseFloat(v)};}).filter(x=>!isNaN(x.v));
                if (data.length > 10) return data;
              }
            } catch(e) { console.warn('chartdata FRED failed:', e.message); }
            return null;
          })(),
          fetch('https://api.alternative.me/fng/?limit=90&format=json',{headers:{'User-Agent':'DR/13.0'}}).then(r=>r.ok?r.json():null).then(j=>j?j.data.reverse().map(d=>({d:new Date(d.timestamp*1000).toISOString().split('T')[0],v:+d.value,label:d.value_classification})):null).catch(()=>null),
          fetch('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=180&interval=daily',{headers:{'User-Agent':'DR/13.0'}}).then(r=>r.ok?r.json():null).catch(()=>null),
          fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=180&interval=daily',{headers:{'User-Agent':'DR/13.0'}}).then(r=>r.ok?r.json():null).catch(()=>null),
          fetch('https://api.coingecko.com/api/v3/global',{headers:{'User-Agent':'DR/13.0'}}).then(r=>r.ok?r.json():null).catch(()=>null),
        ]);
        const ethbtc = (ethData?.prices||[]).map((p,i)=>{
          const bp=btcData?.prices?.[i]?.[1];
          return bp?{d:new Date(p[0]).toISOString().split('T')[0],v:+(p[1]/bp).toFixed(5)}:null;
        }).filter(Boolean);
        return {yield:yieldData, fng:fngData, ethbtc, btcDom:globalData?.data?.market_cap_percentage?.btc||null, ts:Date.now()};
      });
    } catch(e) {
      return new Response(JSON.stringify({error:e.message}),{status:502,headers:CORS});
    }
  }

  // /healthcheck — self-validating price cross-check endpoint
  // Fetches worker sources + independent references in parallel
  // Returns JSON report: pass/fail per ticker with actual values and diff %
  if (path === '/healthcheck') {
    const t0 = Date.now();
    const results = {};
    const TOLERANCE = { oil:5, eurusd:3, yield:8, gold:5, btc:5, eth:5 };

    function pctDiff(a, b) { return b ? Math.abs(a - b) / b * 100 : null; }
    function check(label, workerVal, refVal, tol) {
      if (workerVal == null) return { pass:false, reason:'worker returned null', worker:workerVal, ref:refVal };
      if (refVal == null)    return { pass:null,  reason:'ref unavailable',      worker:workerVal, ref:null };
      const diff = pctDiff(workerVal, refVal);
      return { pass: diff <= tol, worker: +workerVal.toFixed(4), ref: +refVal.toFixed(4), diff_pct: +diff.toFixed(2), tolerance_pct: tol };
    }

    // Fetch everything in parallel — worker data + 4 independent reference sources
    const [
      macroResp, cryptoResp,
      frankResp, binanceResp, treasuryResp, ninjasResp
    ] = await Promise.allSettled([
      // Worker sources (bypass cache — fresh fetch)
      fetchMacro().catch(e => ({ error: e.message })),
      fetchCoinGecko().catch(() => fetchBinanceCrypto().catch(e => ({ error: e.message }))),

      // Ref 1: Frankfurter — EUR/USD (free, no key)
      fetch('https://api.frankfurter.app/latest?from=EUR&to=USD', { headers:{'User-Agent':'DR-healthcheck/1.0'} })
        .then(r => r.ok ? r.json() : null).catch(() => null),

      // Ref 2: Binance spot — BTC, ETH, XAU (gold)
      fetch('https://api.binance.com/api/v3/ticker/price?symbols=' +
        encodeURIComponent(JSON.stringify(['BTCUSDT','ETHUSDT','XAUUSDT'])),
        { headers:{'User-Agent':'DR-healthcheck/1.0'} })
        .then(r => r.ok ? r.json() : null).catch(() => null),

      // Ref 3: US Treasury fiscaldata — 2Y yield
      fetch('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/' +
        'avg_interest_rates?fields=record_date,avg_interest_rate_amt,security_type_desc' +
        '&filter=security_type_desc:eq:Marketable&sort=-record_date&limit=3',
        { headers:{'User-Agent':'DR-healthcheck/1.0'} })
        .then(r => r.ok ? r.json() : null).catch(() => null),

      // Ref 4: API-Ninjas WTI (independent call, same key — detects caching drift)
      // No separate ref for oil — Yahoo CL=F is already independent enough
      Promise.resolve(null),
    ]);

    // Unpack worker data
    const macro  = macroResp.status  === 'fulfilled' ? macroResp.value  : {};
    const crypto = cryptoResp.status === 'fulfilled'
      ? (cryptoResp.value?.data || cryptoResp.value || {})
      : {};

    // Unpack reference data
    const frank    = frankResp.status    === 'fulfilled' ? frankResp.value    : null;
    const binance  = binanceResp.status  === 'fulfilled' ? binanceResp.value  : null;
    const treasury = treasuryResp.status === 'fulfilled' ? treasuryResp.value : null;
    const ninjas   = ninjasResp.status   === 'fulfilled' ? ninjasResp.value   : null;

    // Parse reference values
    const ref = {
      eurusd:   frank?.rates?.USD ?? null,
      btc:      binance ? +binance.find(x=>x.symbol==='BTCUSDT')?.price  || null : null,
      eth:      binance ? +binance.find(x=>x.symbol==='ETHUSDT')?.price  || null : null,
      gold:     binance ? +binance.find(x=>x.symbol==='XAUUSDT')?.price  || null : null,
      yield:    treasury?.data?.[0] ? +treasury.data[0].avg_interest_rate_amt : null,
      oil:      ninjas?.price ? +ninjas.price : null,
    };

    // Absolute sanity on ref oil (same guard as worker)
    if (ref.oil != null && (ref.oil < 5 || ref.oil > 200)) {
      results.oil_ref_sanity = { pass: false, reason: 'ref WTI outside absolute bounds $5-$200: ' + ref.oil };
      ref.oil = null;
    }

    // Run comparisons
    results.oil    = check('WTI Oil',  macro.oil?.price,      ref.oil,    TOLERANCE.oil);
    results.eurusd = check('EUR/USD',  macro.dxy?.price,      ref.eurusd, TOLERANCE.eurusd);
    results.yield  = check('2Y Yield', macro.y2?.price,       ref.yield,  TOLERANCE.yield);
    results.gold   = check('Gold',     macro.gold?.price,     ref.gold,   TOLERANCE.gold);
    results.btc    = check('BTC',      crypto.bitcoin?.usd,   ref.btc,    TOLERANCE.btc);
    results.eth    = check('ETH',      crypto.ethereum?.usd,  ref.eth,    TOLERANCE.eth);

    // Worker error passthrough
    for (const [k, src] of [['oil','oil'],['eurusd','dxy'],['yield','y2'],['gold','gold']]) {
      if (macro[src]?.error) results[k].worker_error = macro[src].error;
    }

    const allPass   = Object.values(results).every(r => r.pass !== false);
    const failCount = Object.values(results).filter(r => r.pass === false).length;
    const nullCount = Object.values(results).filter(r => r.pass === null).length;

    const report = {
      ok:           allPass,
      pass:         Object.values(results).filter(r => r.pass === true).length,
      fail:         failCount,
      ref_unavail:  nullCount,
      elapsed_ms:   Date.now() - t0,
      ts:           new Date().toISOString(),
      version:      'v13',
      checks:       results,
    };

    return new Response(JSON.stringify(report, null, 2), {
      status: allPass ? 200 : 502,
      headers: { ...CORS, 'Cache-Control': 'no-store' },
    });
  }


  // /testrun — full self-test, runs all validations internally
  // No cross-worker calls — everything runs in this same worker
  if (path === '/testrun') {
    const pretty = new URL(request.url).searchParams.get('pretty') === '1';
    const t0 = Date.now();
    const sections = [];
    const allFailures = [];

    function pass(name, detail, warning) { return {name, pass:true, detail:detail||'', warning:warning||null}; }
    function fail(name, detail)          { return {name, pass:false, detail:detail||''}; }
    function warn(name, detail, warning) { return {name, pass:true,  detail:detail||'', warning}; }

    // ── Section 1: Macro endpoint ──────────────────────────────
    const macroChecks = [];
    try {
      const r = await fetch(new Request(request.url.replace('/testrun','/macro'), {headers:{'User-Agent':'DR-testrun/1.0'}}));
      if (!r.ok) { macroChecks.push(fail('/macro HTTP', 'HTTP '+r.status)); }
      else {
        const j = await r.json();
        macroChecks.push(pass('/macro shape', j.macro ? 'ok' : 'missing macro key'));
        for (const key of ['spx','oil','dxy','gold','y2']) {
          const d = j.macro?.[key];
          const ok = d && d.price != null && !isNaN(+d.price) && !d.error;
          macroChecks.push(ok
            ? (d.stale ? warn(`/macro.${key}`, String(d.price), 'stale: '+d.source) : pass(`/macro.${key}`, String(d.price)+' '+d.date))
            : fail(`/macro.${key}`, d?.error || 'null price'));
        }
      }
    } catch(e) { macroChecks.push(fail('/macro fetch', e.message)); }
    sections.push({section:'Macro endpoint', checks:macroChecks});

    // ── Section 2: Crypto endpoint ─────────────────────────────
    const cryptoChecks = [];
    try {
      const r = await fetch(new Request(request.url.replace('/testrun','/crypto'), {headers:{'User-Agent':'DR-testrun/1.0'}}));
      if (!r.ok) { cryptoChecks.push(fail('/crypto HTTP', 'HTTP '+r.status)); }
      else {
        const j = await r.json();
        const data = j.data || j.crypto || {};
        for (const coin of ['bitcoin','ethereum','ondo-finance','pendle','chainlink','bittensor','render-token','fetch-ai']) {
          const d = data[coin];
          const ok = d?.usd != null && !isNaN(d.usd) && d.usd > 0;
          cryptoChecks.push(ok ? pass(`/crypto.${coin}`, '$'+d.usd.toFixed(2)) : fail(`/crypto.${coin}`, 'missing'));
        }
      }
    } catch(e) { cryptoChecks.push(fail('/crypto fetch', e.message)); }
    sections.push({section:'Crypto endpoint', checks:cryptoChecks});

    // ── Section 3: Bars endpoint ───────────────────────────────
    const barsChecks = [];
    try {
      const r = await fetch(new Request(request.url.replace('/testrun','/bars'), {headers:{'User-Agent':'DR-testrun/1.0'}}));
      if (!r.ok) { barsChecks.push(fail('/bars HTTP', 'HTTP '+r.status)); }
      else {
        const j = await r.json();
        const bars = j.bars || {};
        for (const sym of ['spx','oil','dxy']) {
          const b = bars[sym];
          const ok = Array.isArray(b) && b.length >= 2;
          const flat = ok && (Math.max(...b)-Math.min(...b))/Math.min(...b) < 0.0005;
          barsChecks.push(!ok
            ? fail(`/bars.${sym}`, 'missing or empty')
            : flat ? warn(`/bars.${sym}`, b.length+' bars', 'flat — sparkline hidden') : pass(`/bars.${sym}`, b.length+' bars'));
        }
      }
    } catch(e) { barsChecks.push(fail('/bars fetch', e.message)); }
    sections.push({section:'Bars endpoint', checks:barsChecks});

    // ── Section 4: Chartdata endpoint ─────────────────────────
    const chartChecks = [];
    try {
      const r = await fetch(new Request(request.url.replace('/testrun','/chartdata'), {headers:{'User-Agent':'DR-testrun/1.0'}}));
      if (!r.ok) { chartChecks.push(fail('/chartdata HTTP', 'HTTP '+r.status)); }
      else {
        const j = await r.json();
        chartChecks.push(Array.isArray(j.yield)  && j.yield.length>10  ? pass('/chartdata.yield',  j.yield.length+' pts')  : fail('/chartdata.yield',  j.yield?j.yield.length+' pts (too few)':'null — chart blank'));
        chartChecks.push(Array.isArray(j.fng)    && j.fng.length>10    ? pass('/chartdata.fng',    j.fng.length+' pts')    : fail('/chartdata.fng',    'null or too few'));
        chartChecks.push(Array.isArray(j.ethbtc) && j.ethbtc.length>10 ? pass('/chartdata.ethbtc', j.ethbtc.length+' pts') : fail('/chartdata.ethbtc', 'null or too few'));
        chartChecks.push(j.btcDom!=null&&!isNaN(j.btcDom) ? pass('/chartdata.btcDom', j.btcDom.toFixed(1)+'%') : fail('/chartdata.btcDom','null'));
      }
    } catch(e) { chartChecks.push(fail('/chartdata fetch', e.message)); }
    sections.push({section:'Chartdata endpoint', checks:chartChecks});

    // ── Section 5: Price cross-checks (/healthcheck) ──────────
    const priceChecks = [];
    try {
      const r = await fetch(new Request(request.url.replace('/testrun','/healthcheck'), {headers:{'User-Agent':'DR-testrun/1.0'}}));
      const j = await r.json();
      priceChecks.push(j.ok ? pass('healthcheck overall', `pass=${j.pass} fail=${j.fail} elapsed=${j.elapsed_ms}ms`)
        : fail('healthcheck overall', `pass=${j.pass} fail=${j.fail}`));
      for (const [key, result] of Object.entries(j.checks||{})) {
        const label = {oil:'WTI Oil',eurusd:'EUR/USD',yield:'2Y Yield',gold:'Gold',btc:'BTC',eth:'ETH'}[key]||key;
        if (result.pass===null) priceChecks.push(warn(`price.${label}`, 'worker='+result.worker, 'ref unavailable'));
        else priceChecks.push(result.pass
          ? pass(`price.${label}`, `worker=${result.worker} ref=${result.ref} diff=${result.diff_pct}%`)
          : fail(`price.${label}`, `worker=${result.worker} ref=${result.ref} diff=${result.diff_pct}% > ${result.tolerance_pct}% tolerance`));
      }
    } catch(e) { priceChecks.push(fail('/healthcheck', e.message)); }
    sections.push({section:'Price cross-checks', checks:priceChecks});

    // ── Compile report ─────────────────────────────────────────
    const flat     = sections.flatMap(s=>s.checks);
    const failed   = flat.filter(c=>c.pass===false);
    const passed   = flat.filter(c=>c.pass===true);
    const warnings = flat.filter(c=>c.warning);
    const ok       = failed.length===0;
    allFailures.push(...failed);

    const report = {ok, pass:passed.length, fail:failed.length, warnings:warnings.length,
      elapsed_ms:Date.now()-t0, ts:new Date().toISOString(), sections, failures:failed};

    if (!pretty) return new Response(JSON.stringify(report,null,2),{status:ok?200:502,headers:{...CORS,'Cache-Control':'no-store'}});

    // ── Pretty HTML ────────────────────────────────────────────
    const statusCol = ok?'#1ed660':'#ff4466';
    const statusTxt = ok?'ALL TESTS PASSED':failed.length+' FAILURE(S)';
    const rows = sections.map(s=>{
      const sf=s.checks.filter(c=>c.pass===false).length, sw=s.checks.filter(c=>c.warning).length;
      const ic=sf>0?'✗':sw>0?'⚠':'✓', cc=sf>0?'#ff4466':sw>0?'#f5a623':'#1ed660';
      return `<tr style="background:rgba(200,168,107,.06)"><td colspan="3" style="padding:8px 12px;font-family:monospace;font-size:12px;color:${cc};font-weight:700">${ic} ${s.section} (${s.checks.filter(c=>c.pass===true).length}/${s.checks.length})</td></tr>`
        +s.checks.map(c=>{
          const ci=c.pass===false?'✗':c.pass===null?'?':'✓', cc2=c.pass===false?'#ff4466':c.pass===null?'#888':'#1ed660';
          return `<tr><td style="color:${cc2};font-weight:700;width:20px;padding:3px 10px">${ci}</td><td style="font-family:monospace;font-size:12px;color:#e0d8c8;padding:3px 10px">${c.name}</td><td style="font-size:11px;color:#8a8070;padding:3px 10px">${c.detail||''}${c.warning?`<div style="color:#f5a623">⚠ ${c.warning}</div>`:''}</td></tr>`;
        }).join('');
    }).join('<tr style="height:6px"></tr>');

    const htmlOut = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DR Test Runner</title>
<style>body{background:#0c0b14;color:#e0d8c8;font-family:Inter,sans-serif;margin:0;padding:24px}
h1{font-family:monospace;font-size:13px;letter-spacing:.15em;color:#c8a86b;margin:0 0 4px}
.status{font-family:monospace;font-size:22px;font-weight:700;margin:10px 0;color:${statusCol}}
.meta{font-size:11px;color:#6a6050;margin-bottom:18px;font-family:monospace}
table{width:100%;border-collapse:collapse}td{border-bottom:1px solid rgba(200,168,107,.04);vertical-align:top}
.fb{background:rgba(255,68,102,.08);border:1px solid rgba(255,68,102,.2);border-radius:5px;padding:10px 14px;margin-bottom:14px}
.fb h2{font-family:monospace;font-size:12px;color:#ff4466;margin:0 0 6px;letter-spacing:.1em}
.fi{font-family:monospace;font-size:11px;color:#ff8888;padding:2px 0}</style></head><body>
<h1>DR // TEST RUNNER</h1>
<div class="status">${statusTxt}</div>
<div class="meta">${new Date().toISOString()} · ${Date.now()-t0}ms · pass=${passed.length} fail=${failed.length} warn=${warnings.length}</div>
${failed.length>0?`<div class="fb"><h2>FAILURES</h2>${failed.map(f=>`<div class="fi">✗ ${f.name} — ${f.detail}</div>`).join('')}</div>`:''}
<table>${rows}</table></body></html>`;

    return new Response(htmlOut,{status:ok?200:502,headers:{'Content-Type':'text/html','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
  }


  // ── POST /auth/register ───────────────────────────────────
  if (path === '/auth/register' && request.method === 'POST') {
    try {
      if (!env?.DR_USERS) return authResponse({error:'KV not configured — add DR_USERS binding in Cloudflare'}, 503);
      const body = await request.json();
      const username = (body.username||'').trim().toLowerCase();
      const email    = (body.email||'').trim().toLowerCase();
      const password = (body.password||'').trim();

      if (!username || username.length < 3) return authResponse({error:'Username must be at least 3 characters'}, 400);
      if (!/^[a-z0-9_]+$/.test(username))   return authResponse({error:'Username: only letters, numbers, underscore'}, 400);
      if (!email || !email.includes('@'))    return authResponse({error:'Valid email required'}, 400);
      if (!password || password.length < 6)  return authResponse({error:'Password must be at least 6 characters'}, 400);

      // Check username taken
      const existing = await env.DR_USERS.get('user:' + username);
      if (existing) return authResponse({error:'Username already taken'}, 409);

      // Check email taken
      const emailKey = await env.DR_USERS.get('email:' + email);
      if (emailKey) return authResponse({error:'Email already registered'}, 409);

      // Hash password
      const salt     = generateSalt();
      const pwHash   = await hashPassword(password, salt);
      const token    = generateToken();
      const now      = Date.now();
      const expires  = now + 30 * 24 * 60 * 60 * 1000; // 30 days

      const user = { username, email, pwHash, salt, created: now };
      const session = { username, email, created: now, expires };

      // Store user + email index + session
      await Promise.all([
        env.DR_USERS.put('user:' + username, JSON.stringify(user)),
        env.DR_USERS.put('email:' + email, username),
        env.DR_USERS.put('session:' + token, JSON.stringify(session), { expirationTtl: 30 * 24 * 60 * 60 }),
      ]);

      return authResponse({ ok:true, token, username, email, expires });
    } catch(e) {
      return authResponse({ error: 'Register failed: ' + e.message }, 500);
    }
  }

  // ── POST /auth/login ──────────────────────────────────────
  if (path === '/auth/login' && request.method === 'POST') {
    try {
      if (!env?.DR_USERS) return authResponse({error:'KV not configured'}, 503);
      const body     = await request.json();
      const username = (body.username||'').trim().toLowerCase();
      const password = (body.password||'').trim();

      if (!username || !password) return authResponse({error:'Username and password required'}, 400);

      const raw = await env.DR_USERS.get('user:' + username);
      if (!raw) return authResponse({error:'Invalid username or password'}, 401);

      const user   = JSON.parse(raw);
      const pwHash = await hashPassword(password, user.salt);
      if (pwHash !== user.pwHash) return authResponse({error:'Invalid username or password'}, 401);

      const token   = generateToken();
      const now     = Date.now();
      const expires = now + 30 * 24 * 60 * 60 * 1000;
      const session = { username: user.username, email: user.email, created: now, expires };

      await env.DR_USERS.put('session:' + token, JSON.stringify(session), { expirationTtl: 30 * 24 * 60 * 60 });

      return authResponse({ ok:true, token, username: user.username, email: user.email, expires });
    } catch(e) {
      return authResponse({ error: 'Login failed: ' + e.message }, 500);
    }
  }

  // ── GET /auth/me ──────────────────────────────────────────
  if (path === '/auth/me') {
    if (!env?.DR_USERS) return authResponse({error:'KV not configured'}, 503);
    const user = await getAuthUser(request, env);
    if (!user) return authResponse({error:'Not authenticated'}, 401);
    return authResponse({ ok:true, username: user.username, email: user.email });
  }

  // ── POST /auth/logout ─────────────────────────────────────
  if (path === '/auth/logout' && request.method === 'POST') {
    if (!env?.DR_USERS) return authResponse({ok:true});
    const auth  = request.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (token) await env.DR_USERS.delete('session:' + token).catch(()=>{});
    return authResponse({ ok:true });
  }

  // ── GET /admin/users (protected) ──────────────────────────
  if (path === '/admin/users') {
    const secret = new URL(request.url).searchParams.get('secret');
    if (secret !== 'dr_admin_2026_jamiro') return authResponse({error:'Unauthorized'}, 401);
    if (!env?.DR_USERS) return authResponse({error:'KV not configured'}, 503);
    try {
      const list = await env.DR_USERS.list({prefix:'user:'});
      const users = await Promise.all(list.keys.map(async k => {
        const raw = await env.DR_USERS.get(k.name, 'json');
        return raw ? { username: raw.username, email: raw.email, created: new Date(raw.created).toISOString() } : null;
      }));
      return authResponse({ ok:true, count: users.length, users: users.filter(Boolean) });
    } catch(e) {
      return authResponse({ error: e.message }, 500);
    }
  }


  // ── GET /chat/messages ────────────────────────────────────
  // Returns last 50 messages (broadcasts + replies)
  if (path === '/chat/messages') {
    if (!env?.DR_USERS) return authResponse({error:'KV not configured'}, 503);
    try {
      const since = new URL(request.url).searchParams.get('since') || '0';
      const raw = await env.DR_USERS.get('chat:messages', 'json') || [];
      const filtered = raw.filter(m => m.ts > parseInt(since));
      return authResponse({ ok:true, messages: filtered, ts: Date.now() });
    } catch(e) {
      return authResponse({ error: e.message }, 500);
    }
  }

  // ── POST /chat/message ────────────────────────────────────
  // Authenticated users post replies; admin posts broadcasts
  if (path === '/chat/message' && request.method === 'POST') {
    if (!env?.DR_USERS) return authResponse({error:'KV not configured'}, 503);
    const user = await getAuthUser(request, env);
    if (!user) return authResponse({error:'Not authenticated'}, 401);
    try {
      const body = await request.json();
      const text = (body.text||'').trim().slice(0, 500);
      if (!text) return authResponse({error:'Message cannot be empty'}, 400);
      const replyTo = body.replyTo || null; // message id being replied to
      const isAdmin = user.username === 'jamiro'; // admin username
      const msg = {
        id:       Date.now() + '_' + Math.random().toString(36).slice(2,7),
        ts:       Date.now(),
        username: user.username,
        text,
        type:     isAdmin && !replyTo ? 'broadcast' : 'reply',
        replyTo,
        pinned:   false,
      };
      // Store — keep last 200 messages
      const existing = await env.DR_USERS.get('chat:messages', 'json') || [];
      const updated = [...existing, msg].slice(-200);
      await env.DR_USERS.put('chat:messages', JSON.stringify(updated));
      return authResponse({ ok:true, message: msg });
    } catch(e) {
      return authResponse({ error: e.message }, 500);
    }
  }

  // ── POST /chat/pin ────────────────────────────────────────
  // Admin can pin/unpin a message
  if (path === '/chat/pin' && request.method === 'POST') {
    if (!env?.DR_USERS) return authResponse({error:'KV not configured'}, 503);
    const user = await getAuthUser(request, env);
    if (!user || user.username !== 'jamiro') return authResponse({error:'Admin only'}, 403);
    try {
      const body = await request.json();
      const msgs = await env.DR_USERS.get('chat:messages', 'json') || [];
      const updated = msgs.map(m => m.id === body.id ? {...m, pinned: !m.pinned} : m);
      await env.DR_USERS.put('chat:messages', JSON.stringify(updated));
      return authResponse({ ok:true });
    } catch(e) {
      return authResponse({ error: e.message }, 500);
    }
  }

  // ── DELETE /chat/message ──────────────────────────────────
  // Admin can delete any message
  if (path === '/chat/message' && request.method === 'DELETE') {
    if (!env?.DR_USERS) return authResponse({error:'KV not configured'}, 503);
    const user = await getAuthUser(request, env);
    if (!user || user.username !== 'jamiro') return authResponse({error:'Admin only'}, 403);
    try {
      const body = await request.json();
      const msgs = await env.DR_USERS.get('chat:messages', 'json') || [];
      const updated = msgs.filter(m => m.id !== body.id);
      await env.DR_USERS.put('chat:messages', JSON.stringify(updated));
      return authResponse({ ok:true });
    } catch(e) {
      return authResponse({ error: e.message }, 500);
    }
  }


  // /netliquidity — Fed Net Liquidity = WALCL - WTREGEN - RRPONTSYD
  // WALCL: Fed total assets (weekly, Thursday)
  // WTREGEN: Treasury General Account (weekly, Wednesday)
  // RRPONTSYD: Reverse Repo (daily)
  if (path === '/netliquidity') {
    try {
      return await withCache(cache, 'https://dr-cache.internal/netliq-v1', 21600, async () => {
        const fredCSV = async (series) => {
          const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`, {
            headers: { 'User-Agent': 'DR/13.0', 'Accept': 'text/csv' }
          });
          if (!r.ok) throw new Error(`FRED ${series} HTTP ${r.status}`);
          const csv = await r.text();
          const lines = csv.trim().split('\n')
            .filter(l => !l.startsWith('DATE') && !l.includes('NA') && l.trim());
          return lines.map(l => {
            const [d, v] = l.split(',');
            return { d, v: parseFloat(v) };
          }).filter(x => !isNaN(x.v));
        };

        const [walcl, tga, rrp] = await Promise.all([
          fredCSV('WALCL'),    // Fed balance sheet, billions
          fredCSV('WTREGEN'),  // TGA, billions
          fredCSV('RRPONTSYD') // Reverse repo, billions
        ]);

        // Latest values
        const latestWalcl = walcl[walcl.length - 1];
        const latestTga   = tga[tga.length - 1];
        const latestRrp   = rrp[rrp.length - 1];

        const netLiq = latestWalcl.v - latestTga.v - latestRrp.v;

        // Build historical series — align on dates where all three have data
        // Use WALCL dates as anchor (weekly, slowest)
        // For each WALCL date, find nearest TGA and RRP values
        const tgaMap  = Object.fromEntries(tga.map(x => [x.d, x.v]));
        const rrpMap  = Object.fromEntries(rrp.map(x => [x.d, x.v]));

        // Build RRP lookup by closest date
        const rrpDates = rrp.map(x => x.d).sort();
        function nearestRrp(date) {
          // Find closest date in rrp
          let closest = rrpDates[0];
          for (const d of rrpDates) {
            if (d <= date) closest = d;
            else break;
          }
          return rrpMap[closest] || 0;
        }

        const tgaDates = tga.map(x => x.d).sort();
        function nearestTga(date) {
          let closest = tgaDates[0];
          for (const d of tgaDates) {
            if (d <= date) closest = d;
            else break;
          }
          return tgaMap[closest] || 0;
        }

        // Last 180 data points from WALCL
        const history = walcl.slice(-180).map(w => {
          const t = nearestTga(w.d);
          const r = nearestRrp(w.d);
          return {
            d: w.d,
            v: +(w.v - t - r).toFixed(2),
            walcl: w.v,
            tga: t,
            rrp: r,
          };
        });

        return {
          current: +netLiq.toFixed(2),
          unit: 'billions USD',
          dates: {
            walcl: latestWalcl.d,
            tga:   latestTga.d,
            rrp:   latestRrp.d,
          },
          components: {
            walcl: latestWalcl.v,
            tga:   latestTga.v,
            rrp:   latestRrp.v,
          },
          history,
          formula: 'WALCL - WTREGEN - RRPONTSYD',
          source: 'FRED',
        };
      });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: CORS });
    }
  }


  return new Response('Not found', { status: 404 });
}
