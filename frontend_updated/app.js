/* =====================================================================
   CASCADE SALVAGE: app.js
   Vanilla JS, no dependencies. Talks to the FastAPI backend in
   backend/main.py and never invents results:
     - LIVE      /api/health says optimizer_available: true
     - FALLBACK  the API answers but its optimizer did not import, so
                 results are the backend's own hard-coded mock
     - DEMO      saved snapshots of the real engine (demo-snapshots.js),
                 only when the user asks for them (button or ?mock=1)
     - OFFLINE   the API cannot be reached
   URL options: ?api=http://127.0.0.1:8000   ?mock=1   ?autorun=1
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1. Configuration and contract constants
     ------------------------------------------------------------------ */
  const params = new URLSearchParams(location.search);
  const CONFIG = {
    API_BASE_URL: (params.get('api') || 'http://localhost:8000').replace(/\/+$/, ''),
    TIMEOUT: { health: 4000, data: 8000, run: 25000 },
    DELAYS: [2, 4, 6, 8, 12],
    DEFAULT_JAM: { dest: 'ALL', delay: 6 },
    FORCE_DEMO: params.get('mock') === '1' || params.get('demo') === '1',
    AUTORUN: params.get('autorun') === '1'
  };
  // Exactly the routes, methods and bodies defined in backend/main.py
  const ENDPOINTS = {
    health: ['GET', '/api/health'],
    data: ['GET', '/api/data'],
    stats: ['GET', '/api/stats'],
    optimize: ['POST', '/api/optimize'],          // body: { delay_hrs?: float = 0 }
    disrupt: ['POST', '/api/simulate-disruption'] // body: { delay_hrs: float, disruption_type: str, affected_dest_id?: str|null }
  };
  const TIERS = ['Tier 1 - Premium Retail', 'Tier 2 - Rapid Mandi', 'Tier 3 - Processing Plant'];
  const TIER_INFO = {
    'Tier 1 - Premium Retail': { key: 't1', n: 1, short: 'Premium retail', color: '#b3d4ff' },
    'Tier 2 - Rapid Mandi': { key: 't2', n: 2, short: 'Rapid mandi', color: '#7b95ff' },
    'Tier 3 - Processing Plant': { key: 't3', n: 3, short: 'Processing plant', color: '#7a5cf0' }
  };
  const LOST = { key: 'lost', short: 'Unallocated', color: '#ff7461' };
  const SC = {
    conv: { label: 'Conventional dispatch', cond: 'Normal routes', color: '#7d8ca3', fill: 'repeating-linear-gradient(135deg,#7d8ca3 0 3px,rgba(125,140,163,.35) 3px 6px)' },
    plan: { label: 'Cascade plan', cond: 'Normal routes', color: '#2ccbe6', fill: '#2ccbe6' },
    convJam: { label: 'Conventional under jam', cond: 'With the jam', color: '#ff7461', fill: 'repeating-linear-gradient(135deg,#ff7461 0 3px,rgba(255,116,97,.3) 3px 6px)' },
    replan: { label: 'Cascade re-plan', cond: 'With the jam', color: '#4fe0a8', fill: '#4fe0a8' }
  };
  const SC_ORDER = ['conv', 'plan', 'convJam', 'replan'];
  const PAIRS = {
    planVsConv: { a: 'conv', b: 'plan', label: 'Plan vs conventional' },
    jamImpact: { a: 'plan', b: 'replan', label: 'What the jam changed' },
    replanVsConv: { a: 'convJam', b: 'replan', label: 'Re-plan vs conventional, both jammed' }
  };
  const COMMODITY_COLORS = [
    [/tomato/i, '#f2402f'], [/capsicum|pepper/i, '#34c26a'], [/banana/i, '#ffd23f'],
    [/onion/i, '#c2417a'], [/spinach|leaf|green/i, '#1f9d55'], [/mango/i, '#ffb03b']
  ];
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };
  const DEMO = window.CASCADE_DEMO || null;

  /* ------------------------------------------------------------------
     2. Utilities: formatting, DOM and SVG builders
     ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const NA = 'N/A';
  const MINUS = '−';
  const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (v) => (isNum(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
  const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : (isNum(v) ? String(v) : null));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sum = (arr, f) => arr.reduce((acc, x) => acc + (num(f(x)) || 0), 0);
  const neg = (s) => s.replace(/^-/, MINUS);
  const fmtNum = (v, d = 0) => (isNum(v) ? neg((d ? nf1 : nf0).format(d ? v : Math.round(v))) : NA);
  const fmtKg = (v) => (isNum(v) ? fmtNum(v) + ' kg' : NA);
  const fmtINR = (v) => (isNum(v) ? (v < 0 ? MINUS : '') + '₹' + nf0.format(Math.abs(Math.round(v))) : NA);
  const fmtINR2 = (v) => (isNum(v) ? '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v) : NA);
  const fmtPct = (v) => (isNum(v) ? neg(nf1.format(v)) + '%' : NA);
  const fmtHrs = (v) => (isNum(v) ? neg(nf1.format(v)) + ' h' : NA);
  const fmtCompactINR = (v) => {
    if (!isNum(v)) return NA;
    const a = Math.abs(v), s = v < 0 ? MINUS : '';
    if (a >= 1e7) return s + '₹' + nf1.format(a / 1e7) + ' Cr';
    if (a >= 1e5) return s + '₹' + nf1.format(a / 1e5) + ' L';
    if (a >= 1e3) return s + '₹' + nf1.format(a / 1e3) + 'K';
    return s + '₹' + nf0.format(a);
  };
  const fmtCompact = (v) => (!isNum(v) ? NA : Math.abs(v) >= 1000 ? nf1.format(v / 1000) + 'K' : nf0.format(v));
  const signed = (v, f) => (!isNum(v) ? NA : v > 0 ? '+' + f(v) : v < 0 ? MINUS + f(-v) : '±' + f(0));
  const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const plural = (n, word) => n + ' ' + (n === 1 ? word : word.replace(/(ch|sh|s|x)$/, '$1e') + 's');
  const shortName = (s, n = 26) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);
  const commodityColor = (c) => { for (const [re, col] of COMMODITY_COLORS) if (re.test(c || '')) return col; return '#9fb3c8'; };
  const tierInfo = (t) => TIER_INFO[t] || null;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Safe DOM builder. Strings become text nodes; never use innerHTML with API data.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    appendKids(el, kids);
    return el;
  }
  function appendKids(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'class') el.setAttribute('class', v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    appendKids(el, kids);
    return el;
  }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }
  const ICON = {
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    live: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    ok: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>',
    disc: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4 4 12"/><circle cx="4.5" cy="4.5" r="1.8"/><circle cx="11.5" cy="11.5" r="1.8"/></svg>',
    saved: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a5 5 0 1 0 1.5-4.5"/><path d="M3 3v3h3"/></svg>',
    lost: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>'
  };
  function iconEl(name) { const span = h('span', { class: 'notice-icon', 'aria-hidden': 'true' }); span.innerHTML = ICON[name] || ''; return span; }
  function statusEl(status) {
    const st = str(status) || NA;
    const cls = st === 'OPTIMAL' ? 'ok' : st === 'SAVED' ? 'saved' : st === 'DISCOUNTED' ? 'disc' : st === 'SPOILED' ? 'lost' : 'other';
    const label = { OPTIMAL: 'Optimal', SAVED: 'Saved', DISCOUNTED: 'Discounted', SPOILED: 'Spoiled' }[st] || st;
    const el = h('span', { class: 'status ' + cls });
    const ic = h('span', { 'aria-hidden': 'true' }); ic.innerHTML = ICON[cls] || ''; el.appendChild(ic);
    el.appendChild(document.createTextNode(label));
    return el;
  }
  function tierTag(tier, spoiled) {
    if (spoiled) return h('span', { class: 'tag lost' }, 'Unallocated');
    const ti = tierInfo(tier);
    return h('span', { class: 'tag ' + (ti ? ti.key : '') }, ti ? ti.short : (str(tier) || NA));
  }
  const ACTION_LABEL = { PREMIUM_DISPATCH: 'Premium dispatch', PREMIUM_SALE: 'Premium sale', DYNAMIC_DISCOUNT_DISPATCH: 'Discount dispatch', SALVAGE_RECOVERY: 'Salvage recovery', SPOILED_DISPOSAL: 'Disposal' };
  const actionLabel = (a) => ACTION_LABEL[a] || (str(a) || NA);

  /* ------------------------------------------------------------------
     3. State
     ------------------------------------------------------------------ */
  const state = {
    mode: 'checking',            // checking | live | fallback | demo | offline
    health: null,
    data: null,                  // { batches, destinations, routes }
    dataAt: null,
    stats: null,
    plan: null,                  // { payload, source, at, body, routesUsed, onDrift }
    jam: null,                   // { payload, source, at, body, sel, routesBefore }
    jamSel: { dest: CONFIG.DEFAULT_JAM.dest, delay: CONFIG.DEFAULT_JAM.delay },
    integrity: null,             // { state: 'ok'|'drift'|'unknown', items, when }
    bootDrift: [],
    runError: null,              // last failed run, shown in the banner
    lens: 'plan',
    pair: 'planVsConv', pickA: 'conv', pickB: 'plan', cmpView: 'side',
    tierMeasure: 'kg', tierHidden: new Set(), destSort: 'fill', routeMeasure: 'hrs',
    ex: { tab: 'alloc', q: '', tier: '', status: '', sort: { alloc: ['batch_id', 1], batch: ['shelf_life_hrs', 1], dest: ['dest_id', 1], route: ['route_id', 1] } },
    busy: { plan: false, jam: false, connect: false },
    netSelected: null
  };

  /* ------------------------------------------------------------------
     4. API layer
     ------------------------------------------------------------------ */
  function apiError(kind, info) { const e = new Error(kind); e.kind = kind; Object.assign(e, info || {}); return e; }
  function extractDetail(json, text) {
    if (json && typeof json === 'object') {
      const d = json.detail;
      if (typeof d === 'string') return d;
      if (Array.isArray(d)) return d.map((x) => { const loc = Array.isArray(x.loc) ? x.loc.filter((p) => p !== 'body').join('.') : ''; return (loc ? loc + ': ' : '') + (x.msg || 'invalid'); }).join('; ');
    }
    return text ? String(text).slice(0, 200) : '';
  }
  async function request(name, body, opts = {}) {
    if (state.mode === 'demo') return demoRequest(name, body);
    const [method, path] = ENDPOINTS[name];
    const url = CONFIG.API_BASE_URL + path;
    const ctrl = new AbortController();
    const timeout = opts.timeout || CONFIG.TIMEOUT.data;
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(url, {
        method, cache: 'no-store', signal: ctrl.signal,
        headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      clearTimeout(timer);
      throw apiError(e && e.name === 'AbortError' ? 'timeout' : 'network', { url, method, path, timeout });
    }
    clearTimeout(timer);
    let text = '';
    try { text = await res.text(); } catch (e) { /* empty body */ }
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { json = undefined; } }
    if (!res.ok) throw apiError('http', { status: res.status, detail: extractDetail(json, text), url, method, path });
    if (json === undefined || json === null) throw apiError('parse', { url, method, path });
    return json;
  }
  function knownBackendHint(detail) {
    if (/has no attribute 'optimize'/.test(detail || '')) return 'backend/main.py calls optimizer.optimize(), which this version of engine/optimizer.py does not define. Add the alias optimize = run_cascade_optimization to CascadeOptimizer (newer copies of the repo already have it).';
    return '';
  }
  function describeError(e) {
    const base = CONFIG.API_BASE_URL;
    if (!e || !e.kind) return { title: 'Something went wrong', message: String(e && e.message || e), hint: '' };
    switch (e.kind) {
      case 'network': return {
        title: "Can't reach the API",
        message: 'No response from ' + base + (e.path || '') + '.',
        hint: 'Start the backend from the repo root with  uvicorn backend.main:app --port 8000' + (location.protocol === 'file:' ? ', and serve this page over http (python -m http.server 5500) because some browsers block requests from file:// pages.' : '.')
      };
      case 'timeout': return { title: 'The API took too long', message: (e.path || 'The request') + ' did not answer within ' + Math.round((e.timeout || 0) / 1000) + ' s.', hint: 'Check the backend terminal for errors, then retry.' };
      case 'http': {
        const hint = knownBackendHint(e.detail);
        if (e.status === 422) return { title: 'The API rejected the request', message: e.detail || 'Validation error (422).', hint: '' };
        if (e.status === 404) return { title: 'Endpoint not found', message: e.path + ' returned 404 at ' + base + '.', hint: 'Check the API address (add ?api=http://host:port to the page URL).' };
        return { title: 'The API returned an error (' + e.status + ')', message: e.detail || 'No detail was given.', hint };
      }
      case 'parse': return { title: 'Unreadable response', message: (e.path || 'The API') + ' did not return JSON.', hint: '' };
      case 'invalid': return { title: 'Unexpected response shape', message: e.detail || 'The response does not match the API contract.', hint: 'Nothing was changed on screen.' };
      case 'demo_missing': return { title: 'No snapshot for that scenario', message: e.detail || '', hint: 'Pick one of the listed delays.' };
      default: return { title: 'Something went wrong', message: e.message || '', hint: '' };
    }
  }

  /* Demo layer: serves saved engine snapshots with the same response shapes. Only used in DEMO mode. */
  const demoAvailable = () => !!(DEMO && DEMO.optimize && DEMO.data && DEMO.disruptions && DEMO.results);
  function demoRequest(name, body) {
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const wait = reduceMotion.matches ? 80 : (name === 'optimize' || name === 'disrupt') ? 700 : 200;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!demoAvailable()) return reject(apiError('demo_missing', { detail: 'demo-snapshots.js did not load.' }));
        if (name === 'health') return resolve(clone(DEMO.health));
        if (name === 'data') return resolve(clone(DEMO.data));
        if (name === 'stats') return resolve(clone(DEMO.stats));
        if (name === 'optimize') return resolve(clone(DEMO.optimize));
        if (name === 'disrupt') {
          const key = (body && body.affected_dest_id ? body.affected_dest_id : 'ALL') + '|' + Number(body && body.delay_hrs);
          const entry = DEMO.disruptions[key];
          if (!entry || !DEMO.results[entry.result]) return reject(apiError('demo_missing', { detail: 'Demo snapshots cover delays of ' + CONFIG.DELAYS.join(', ') + ' h on each corridor.' }));
          const r = clone(DEMO.results[entry.result]);
          r.disruption = Object.assign(clone(entry.disruption), { baseline_metrics: clone(DEMO.optimize.metrics) });
          return resolve(r);
        }
        reject(apiError('http', { status: 404, detail: 'Not Found', path: '' }));
      }, wait);
    });
  }

  /* ------------------------------------------------------------------
     5. Validation and derived data
     ------------------------------------------------------------------ */
  function validateRun(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 'The response is not a JSON object.';
    if (!Array.isArray(p.allocations)) return 'The response has no "allocations" list.';
    if (!p.metrics || typeof p.metrics !== 'object' || Array.isArray(p.metrics)) return 'The response has no "metrics" object.';
    return null;
  }
  function normalizeData(d) {
    const arr = (x) => (Array.isArray(x) ? x.filter((o) => o && typeof o === 'object') : []);
    return { batches: arr(d && d.batches), destinations: arr(d && d.destinations), routes: arr(d && d.routes) };
  }
  function readMetrics(m) {
    m = m || {};
    return {
      bSpoilKg: num(m.baseline_spoilage_kg), bSpoilPct: num(m.baseline_spoilage_pct), bRev: num(m.baseline_net_revenue),
      oSpoilKg: num(m.optimized_spoilage_kg), oSpoilPct: num(m.optimized_spoilage_pct), oRev: num(m.optimized_net_revenue),
      redPct: num(m.spoilage_reduction_pct), gainPct: num(m.revenue_gain_pct), fulfilPct: num(m.demand_fulfillment_pct)
    };
  }
  function ctx() {
    const d = state.data || { batches: [], destinations: [], routes: [] };
    const byId = (list, key) => { const m = new Map(); list.forEach((o) => { const k = str(o[key]); if (k) m.set(k, o); }); return m; };
    const batchById = byId(d.batches, 'batch_id');
    const destById = byId(d.destinations, 'dest_id');
    const routeById = byId(d.routes, 'route_id');
    const routeByDest = byId(d.routes, 'dest_id');
    return { batches: d.batches, dests: d.destinations, routes: d.routes, batchById, destById, routeById, routeByDest };
  }
  function buildRows(result) {
    if (!result) return [];
    const c = ctx();
    return result.payload.allocations.map((a, i) => {
      a = a && typeof a === 'object' ? a : {};
      const batch_id = str(a.batch_id), dest_id = str(a.dest_id), status = str(a.status), action = str(a.action);
      const allocated = num(a.allocated_kg);
      const spoiled = status === 'SPOILED' || action === 'SPOILED_DISPOSAL' || dest_id === 'NONE';
      const b = batch_id ? c.batchById.get(batch_id) : null;
      const d = dest_id ? c.destById.get(dest_id) : null;
      const qty = b ? num(b.quantity_kg) : null;
      const shortfall = !spoiled && isNum(qty) && isNum(allocated) && qty - allocated > 0.05 ? qty - allocated : 0;
      return {
        idx: i, raw: a, batch_id, dest_id, status, action, spoiled, shortfall,
        commodity: str(a.commodity) || (b && str(b.commodity)), dest_name: str(a.dest_name) || (d && str(d.name)),
        tier: str(a.tier), tierKey: spoiled ? 'lost' : ((tierInfo(a.tier) || {}).key || 'other'),
        allocated_kg: allocated, discount_pct: num(a.discount_pct), effective_price_per_kg: num(a.effective_price_per_kg),
        transport_cost_per_kg: num(a.transport_cost_per_kg), net_profit: num(a.net_profit), margin_hrs: num(a.margin_hrs),
        reasoning: typeof a.reasoning === 'string' ? a.reasoning : null,
        batch: b, dest: d, qty, shelf: b ? num(b.shelf_life_hrs) : null, unknownDest: !spoiled && dest_id && !d
      };
    });
  }
  const resultFor = (lens) => (lens === 'replan' ? state.jam : state.plan);
  const lensResult = () => resultFor(state.lens);
  function jamInfo(result) {
    const r = result || state.jam;
    if (!r) return null;
    const d = r.payload.disruption || {};
    const sel = r.sel || {};
    const delay = num(d.delay_hrs) !== null ? num(d.delay_hrs) : sel.delay;
    const aff = str(d.affected_dest_id) || (sel.dest || 'ALL');
    return { delay, aff, type: str(d.type) || 'HIGHWAY_JAM' };
  }
  function jamDelayFor(destId, result) {
    const j = jamInfo(result);
    if (!j || !isNum(j.delay)) return 0;
    return j.aff === 'ALL' || j.aff === destId ? j.delay : 0;
  }
  function corridorLabel(aff) {
    if (!aff || aff === 'ALL') return 'every corridor';
    const c = ctx(); const r = c.routeByDest.get(aff); const d = c.destById.get(aff);
    return (r ? str(r.route_id) + ' to ' : '') + (d ? str(d.name) : aff);
  }
  // Scenario metrics, only from API responses
  function scenarios() {
    const out = {};
    const pm = state.plan ? readMetrics(state.plan.payload.metrics) : null;
    const pre = state.jam && state.jam.payload.disruption && state.jam.payload.disruption.baseline_metrics ? readMetrics(state.jam.payload.disruption.baseline_metrics) : null;
    const normal = pm || pre;
    const normalSrc = pm ? state.plan : state.jam;
    if (normal) {
      out.conv = { key: 'conv', spoilKg: normal.bSpoilKg, spoilPct: normal.bSpoilPct, rev: normal.bRev, fulfil: null, rows: null, src: normalSrc, from: pm ? 'POST /api/optimize: metrics.baseline_*' : 'disruption.baseline_metrics.baseline_*' };
      out.plan = { key: 'plan', spoilKg: normal.oSpoilKg, spoilPct: normal.oSpoilPct, rev: normal.oRev, fulfil: normal.fulfilPct, rows: pm ? buildRows(state.plan) : null, src: normalSrc, from: pm ? 'POST /api/optimize: metrics.optimized_*' : 'disruption.baseline_metrics.optimized_*' };
    }
    if (state.jam) {
      const jm = readMetrics(state.jam.payload.metrics);
      out.convJam = { key: 'convJam', spoilKg: jm.bSpoilKg, spoilPct: jm.bSpoilPct, rev: jm.bRev, fulfil: null, rows: null, src: state.jam, from: 'POST /api/simulate-disruption: metrics.baseline_*' };
      out.replan = { key: 'replan', spoilKg: jm.oSpoilKg, spoilPct: jm.oSpoilPct, rev: jm.oRev, fulfil: jm.fulfilPct, rows: buildRows(state.jam), src: state.jam, from: 'POST /api/simulate-disruption: metrics.optimized_*' };
    }
    return out;
  }
  // Did the pre-jam metrics returned by the disruption call differ from the plan run earlier?
  function preJamMismatch() {
    if (!state.plan || !state.jam || !state.jam.payload.disruption || !state.jam.payload.disruption.baseline_metrics) return false;
    const a = readMetrics(state.plan.payload.metrics), b = readMetrics(state.jam.payload.disruption.baseline_metrics);
    return ['oSpoilKg', 'oRev', 'bSpoilKg', 'bRev'].some((k) => isNum(a[k]) && isNum(b[k]) && Math.abs(a[k] - b[k]) > 0.5);
  }
  function computeChanges(rowsA, rowsB) {
    const mA = new Map(rowsA.map((r) => [r.batch_id, r])), mB = new Map(rowsB.map((r) => [r.batch_id, r]));
    const ids = Array.from(new Set([...mA.keys(), ...mB.keys()])).filter(Boolean).sort();
    const out = [];
    ids.forEach((id) => {
      const a = mA.get(id), b = mB.get(id);
      if (!a || !b) { out.push({ id, kind: !b ? 'missing' : 'new', a, b }); return; }
      if (!a.spoiled && b.spoiled) out.push({ id, kind: 'lost', a, b });
      else if (a.spoiled && !b.spoiled) out.push({ id, kind: 'recovered', a, b });
      else if (a.dest_id !== b.dest_id) out.push({ id, kind: 'moved', a, b });
      else if (isNum(a.allocated_kg) && isNum(b.allocated_kg) && Math.abs(a.allocated_kg - b.allocated_kg) > 0.05) out.push({ id, kind: 'qty', a, b });
      else {
        const dm = isNum(a.margin_hrs) && isNum(b.margin_hrs) ? b.margin_hrs - a.margin_hrs : 0;
        const dp = isNum(a.net_profit) && isNum(b.net_profit) ? b.net_profit - a.net_profit : 0;
        const dd = isNum(a.discount_pct) && isNum(b.discount_pct) ? b.discount_pct - a.discount_pct : 0;
        if (Math.abs(dp) > 0.5 || Math.abs(dd) > 0.01) out.push({ id, kind: 'terms', a, b, dm, dp, dd });
        else if (Math.abs(dm) > 0.05) out.push({ id, kind: 'margin', a, b, dm });
      }
    });
    const order = { lost: 0, missing: 0, recovered: 1, moved: 2, qty: 3, terms: 4, margin: 5, new: 6 };
    return out.sort((x, y) => order[x.kind] - order[y.kind] || x.id.localeCompare(y.id));
  }
  function sourceNow() { return state.mode === 'demo' ? 'demo' : state.mode === 'fallback' ? 'api_fallback' : 'optimizer'; }
  function sourceText(r) {
    if (!r) return 'No results yet';
    const t = clock(r.at);
    return r.source === 'demo' ? 'Demo snapshot, ' + t : r.source === 'api_fallback' ? 'Backend mock response, ' + t : 'Live optimizer, ' + t;
  }
  function routeDrift(data) {
    // In the shipped data each route's transit_time_hrs equals its destination's listed transit_time_hrs.
    const dm = new Map(data.destinations.map((d) => [str(d.dest_id), d]));
    return data.routes.map((r) => {
      const d = dm.get(str(r.dest_id));
      const rt = num(r.transit_time_hrs), dt = d ? num(d.transit_time_hrs) : null;
      return isNum(rt) && isNum(dt) && Math.abs(rt - dt) > 0.01 ? { route_id: str(r.route_id), dest_id: str(r.dest_id), name: d ? str(d.name) : '', now: rt, listed: dt } : null;
    }).filter(Boolean);
  }
  const copyRoutes = (routes) => (routes || []).map((r) => ({ route_id: str(r.route_id), dest_id: str(r.dest_id), transit_time_hrs: num(r.transit_time_hrs) }));

  /* ------------------------------------------------------------------
     6. Flows: connect, load, plan, jam, demo, reset
     ------------------------------------------------------------------ */
  async function connect(opts = {}) {
    if (state.busy.connect) return false;
    state.busy.connect = true;
    const btn = $('#reconnectBtn'); btn.classList.add('is-spinning'); btn.disabled = true;
    const wasDemo = state.mode === 'demo';
    if (wasDemo) { state.plan = null; state.jam = null; state.integrity = null; state.lens = 'plan'; }
    setMode('checking');
    try {
      const health = await request('health', undefined, { timeout: CONFIG.TIMEOUT.health });
      if (!health || typeof health !== 'object') throw apiError('invalid', { detail: '/api/health did not return an object.' });
      state.health = health;
      setMode(health.optimizer_available === false ? 'fallback' : 'live');
      state.runError = null;
      await loadContext();
      if (!opts.quiet) toast(state.mode === 'live' ? 'success' : 'warn', state.mode === 'live' ? 'Connected to the live API' : 'Connected, optimizer not loaded', state.mode === 'live' ? CONFIG.API_BASE_URL + ' is serving the optimizer.' : 'The API is up but reports optimizer_available: false. Results will be its built-in mock.');
      return true;
    } catch (e) {
      state.health = null;
      state.data = null; state.stats = null;
      setMode('offline');
      state.connectError = e;
      renderAll();
      if (!opts.quiet) { const d = describeError(e); toast('error', d.title, d.message, demoAvailable() ? [{ label: 'Explore demo data', fn: () => enterDemo() }] : null); }
      penguin.react('worried'); penguin.say("I can't reach the API. The demo still works.");
      return false;
    } finally {
      state.busy.connect = false; btn.classList.remove('is-spinning'); btn.disabled = false;
    }
  }
  async function loadContext() {
    const [d, st] = await Promise.allSettled([request('data'), request('stats')]);
    if (d.status === 'fulfilled' && d.value && typeof d.value === 'object') {
      state.data = normalizeData(d.value); state.dataAt = new Date();
      state.bootDrift = state.mode === 'demo' ? [] : routeDrift(state.data);
      if (state.bootDrift.length && !state.integrity) state.integrity = { state: 'drift', items: state.bootDrift.map((x) => ({ ...x, before: x.listed })), when: 'load' };
    } else {
      state.data = null;
      const e = d.reason; const ds = describeError(e);
      toast('error', 'Could not load inventory', ds.message);
    }
    state.stats = st.status === 'fulfilled' && st.value && typeof st.value === 'object' ? st.value : null;
    renderAll();
  }
  function setBusy(which, on) {
    state.busy[which] = on;
    const btn = which === 'plan' ? $('#runPlanBtn') : $('#runJamBtn');
    btn.classList.toggle('is-busy', on); btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false');
    const t = btn.querySelector('.btn-text');
    if (on) { btn.dataset.idle = t.textContent; t.textContent = btn.dataset.busy; } else if (btn.dataset.idle) { t.textContent = btn.dataset.idle; }
    $('#heroRunBtn').disabled = state.busy.plan;
    $$('.viz-body').forEach((v) => v.classList.toggle('is-stale', state.busy.plan || state.busy.jam));
    if (!on) renderConsole();
  }
  function flashDone(btn) { btn.classList.remove('is-done'); void btn.offsetWidth; btn.classList.add('is-done'); setTimeout(() => btn.classList.remove('is-done'), 1000); }
  async function ensureConnected() {
    if (state.mode === 'live' || state.mode === 'fallback' || state.mode === 'demo') return true;
    return connect({ quiet: true });
  }
  async function runPlan() {
    if (state.busy.plan) return;
    if (!(await ensureConnected())) { showOfflineToast(); return; }
    const scEl = $('#scenarioSelect');
    const selectedScenario = scEl ? scEl.value : 'default';
    if (selectedScenario === 'rain_delay') {
      penguin.react('shiver');
      penguin.say('Monsoon flood alert! Western Ghats highways waterlogged (+14h delay). Salvaging to processing…', 3500);
    } else if (selectedScenario === 'harvest_glut') {
      penguin.react('cheer');
      penguin.say('Bumper harvest surplus! Diverting 19,000 kg produce glut to processing plants…', 3500);
    } else {
      penguin.react('think');
      penguin.say('Checking every batch against every buyer…', 2500);
    }
    const body = { delay_hrs: 0 };
    if (selectedScenario && selectedScenario !== 'default') body.scenario = selectedScenario;
    const routesUsed = copyRoutes(state.data && state.data.routes);
    try {
      const p = await request('optimize', body, { timeout: CONFIG.TIMEOUT.run });
      const err = validateRun(p); if (err) throw apiError('invalid', { detail: err, path: ENDPOINTS.optimize[1] });
      state.plan = { payload: p, source: sourceNow(), at: new Date(), body, routesUsed, onDrift: !!(state.integrity && state.integrity.state === 'drift') };
      state.runError = null;
      if (!state.jam) choosePair('planVsConv');
      renderAll();
      flashDone($('#runPlanBtn'));
      const sc = scenarios(); const avoided = isNum(sc.conv.spoilKg) && isNum(sc.plan.spoilKg) ? sc.conv.spoilKg - sc.plan.spoilKg : null;
      toast(state.plan.source === 'demo' ? 'demo' : state.plan.source === 'api_fallback' ? 'warn' : 'success', 'Plan ready',
        plural(p.allocations.length, 'allocation') + '. Spoilage ' + fmtKg(sc.conv.spoilKg) + ' → ' + fmtKg(sc.plan.spoilKg) + ' against conventional dispatch.' + (state.plan.source === 'api_fallback' ? ' (Backend mock, not the optimizer.)' : state.plan.source === 'demo' ? ' (Demo snapshot.)' : ''));
      penguin.react('cheer');
      penguin.say(isNum(avoided) && avoided > 0 ? fmtKg(avoided) + ' less spoilage than conventional dispatch!' : 'Plan ready. Have a look at what changed.');
    } catch (e) { handleRunError(e, 'plan'); }
    finally { setBusy('plan', false); }
  }
  async function runJam() {
    if (state.busy.jam) return;
    if (!(await ensureConnected())) { showOfflineToast(); return; }
    const sel = { ...state.jamSel };
    const body = { delay_hrs: sel.delay, disruption_type: 'HIGHWAY_JAM', affected_dest_id: sel.dest === 'ALL' ? null : sel.dest };
    setBusy('jam', true);
    penguin.react('shiver'); penguin.say('+' + sel.delay + ' h on ' + corridorLabel(sel.dest) + '. Re-planning…', 2600);
    const routesBefore = copyRoutes(state.data && state.data.routes);
    try {
      const p = await request('disrupt', body, { timeout: CONFIG.TIMEOUT.run });
      const err = validateRun(p); if (err) throw apiError('invalid', { detail: err, path: ENDPOINTS.disrupt[1] });
      state.jam = { payload: p, source: sourceNow(), at: new Date(), body, sel, routesBefore };
      state.runError = null;
      choosePair(state.plan ? 'jamImpact' : 'replanVsConv');
      renderAll();
      flashDone($('#runJamBtn'));
      await verifyIntegrity(routesBefore);
      renderLab(); renderStudio(); renderNetwork(); renderExplorer();
      const sc = scenarios();
      const changes = state.plan ? computeChanges(sc.plan.rows || [], sc.replan.rows || []) : [];
      const lost = (sc.replan.rows || []).filter((r) => r.spoiled).length;
      const moved = changes.filter((c) => c.kind === 'moved' || c.kind === 'qty').length;
      toast(state.jam.source === 'demo' ? 'demo' : 'success', 'Re-plan ready',
        'With +' + sel.delay + ' h on ' + corridorLabel(sel.dest) + ', modelled spoilage is ' + fmtKg(sc.replan.spoilKg) + ' (conventional: ' + fmtKg(sc.convJam.spoilKg) + ').');
      const extra = state.plan && isNum(sc.replan.spoilKg) && isNum(sc.plan.spoilKg) ? sc.replan.spoilKg - sc.plan.spoilKg : null;
      const savedVsConv = isNum(sc.convJam.spoilKg) && isNum(sc.replan.spoilKg) ? sc.convJam.spoilKg - sc.replan.spoilKg : null;
      if (state.plan && changes.filter((c) => c.kind !== 'margin').length === 0 && !(extra > 0)) { penguin.react('cheer'); penguin.say('The plan absorbs this jam. No batch has to move.'); }
      else if (extra > 0) { penguin.react('worried'); penguin.say((lost ? plural(lost, 'batch') + ' lost its buyer. ' : moved ? plural(moved, 'batch') + ' re-routed. ' : '') + 'Spoilage rises by ' + fmtKg(extra) + (savedVsConv > 0 ? ', still ' + fmtKg(savedVsConv) + ' less than conventional.' : '.')); }
      else { penguin.react('cheer'); penguin.say(moved ? plural(moved, 'batch') + ' re-routed with no extra spoilage.' : 'Re-plan ready.'); }
    } catch (e) { handleRunError(e, 'jam'); }
    finally { setBusy('jam', false); }
  }
  async function verifyIntegrity(routesBefore) {
    if (state.mode === 'demo') { state.integrity = { state: 'ok', demo: true }; return; }
    try {
      const d = normalizeData(await request('data'));
      state.data = d; state.dataAt = new Date();
      const before = new Map((routesBefore || []).map((r) => [r.route_id, r.transit_time_hrs]));
      const changed = d.routes.map((r) => {
        const id = str(r.route_id), now = num(r.transit_time_hrs), was = before.get(id);
        return isNum(now) && isNum(was) && Math.abs(now - was) > 0.01 ? { route_id: id, dest_id: str(r.dest_id), now, before: was } : null;
      }).filter(Boolean);
      const drift = routeDrift(d);
      if (changed.length || drift.length) {
        const items = changed.length ? changed : drift.map((x) => ({ ...x, before: x.listed }));
        state.integrity = { state: 'drift', items, when: changed.length ? 'jam' : 'earlier' };
        toast('warn', 'Server route data changed', 'GET /api/data now reports slower routes. Later runs will include this delay until the backend restarts.');
      } else state.integrity = { state: 'ok', when: 'jam' };
    } catch (e) { state.integrity = { state: 'unknown' }; }
  }
  function handleRunError(e, which) {
    const d = describeError(e);
    state.runError = { ...d, which, at: new Date() };
    renderBanner();
    toast('error', d.title, d.message + (d.hint ? ' ' + d.hint : ''), [{ label: 'Retry', fn: which === 'plan' ? runPlan : runJam }]);
    penguin.react('worried'); penguin.say(which === 'plan' ? 'That plan request failed. Nothing on screen changed.' : 'The jam request failed. The previous results are untouched.');
    if (e.kind === 'network' || e.kind === 'timeout') connect({ quiet: true });
  }
  function showOfflineToast() {
    const d = describeError(state.connectError || apiError('network', { path: '/api/health' }));
    toast('error', d.title, d.hint || d.message, demoAvailable() ? [{ label: 'Explore demo data', fn: () => enterDemo().then(() => runPlan()) }] : null);
  }
  async function enterDemo() {
    if (!demoAvailable()) { toast('error', 'Demo data missing', 'demo-snapshots.js did not load, so demo mode is unavailable.'); return; }
    state.plan = null; state.jam = null; state.integrity = null; state.runError = null; state.lens = 'plan'; state.bootDrift = [];
    setMode('demo');
    state.health = await demoRequest('health');
    await loadContext();
    penguin.react('wave'); penguin.say('Demo mode: saved runs of the real engine.');
  }
  function resetLab() {
    state.plan = null; state.jam = null; state.runError = null; state.lens = 'plan';
    state.jamSel = { ...CONFIG.DEFAULT_JAM };
    state.pair = 'planVsConv'; state.pickA = 'conv'; state.pickB = 'plan';
    if (state.integrity && state.integrity.state === 'ok') state.integrity = null;
    resetStudioSettings(true);
    state.ex.q = ''; state.ex.tier = ''; state.ex.status = ''; $('#exSearch').value = '';
    renderAll();
    const drift = state.integrity && state.integrity.state === 'drift';
    toast('info', 'Lab reset', drift ? 'Results cleared on this page. The server still has the modified routes; restart the backend to restore them.' : 'Results cleared on this page. Server data is not changed by this button.');
    penguin.say('Fresh start. Run the plan when you are ready.');
  }
  function choosePair(key) { const p = PAIRS[key]; state.pair = key; state.pickA = p.a; state.pickB = p.b; }

  /* ------------------------------------------------------------------
     7. Toasts
     ------------------------------------------------------------------ */
  function toast(tone, title, msg, actions) {
    const region = $('#toasts');
    const el = h('div', { class: 'toast', 'data-tone': tone, role: tone === 'error' ? 'alert' : 'status' },
      h('span', { class: 'toast-dot', 'aria-hidden': 'true' }),
      h('div', null, h('p', { class: 'toast-title', text: title }), msg ? h('p', { class: 'toast-msg', text: msg }) : null,
        actions && actions.length ? h('div', { class: 'toast-actions' }, actions.map((a) => h('button', { type: 'button', class: 'toast-action', text: a.label, onclick: () => { close(); a.fn(); } }))) : null),
      h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', text: '×', onclick: () => close() }));
    let gone = false;
    function close() { if (gone) return; gone = true; el.classList.add('is-leaving'); setTimeout(() => el.remove(), 230); }
    region.appendChild(el);
    while (region.children.length > (window.innerWidth < 720 ? 1 : 2)) region.firstChild.remove();
    setTimeout(close, tone === 'error' ? 10000 : 5200);
  }

  /* ------------------------------------------------------------------
     8. Mode, banner, hero facts
     ------------------------------------------------------------------ */
  function setMode(mode) {
    state.mode = mode;
    const pill = $('#modePill');
    pill.dataset.mode = mode;
    $('#modeLabel').textContent = {
      checking: 'Checking the API…', live: 'Live API', fallback: 'Live API, mock fallback', demo: 'Demo snapshots', offline: 'API offline'
    }[mode];
    pill.title = mode === 'live' ? 'Connected to ' + CONFIG.API_BASE_URL + ' with the optimizer loaded' : mode === 'fallback' ? 'The API reports optimizer_available: false' : mode === 'demo' ? 'Saved snapshots of the real engine, not live' : mode === 'offline' ? 'No response from ' + CONFIG.API_BASE_URL : '';
    document.body.dataset.mode = mode;
    renderBanner();
  }
  function renderBanner() {
    const el = $('#sourceBanner'); clear(el);
    let tone = null, icon = 'info', title = '', text = '', actions = [];
    if (state.runError) {
      tone = 'error'; icon = 'error'; title = state.runError.title + '.'; text = state.runError.message + (state.runError.hint ? ' ' + state.runError.hint : '') + ' Previous results are unchanged.';
      actions = [{ label: 'Retry', cls: 'btn-secondary', fn: state.runError.which === 'plan' ? runPlan : runJam }, { label: 'Dismiss', cls: 'btn-ghost', fn: () => { state.runError = null; renderBanner(); } }];
    } else if (state.mode === 'offline') {
      const d = describeError(state.connectError || apiError('network', { path: '/api/health' }));
      tone = 'error'; icon = 'error'; title = d.title + '.'; text = d.message + ' ' + d.hint;
      actions = [{ label: 'Try again', cls: 'btn-secondary', fn: () => connect() }];
      if (demoAvailable()) actions.push({ label: 'Explore demo data', cls: 'btn-demo', fn: () => enterDemo() });
    } else if (state.mode === 'fallback') {
      tone = 'warn'; icon = 'warn'; title = 'Optimizer not loaded.';
      text = 'The API at ' + CONFIG.API_BASE_URL + ' reports optimizer_available: false, so plans are the backend\'s built-in mock response. They are labelled "Backend mock" everywhere and may reference destinations that are not in the data.';
    } else if (state.mode === 'demo') {
      tone = 'demo'; icon = 'info'; title = 'Demo mode.';
      text = 'These are saved runs of the project\'s own engine on its sample data, not live API responses. Every result is tagged "Demo snapshot".';
      actions = [{ label: 'Use the live API', cls: 'btn-secondary', fn: () => connect() }];
    }
    if (!tone) { el.hidden = true; return; }
    el.dataset.tone = tone;
    el.appendChild(iconEl(icon));
    el.appendChild(h('div', { class: 'notice-text' }, h('strong', { text: title }), ' ', text));
    if (actions.length) el.appendChild(h('div', { class: 'notice-actions' }, actions.map((a) => h('button', { type: 'button', class: 'btn btn-sm ' + a.cls, text: a.label, onclick: a.fn }))));
    el.hidden = false;
  }
  function renderHeroFacts() {
    const set = (k, v) => { const dd = $('#heroFacts [data-fact="' + k + '"]'); if (dd) dd.textContent = v; };
    const st = state.stats, c = ctx();
    const batches = st && st.batches ? st.batches : null;
    const dests = st && st.destinations ? st.destinations : null;
    const nB = batches && isNum(num(batches.count)) ? num(batches.count) : (state.data ? c.batches.length : null);
    const kg = batches && isNum(num(batches.total_kg)) ? num(batches.total_kg) : (state.data ? sum(c.batches, (b) => b.quantity_kg) : null);
    const nD = dests && isNum(num(dests.count)) ? num(dests.count) : (state.data ? c.dests.length : null);
    const sl = batches && batches.shelf_life_hrs ? batches.shelf_life_hrs : null;
    const mn = sl ? num(sl.min) : (state.data && c.batches.length ? Math.min(...c.batches.map((b) => num(b.shelf_life_hrs) || Infinity)) : null);
    const mx = sl ? num(sl.max) : (state.data && c.batches.length ? Math.max(...c.batches.map((b) => num(b.shelf_life_hrs) || 0)) : null);
    set('batches', isNum(nB) ? fmtNum(nB) : '—');
    set('stock', isNum(kg) ? fmtKg(kg) : '—');
    set('dests', isNum(nD) ? fmtNum(nD) : '—');
    set('shelf', isNum(mn) && isNum(mx) ? fmtNum(mn) + '–' + fmtNum(mx) + ' h' : '—');
    const src = $('#heroFactsSource');
    src.textContent = !state.data && !st ? (state.mode === 'checking' ? 'Loading inventory…' : 'Connect the API or open the demo to load the inventory.') :
      state.mode === 'demo' ? 'Demo snapshot of GET /api/stats' : 'From GET /api/stats on ' + CONFIG.API_BASE_URL;
    const run = $('#heroRunBtn');
    run.textContent = state.mode === 'offline' && demoAvailable() ? 'Explore the Rescue Lab with demo data' : 'Run the plan in the Rescue Lab';
  }

  /* ------------------------------------------------------------------
     9. Story
     ------------------------------------------------------------------ */
  let storyStep = 0;
  function renderStory() {
    const list = $('#storyBatches'); clear(list);
    const c = ctx();
    if (!c.batches.length) {
      list.appendChild(h('li', { class: 'chapter-note', text: state.mode === 'checking' ? 'Loading batches…' : 'Connect the API or open the demo to list the batches.' }));
    } else {
      const sorted = c.batches.slice().sort((a, b) => (num(a.shelf_life_hrs) || 0) - (num(b.shelf_life_hrs) || 0)).slice(0, 4);
      const max = Math.max(...c.batches.map((b) => num(b.shelf_life_hrs) || 0), 1);
      sorted.forEach((b) => {
        const hrs = num(b.shelf_life_hrs);
        const bar = h('span'); bar.style.transform = 'scaleX(' + (isNum(hrs) ? hrs / max : 0) + ')';
        list.appendChild(h('li', { class: 'story-batch' },
          h('span', { class: 'id', text: str(b.batch_id) || NA }), h('span', { class: 'bar' }, bar), h('span', { class: 'hrs', text: fmtHrs(hrs) }),
          h('span', { class: 'name', text: (str(b.commodity) || '') + ', ' + fmtKg(num(b.quantity_kg)) + ', grade ' + (str(b.quality_grade) || NA) })));
      });
    }
    const sc = scenarios();
    const bl = $('#storyBaseline'); clear(bl);
    if (sc.conv) {
      bl.appendChild(document.createTextNode('On this inventory the baseline leaves '));
      bl.appendChild(h('strong', { text: fmtKg(sc.conv.spoilKg) + ' (' + fmtPct(sc.conv.spoilPct) + ')' }));
      bl.appendChild(document.createTextNode(' unsold or rejected. The cascade plan leaves ' + fmtKg(sc.plan.spoilKg) + '.'));
    } else if (state.data) {
      bl.appendChild(document.createTextNode('Run the plan in the Rescue Lab to see how much the baseline loses on this inventory.'));
    }
    setStoryStep(storyStep, true);
  }
  function storyChipText(step) {
    const c = ctx(), sc = scenarios();
    if (step === 0 && c.batches.length) { const b = c.batches.slice().sort((x, y) => (num(x.shelf_life_hrs) || 0) - (num(y.shelf_life_hrs) || 0))[0]; return 'Shortest clock: ' + str(b.batch_id) + ', ' + fmtHrs(num(b.shelf_life_hrs)); }
    if (step === 1 && sc.conv) return 'Conventional dispatch: ' + fmtKg(sc.conv.spoilKg) + ' lost';
    if (step === 2 && sc.plan && sc.plan.rows) { const t3 = sum(sc.plan.rows.filter((r) => r.tierKey === 't3'), (r) => r.allocated_kg); return fmtKg(t3) + ' rescued into processing'; }
    if (step === 3) return state.jam ? 'Last jam: +' + jamInfo().delay + ' h on ' + corridorLabel(jamInfo().aff) : 'Try +6 h on every corridor';
    return '';
  }
  function setStoryStep(step, force) {
    if (step === storyStep && !force) return;
    storyStep = step;
    $$('.story-scene').forEach((img) => img.classList.toggle('is-active', Number(img.dataset.scene) === step));
    $$('.story-dots li').forEach((li) => li.classList.toggle('is-active', Number(li.dataset.dot) === step));
    $$('.chapter').forEach((ch) => ch.classList.toggle('is-active', Number(ch.dataset.step) === step));
    $('#storyChip').textContent = storyChipText(step);
  }

  /* ------------------------------------------------------------------
     10. Cold-chain temperature sequence (illustrative)
     ------------------------------------------------------------------ */
  const THERMO = {
    pts: [[0, 30], [1, 31], [1.4, 70], [1.8, 90], [2.2, 95], [3.4, 96], [3.8, 70], [4.4, 35], [5.2, 14], [6.4, 6], [8, 2], [9, -0.6], [13, -1.2], [14.5, -4], [17, -10], [20, -15], [24, -18], [40, -18]],
    tMax: 40, yMin: -30, yMax: 105,
    phases: [
      { name: 'Arrival', t0: 0, t1: 1, temp: '≈ 30 °C', color: '#ffd27a', text: 'Field heat. Leafy greens reach the plant warm, with only hours of shelf life left.' },
      { name: 'Blanch', t0: 1, t1: 3.6, temp: '≈ 95 °C', color: '#ff7a45', text: 'About two minutes near boiling stops the enzymes that make greens wilt and discolour.' },
      { name: 'Quench', t0: 3.6, t1: 8.5, temp: '↓ 4 °C', color: '#5ee3f5', text: 'Ice-cold water ends the cooking at once and pulls the leaves out of the 4–60 °C danger zone.' },
      { name: 'Freezing plateau', t0: 8.5, t1: 14, temp: '≈ −1 °C', color: '#8fb0ff', text: 'Water in the leaves turns to ice. The temperature stalls while that latent heat is removed.' },
      { name: 'Deep freeze', t0: 14, t1: 24, temp: '↓ −18 °C', color: '#5b78f0', text: 'Cold air in the freezer tunnel brings the core down to frozen-storage temperature.' },
      { name: 'Frozen storage', t0: 24, t1: 40, temp: '−18 °C', color: '#3d5bd8', text: 'Held at −18 °C, the salvaged batch keeps for months instead of hours.' }
    ],
    lines: [
      { y: 100, label: 'Water boils, 100 °C', color: '#ff9a6b' },
      { y: 0, label: 'Water freezes, 0 °C', color: '#9fd8ee' },
      { y: -18, label: 'Frozen storage, −18 °C', color: '#7f9bff' }
    ],
    t: 2.6, drawn: false
  };
  // Monotone cubic interpolation (Fritsch–Carlson) so the curve never overshoots
  function monotone(pts) {
    const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const dx = [], m = [], d = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / dx[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / d[i - 1] + (dx[i] + 2 * dx[i - 1]) / d[i]);
    return function (x) {
      x = clamp(x, xs[0], xs[n - 1]);
      let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
      const hh = dx[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
    };
  }
  const thermoF = monotone(THERMO.pts);
  const TEMP_STOPS = [[-30, [29, 47, 143]], [-18, [36, 64, 168]], [-6, [61, 107, 255]], [0, [111, 141, 255]], [4, [94, 227, 245]], [20, [168, 240, 255]], [40, [255, 210, 122]], [70, [255, 190, 85]], [100, [255, 122, 69]]];
  function tempColor(t) {
    for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
      const [a, ca] = TEMP_STOPS[i], [b, cb] = TEMP_STOPS[i + 1];
      if (t <= b) { const k = clamp((t - a) / (b - a), 0, 1); return 'rgb(' + ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(',') + ')'; }
    }
    return 'rgb(255,122,69)';
  }
  const thermoPhaseAt = (t) => THERMO.phases.find((p) => t >= p.t0 && t < p.t1) || THERMO.phases[THERMO.phases.length - 1];
  function renderThermo() {
    const host = $('#thermoChart'); clear(host);
    const W = Math.max(320, host.clientWidth), H = host.clientHeight || 400;
    const m = { l: 58, r: W < 600 ? 14 : 24, t: 30, b: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    // compressed (power) time axis: most of the action happens in the first minutes
    const xs = (t) => m.l + Math.pow(t / THERMO.tMax, 0.6) * iw;
    const xinv = (x) => THERMO.tMax * Math.pow(clamp((x - m.l) / iw, 0, 1), 1 / 0.6);
    const ys = (v) => m.t + (THERMO.yMax - v) / (THERMO.yMax - THERMO.yMin) * ih;
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Illustrative temperature curve of a salvaged batch on a processing line' });
    const gid = 'thermoGrad';
    const grad = s('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: m.l, x2: m.l + iw, y1: 0, y2: 0 });
    for (let i = 0; i <= 40; i++) { const t = THERMO.tMax * Math.pow(i / 40, 1 / 0.6); grad.appendChild(s('stop', { offset: (i / 40).toFixed(3), 'stop-color': tempColor(thermoF(t)) })); }
    const areaGrad = s('linearGradient', { id: gid + 'A', x1: 0, x2: 0, y1: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.16 }), s('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 }));
    const mask = s('mask', { id: gid + 'M' }, s('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#' + gid + 'A)' }));
    svg.appendChild(s('defs', null, grad, areaGrad, mask));
    // danger zone band 4–60 °C
    svg.appendChild(s('rect', { x: m.l, y: ys(60), width: iw, height: ys(4) - ys(60), fill: 'rgba(255,116,97,0.07)' }));
    svg.appendChild(s('text', { x: m.l + iw - 8, y: ys(60) + 16, 'text-anchor': 'end', class: 'lbl-mut', fill: '#ffb3a8', text: 'Food-safety danger zone, 4–60 °C' }));
    // y grid + axis
    const gAx = s('g', { class: 'ax' });
    [-30, -18, 0, 20, 40, 60, 80, 100].forEach((v) => {
      gAx.appendChild(s('line', { x1: m.l, x2: m.l + iw, y1: ys(v), y2: ys(v), stroke: 'rgba(160,200,255,0.07)' }));
      gAx.appendChild(s('text', { x: m.l - 10, y: ys(v) + 4, 'text-anchor': 'end', text: (v < 0 ? MINUS + Math.abs(v) : v) + ' °C' }));
    });
    [0, 1, 2, 4, 8, 15, 25, 40].forEach((t) => {
      gAx.appendChild(s('line', { x1: xs(t), x2: xs(t), y1: m.t + ih, y2: m.t + ih + 5 }));
      gAx.appendChild(s('text', { x: xs(t), y: m.t + ih + 20, 'text-anchor': 'middle', text: t + (t === 40 ? ' min' : '') }));
    });
    gAx.appendChild(s('text', { x: m.l + iw, y: m.t + ih + 36, 'text-anchor': 'end', class: 'lbl-mut', text: 'Minutes on the line (compressed scale)' }));
    svg.appendChild(gAx);
    // milestone lines
    THERMO.lines.forEach((ln) => {
      svg.appendChild(s('line', { x1: m.l, x2: m.l + iw, y1: ys(ln.y), y2: ys(ln.y), stroke: ln.color, 'stroke-opacity': 0.55, 'stroke-width': 1 }));
      svg.appendChild(s('text', { x: m.l + 8, y: ys(ln.y) - 6, class: 'lbl-mut', fill: ln.color, text: ln.label }));
    });
    // phase boundaries + numbers (the phases are a sequence)
    THERMO.phases.forEach((p, i) => {
      if (i > 0) svg.appendChild(s('line', { x1: xs(p.t0), x2: xs(p.t0), y1: m.t, y2: m.t + ih, stroke: 'rgba(160,200,255,0.10)' }));
      const cx = (xs(p.t0) + xs(p.t1)) / 2;
      svg.appendChild(s('text', { x: cx, y: m.t - 12, 'text-anchor': 'middle', class: 'lbl-mut', text: String(i + 1) }));
    });
    // curve
    let d = '', dA = '';
    const N = 220;
    for (let i = 0; i <= N; i++) { const t = THERMO.tMax * Math.pow(i / N, 1 / 0.6); const x = xs(t), y = ys(thermoF(t)); d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
    dA = d + 'L' + (m.l + iw) + ' ' + (m.t + ih) + 'L' + m.l + ' ' + (m.t + ih) + 'Z';
    svg.appendChild(s('path', { d: dA, fill: 'url(#' + gid + ')', mask: 'url(#' + gid + 'M)' }));
    const glow = s('path', { d, fill: 'none', stroke: 'url(#' + gid + ')', 'stroke-width': 8, 'stroke-opacity': 0.18, 'stroke-linecap': 'round' });
    const curve = s('path', { d, fill: 'none', stroke: 'url(#' + gid + ')', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    svg.appendChild(glow); svg.appendChild(curve);
    svg.appendChild(s('text', { x: m.l + iw - 8, y: ys(100) + 18, 'text-anchor': 'end', class: 'lbl-mut', fill: '#ffbe55', text: 'Illustrative, not measured' }));
    // crosshair
    const cross = s('g', { class: 'thermo-cross' });
    const vline = s('line', { y1: m.t, y2: m.t + ih, stroke: '#eef6ff', 'stroke-opacity': 0.5, 'stroke-width': 1 });
    const dotRing = s('circle', { r: 9, fill: '#0b1a2e' });
    const dot = s('circle', { r: 6 });
    const tag = s('g');
    const tagBg = s('rect', { rx: 8, height: 46, fill: 'rgba(6,15,30,0.95)', stroke: 'rgba(160,200,255,0.3)' });
    const tagT = s('text', { class: 'lbl-strong' }), tagS = s('text', { class: 'lbl-mut' });
    tag.append(tagBg, tagT, tagS);
    cross.append(vline, dotRing, dot, tag);
    svg.appendChild(cross);
    const hit = s('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' });
    svg.appendChild(hit);
    host.appendChild(svg);
    function place(t) {
      THERMO.t = t;
      const v = thermoF(t), x = xs(t), y = ys(v), ph = thermoPhaseAt(t);
      vline.setAttribute('x1', x); vline.setAttribute('x2', x);
      dotRing.setAttribute('cx', x); dotRing.setAttribute('cy', y);
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('fill', tempColor(v));
      tagT.textContent = fmtTemp(v) + ' · ' + ph.name;
      tagS.textContent = 'Minute ' + nf1.format(t) + ' (illustrative)';
      const tw = Math.max(150, tagT.textContent.length * 7.6 + 24);
      let tx = x + 14; if (tx + tw > m.l + iw) tx = x - 14 - tw;
      const ty = clamp(y - 56, m.t + 2, m.t + ih - 50);
      tagBg.setAttribute('x', tx); tagBg.setAttribute('y', ty); tagBg.setAttribute('width', tw);
      tagT.setAttribute('x', tx + 12); tagT.setAttribute('y', ty + 20); tagS.setAttribute('x', tx + 12); tagS.setAttribute('y', ty + 37);
      updateThermoReadout(t);
    }
    hit.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) * (W / r.width); const t = xinv(x); $('#thermoScrub').value = t.toFixed(1); place(t); });
    host._place = place;
    place(THERMO.t);
    if (!THERMO.drawn && !reduceMotion.matches) {
      const L = curve.getTotalLength();
      [curve, glow].forEach((p) => { p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
      host._draw = () => { [curve, glow].forEach((p) => { p.style.transition = 'stroke-dashoffset 1.8s cubic-bezier(.22,1,.36,1)'; p.style.strokeDashoffset = 0; }); THERMO.drawn = true; };
    } else THERMO.drawn = true;
  }
  const fmtTemp = (v) => (v < -0.05 ? MINUS : '') + nf1.format(Math.abs(Math.round(v * 10) / 10)) + ' °C';
  function updateThermoReadout(t) {
    const v = thermoF(t), ph = thermoPhaseAt(t);
    const out = $('#thermoReadout'); clear(out);
    out.append(h('span', { class: 'big', text: fmtTemp(v) }), h('span', { text: 'Minute ' + nf1.format(t) }), h('span', { text: ph.name }));
    $$('#thermoPhases .phase').forEach((b, i) => b.classList.toggle('is-active', THERMO.phases[i] === ph));
  }
  function buildPhases() {
    const ol = $('#thermoPhases'); clear(ol);
    const c = ctx();
    const greens = c.batches.find((b) => /spinach|leaf/i.test(b.commodity || ''));
    THERMO.phases.forEach((p, i) => {
      const text = i === 0 && greens ? 'Field heat. Batch ' + str(greens.batch_id) + ' (' + str(greens.commodity) + ') has ' + fmtHrs(num(greens.shelf_life_hrs)) + ' of shelf life left.' : p.text;
      const btn = h('button', { type: 'button', class: 'phase', style: { '--ph': p.color }, onclick: () => { const t = (p.t0 + Math.min(p.t1, p.t0 + 4)) / 2; $('#thermoScrub').value = t; const host = $('#thermoChart'); host._place && host._place(t); } },
        h('span', { class: 'ph-temp', style: { color: p.color }, text: (i + 1) + '. ' + p.temp }), h('span', { class: 'ph-name', text: p.name }), h('span', { class: 'ph-text', text }));
      ol.appendChild(h('li', null, btn));
    });
    updateThermoReadout(THERMO.t);
  }

  /* ------------------------------------------------------------------
     11. Rescue Lab
     ------------------------------------------------------------------ */
  const CMP_METRICS = [
    { key: 'spoilKg', label: 'Modelled spoilage', sub: 'Stock the model cannot place', better: 'low', fmt: fmtKg },
    { key: 'spoilPct', label: 'Spoilage share', sub: 'Of all stock', better: 'low', fmt: fmtPct },
    { key: 'rev', label: 'Net revenue after transport', sub: 'Revenue minus transport cost', better: 'high', fmt: fmtINR },
    { key: 'fulfil', label: 'Demand fulfilment', sub: 'Allocated ÷ total demand', better: 'high', fmt: fmtPct }
  ];
  function renderConsole() {
    const c = ctx();
    // corridors
    const list = $('#corridorList'); clear(list);
    const opts = c.routes.map((r) => {
      const d = c.destById.get(str(r.dest_id));
      return { value: str(r.dest_id), name: (str(r.route_id) || '') + ' ' + (d ? str(d.name) : str(r.dest_id)), sub: (d && tierInfo(d.tier) ? tierInfo(d.tier).short : '') + (str(r.vehicle_type) ? ', ' + str(r.vehicle_type) : ''), hrs: num(r.transit_time_hrs) };
    });
    opts.push({ value: 'ALL', name: 'Every corridor', sub: 'All ' + (opts.length || '') + ' routes at once', hrs: null });
    if (!c.routes.length) list.appendChild(h('p', { class: 'console-note', text: state.mode === 'checking' ? 'Loading routes…' : 'Routes appear once the API or the demo is loaded. "Every corridor" still works.' }));
    opts.filter((o) => c.routes.length || o.value === 'ALL').forEach((o) => {
      const input = h('input', { type: 'radio', name: 'corridor', value: o.value, checked: state.jamSel.dest === o.value, onchange: () => { state.jamSel.dest = o.value; renderConsole(); } });
      list.appendChild(h('label', { class: 'radio-row' }, input, h('span', { class: 'rr-name' }, o.name, h('span', { class: 'rr-sub', text: o.sub })), h('span', { class: 'rr-hrs', text: isNum(o.hrs) ? fmtHrs(o.hrs) : '' })));
    });
    if (!opts.some((o) => o.value === state.jamSel.dest) || (!c.routes.length && state.jamSel.dest !== 'ALL')) state.jamSel.dest = 'ALL';
    // delays
    const dl = $('#delayList'); clear(dl);
    CONFIG.DELAYS.forEach((v) => {
      dl.appendChild(h('label', null, h('input', { type: 'radio', name: 'delay', value: String(v), checked: state.jamSel.delay === v, onchange: () => { state.jamSel.delay = v; renderConsole(); } }), h('span', { text: '+' + v + ' h' })));
    });
    const body = { delay_hrs: state.jamSel.delay, disruption_type: 'HIGHWAY_JAM', affected_dest_id: state.jamSel.dest === 'ALL' ? null : state.jamSel.dest };
    $('#jamRequest').textContent = 'POST ' + (state.mode === 'demo' ? '/api/simulate-disruption  (demo: answered from a saved snapshot)' : CONFIG.API_BASE_URL + '/api/simulate-disruption') + '\n' + JSON.stringify(body, null, 2);
    if (!state.busy.jam) $('#runJamLabel').textContent = 'Simulate +' + state.jamSel.delay + ' h on ' + (state.jamSel.dest === 'ALL' ? 'every corridor' : (c.routeByDest.get(state.jamSel.dest) ? str(c.routeByDest.get(state.jamSel.dest).route_id) : state.jamSel.dest));
    // step states
    $('#stepPlan').classList.toggle('is-done', !!state.plan);
    $('#stepJam').classList.toggle('is-done', !!state.jam);
    $('#planMeta').textContent = state.plan ? sourceText(state.plan) + ', ' + plural(state.plan.payload.allocations.length, 'allocation') + (state.plan.onDrift ? '. Computed on modified server routes.' : '') : '';
    if (!state.busy.plan) $('#runPlanBtn .btn-text').textContent = state.plan ? 'Run the plan again' : 'Run cascade plan';
  }
  function renderTimeline() {
    const sc = scenarios(); const ol = $('#timeline'); clear(ol);
    SC_ORDER.forEach((k) => {
      const meta = SC[k], v = sc[k];
      const isA = state.pickA === k && v, isB = state.pickB === k && v;
      const sub = !v ? (k === 'conv' || k === 'plan' ? 'Run the plan' : 'Simulate a jam') : 'Revenue after transport ' + fmtINR(v.rev);
      const cond = k === 'convJam' || k === 'replan' ? (state.jam ? '+' + jamInfo().delay + ' h, ' + corridorLabel(jamInfo().aff) : meta.cond) : meta.cond;
      const btn = h('button', {
        type: 'button', class: 'tl-node' + (isA ? ' is-a' : '') + (isB ? ' is-b' : ''), 'data-sc': k, style: { '--sc': meta.color }, disabled: !v,
        'aria-pressed': isA || isB ? 'true' : 'false',
        onclick: () => { choosePair(k === 'conv' ? 'planVsConv' : k === 'plan' ? (state.jam ? 'jamImpact' : 'planVsConv') : k === 'convJam' ? 'replanVsConv' : (state.plan ? 'jamImpact' : 'replanVsConv')); renderLab(); }
      },
        h('span', { class: 'tl-role', text: isA ? 'A' : isB ? 'B' : '' }),
        h('span', { class: 'tl-label' }, h('span', { class: 'tl-swatch', 'aria-hidden': 'true' }), cond),
        h('span', { class: 'tl-name', text: meta.label }),
        h('span', { class: 'tl-val' }, v ? fmtNum(v.spoilKg) : '—', ' ', h('small', { text: v ? 'kg spoiled' : '' })),
        h('span', { class: 'tl-sub', text: sub }));
      ol.appendChild(h('li', null, btn));
    });
  }
  function renderPairs() {
    const sc = scenarios();
    const tabs = $('#pairTabs'); clear(tabs);
    Object.entries(PAIRS).forEach(([key, p]) => {
      const ok = sc[p.a] && sc[p.b];
      tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'pair-tab', 'aria-selected': state.pair === key && ok ? 'true' : 'false', disabled: !ok, text: p.label, onclick: () => { choosePair(key); renderLab(); } }));
    });
    const fill = (sel, val, other) => {
      clear(sel);
      SC_ORDER.forEach((k) => { if (sc[k]) sel.appendChild(h('option', { value: k, selected: k === val, disabled: k === other, text: SC[k].label })); });
      sel.disabled = Object.keys(sc).length < 2;
    };
    fill($('#pickA'), state.pickA, state.pickB);
    fill($('#pickB'), state.pickB, state.pickA);
  }
  function renderCompare() {
    const sc = scenarios();
    const A = sc[state.pickA], B = sc[state.pickB];
    const head = $('#compareHeadline'), chart = $('#compareChart');
    clear(head); clear(chart);
    if (!A || !B) {
      chart.appendChild(h('div', { class: 'empty-lab' },
        h('strong', { text: Object.keys(sc).length ? 'Pick two scenarios to compare' : 'Nothing to compare yet' }),
        h('span', { text: 'Run the cascade plan first. It returns the plan and the engine\'s conventional-dispatch baseline from the same request.' }),
        Object.keys(sc).length ? null : h('button', { type: 'button', class: 'btn btn-primary', text: state.mode === 'offline' && demoAvailable() ? 'Run it on demo data' : 'Run cascade plan', onclick: () => (state.mode === 'offline' && demoAvailable() ? enterDemo().then(runPlan) : runPlan()) })));
      return;
    }
    // headline: the two numbers that matter most
    [['spoilKg', 'Modelled spoilage', 'low', fmtKg], ['rev', 'Net revenue after transport', 'high', fmtINR]].forEach(([k, label, better, f]) => {
      const a = A[k], b = B[k];
      const delta = isNum(a) && isNum(b) ? b - a : null;
      const good = delta === null || Math.abs(delta) < 0.5 ? 'is-flat' : (better === 'low' ? delta < 0 : delta > 0) ? 'is-good' : 'is-bad';
      const pct = isNum(delta) && isNum(a) && a !== 0 ? delta / Math.abs(a) * 100 : null;
      const to = h('span', { class: 'ch-to' }); countTo(to, b, f, 'cmp-' + k);
      head.appendChild(h('div', { class: 'ch-item' },
        h('span', { class: 'ch-label', text: label }),
        h('span', { class: 'ch-flow' }, h('span', { class: 'ch-from', text: f(a) }), h('span', { class: 'ch-arrow', 'aria-hidden': 'true', text: '→' }), to,
          h('span', { class: 'ch-delta ' + good, text: delta === null ? NA : Math.abs(delta) < 0.5 ? 'No change' : signed(delta, (x) => f(x).replace(/^₹/, '₹')) + (isNum(pct) ? ' (' + signed(pct, (x) => nf1.format(x) + '%') + ')' : '') }))));
    });
    head.appendChild(h('p', { class: 'source-note', style: { flexBasis: '100%' }, text: 'A: ' + SC[A.key].label + ' (' + A.from + '). B: ' + SC[B.key].label + ' (' + B.from + ').' }));
    // legend
    chart.appendChild(h('div', { class: 'cmp-legend' },
      h('span', null, h('i', { style: { background: SC[A.key].fill } }), 'A, ' + SC[A.key].label),
      h('span', null, h('i', { style: { background: SC[B.key].fill } }), 'B, ' + SC[B.key].label),
      state.cmpView === 'diff' ? h('span', { text: 'Bars show B minus A, as a share of A' }) : h('span', { text: 'Each row has its own scale' })));
    CMP_METRICS.forEach((mt) => {
      const a = A[mt.key], b = B[mt.key];
      const row = h('div', { class: 'cmp-row' }, h('div', { class: 'cmp-metric' }, mt.label, h('small', { text: mt.sub })));
      const bars = h('div', { class: 'cmp-bars' });
      if (state.cmpView === 'side') {
        const max = Math.max(isNum(a) ? Math.abs(a) : 0, isNum(b) ? Math.abs(b) : 0) || 1;
        [[a, A], [b, B]].forEach(([v, S]) => {
          const fill = h('span', { class: 'cmp-fill', style: { background: SC[S.key].fill, width: '0%' } });
          const line = h('div', { class: 'cmp-line' }, h('div', { class: 'cmp-track' }, isNum(v) ? fill : h('span', { class: 'cmp-na', text: mt.key === 'fulfil' ? 'Not reported for conventional dispatch' : 'Not in the response' })), h('span', { class: 'cmp-val', text: mt.fmt(v) }));
          bars.appendChild(line);
          if (isNum(v)) requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = (Math.abs(v) / max * 100).toFixed(2) + '%'; }));
        });
      } else {
        const delta = isNum(a) && isNum(b) ? b - a : null;
        const rel = isNum(delta) && isNum(a) && a !== 0 ? delta / Math.abs(a) : null;
        const goodDir = mt.better === 'low' ? -1 : 1;
        if (!isNum(delta)) bars.appendChild(h('div', { class: 'cmp-line' }, h('span', { class: 'cmp-na', text: mt.key === 'fulfil' ? 'Not reported for conventional dispatch' : 'Not in the response' }), h('span', { class: 'cmp-val', text: NA })));
        else {
          const w = clamp(Math.abs(rel === null ? 0 : rel), 0, 1) * 50;
          const fill = h('span', { class: 'diff-fill ' + (delta * goodDir > 0 ? 'is-good' : 'is-bad') + ' ' + (delta >= 0 ? 'pos' : 'neg'), style: { width: '0%' } });
          bars.appendChild(h('div', { class: 'cmp-line' }, h('div', { class: 'diff-track' }, fill),
            h('span', { class: 'cmp-val' }, signed(delta, (x) => mt.fmt(x)), ' ', h('small', { text: isNum(rel) ? '(' + signed(rel * 100, (x) => nf1.format(x) + '%') + ')' : '' }))));
          requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = (Math.abs(delta) < 1e-9 ? 0 : Math.max(w, 0.6)).toFixed(2) + '%'; }));
        }
      }
      row.appendChild(bars);
      chart.appendChild(row);
    });
  }
  function renderChanges() {
    const sc = scenarios();
    const A = sc[state.pickA], B = sc[state.pickB];
    const el = $('#changes'); clear(el);
    if (!A || !B) return;
    const nameOf = (r) => (r.spoiled ? 'Unallocated' : r.dest_name || r.dest_id || NA);
    if (A.rows && B.rows) {
      const all = computeChanges(A.rows, B.rows);
      const marginOnly = all.filter((c) => c.kind === 'margin');
      const ch = all.filter((c) => c.kind !== 'margin');
      const total = new Set(B.rows.map((r) => r.batch_id)).size;
      el.appendChild(h('h3', { class: 'changes-title', text: ch.length ? 'What changed for each batch' : 'No batch changed buyer, quantity or price' }));
      el.appendChild(h('p', { class: 'changes-sub', text: (ch.length ? ch.length + ' of ' + total + ' batches changed buyer, quantity or terms between A and B, read from the two allocation lists.' : 'Every batch keeps the same buyer, quantity and price.') +
        (marginOnly.length ? ' ' + plural(marginOnly.length, 'other batch') + ' kept ' + (marginOnly.length === 1 ? 'its' : 'their') + ' buyer but arrive' + (marginOnly.length === 1 ? 's' : '') + ' with ' + (function () { const v = marginOnly.map((c) => c.dm); const mn = Math.min(...v), mx = Math.max(...v); return (mn === mx ? fmtHrs(Math.abs(mn)) : fmtHrs(Math.abs(mx)) + '–' + fmtHrs(Math.abs(mn))) + (mn < 0 ? ' less' : ' more'); })() + ' margin (' + marginOnly.map((c) => c.id).join(', ') + ').' : '') }));
      if (ch.length) {
        const ul = h('ul', { class: 'change-list' });
        ch.forEach((c, i) => {
          const a = c.a, b = c.b;
          const r = b || a;
          const item = h('li', { class: 'change' + (c.kind === 'lost' ? ' is-lost' : ''), style: { '--i': i } }, h('span', { class: 'id', text: c.id }));
          const body = h('div');
          const head = { lost: 'No feasible buyer any more', recovered: 'Found a buyer', moved: 'Re-routed to another buyer', qty: 'Same buyer, different quantity', terms: 'Same buyer, different terms', margin: 'Same buyer, less time to spare', missing: 'Missing from B', new: 'Only in B' }[c.kind];
          body.appendChild(h('p', { class: 'change-head', text: (r.commodity ? r.commodity + ': ' : '') + head }));
          if (a && b) {
            if (c.kind === 'terms' || c.kind === 'margin') {
              const bits = [];
              if (c.dd) bits.push('discount ' + fmtPct(a.discount_pct) + ' → ' + fmtPct(b.discount_pct));
              if (c.dp) bits.push('contribution ' + fmtINR(a.net_profit) + ' → ' + fmtINR(b.net_profit));
              if (isNum(c.dm) && Math.abs(c.dm) > 0.05) bits.push('margin ' + fmtHrs(a.margin_hrs) + ' → ' + fmtHrs(b.margin_hrs));
              body.appendChild(h('p', { class: 'change-route', text: nameOf(b) + ': ' + bits.join(', ') }));
            } else {
              body.appendChild(h('p', { class: 'change-route' }, h('span', { class: 'from', text: nameOf(a) + (a.spoiled ? '' : ', ' + fmtKg(a.allocated_kg)) }), h('span', { 'aria-hidden': 'true', text: '→' }), h('span', { text: nameOf(b) + (b.spoiled ? '' : ', ' + fmtKg(b.allocated_kg)) })));
            }
            if (b.shortfall > 0) body.appendChild(h('p', { class: 'change-why', text: fmtKg(b.shortfall) + ' of this batch is left unallocated: the engine sends each batch to one buyer and this one has no more demand.' }));
            if (b.reasoning && c.kind !== 'margin') body.appendChild(h('p', { class: 'change-why', text: 'Engine: ' + b.reasoning }));
          }
          item.appendChild(body); ul.appendChild(item);
        });
        el.appendChild(ul);
      }
    } else if (B.rows) {
      const lost = B.rows.filter((r) => r.spoiled || r.shortfall > 0);
      el.appendChild(h('h3', { class: 'changes-title', text: lost.length ? 'Stock the ' + SC[B.key].label.toLowerCase() + ' still cannot place' : 'Every batch has a buyer in ' + SC[B.key].label.toLowerCase() }));
      el.appendChild(h('p', { class: 'changes-sub', text: SC[A.key].label + ' returns totals only, so there is no per-batch list to compare against.' }));
      if (lost.length) {
        const ul = h('ul', { class: 'change-list' });
        lost.forEach((r, i) => ul.appendChild(h('li', { class: 'change' + (r.spoiled ? ' is-lost' : ''), style: { '--i': i } }, h('span', { class: 'id', text: r.batch_id || NA }),
          h('div', null, h('p', { class: 'change-head', text: (r.commodity || '') + (r.spoiled ? ': no feasible buyer' : ': ' + fmtKg(r.shortfall) + ' left over') }),
            h('p', { class: 'change-why', text: r.spoiled ? (r.reasoning || 'Marked spoiled by the engine.') : 'Sent to ' + (r.dest_name || r.dest_id) + ', which only had demand for ' + fmtKg(r.allocated_kg) + '.' })))));
        el.appendChild(ul);
      }
    }
  }
  function renderIntegrity() {
    const el = $('#integrity'); clear(el);
    const it = state.integrity;
    if (!it || (!state.jam && it.state !== 'drift')) { el.hidden = true; return; }
    el.hidden = false; el.dataset.state = it.state;
    const c = ctx();
    if (it.state === 'ok') {
      el.appendChild(h('p', null, h('strong', { text: 'Route check passed. ' }), it.demo ? 'Every demo snapshot starts from the original route data.' : 'After the jam, GET /api/data still reports the original transit times, so the next run starts from clean routes.'));
    } else if (it.state === 'unknown') {
      el.appendChild(h('p', null, h('strong', { text: 'Route check unavailable. ' }), 'The page could not re-read /api/data after the jam.'));
    } else {
      el.appendChild(h('p', null, h('strong', { text: 'The server\'s route data has changed. ' }),
        it.when === 'jam' ? 'After this jam, GET /api/data reports slower routes than before it:' : 'GET /api/data reports route transit times that differ from the destinations\' listed times, which usually means an earlier jam changed them:'));
      const ul = h('ul');
      it.items.forEach((x) => { const d = c.destById.get(x.dest_id); ul.appendChild(h('li', { text: (x.route_id || '') + ' to ' + (d ? str(d.name) : x.dest_id) + ': ' + fmtHrs(x.before) + ' → ' + fmtHrs(x.now) })); });
      el.appendChild(ul);
      el.appendChild(h('p', { style: { marginTop: '8px' }, text: 'The disruption handler in backend/main.py copies the route list with routes_data.copy(), a shallow copy, and then edits the route objects in place. The next plan or jam will start from these slower routes. Restart the backend to restore them; copy.deepcopy(routes_data) fixes it permanently.' }));
    }
  }
  function renderLab() {
    renderConsole(); renderTimeline(); renderPairs(); renderCompare(); renderChanges(); renderIntegrity();
    const r = state.jam && (!state.plan || state.jam.at > state.plan.at) ? state.jam : state.plan;
    const tag = $('#labSource');
    tag.dataset.source = r ? r.source : 'none';
    tag.textContent = r ? sourceText(r) : 'No results yet';
    $$('input[name="cmpView"]').forEach((i) => { i.checked = i.value === state.cmpView; });
    if (preJamMismatch()) {
      const head = $('#compareHeadline');
      if (head.childNodes.length) head.appendChild(h('p', { class: 'source-note', style: { flexBasis: '100%', color: '#ffd28a' }, text: 'The pre-jam metrics returned by the disruption call differ from your earlier plan run, so the server data changed between the two requests.' }));
    }
  }

  /* ------------------------------------------------------------------
     12. Tooltip and chart helpers
     ------------------------------------------------------------------ */
  const tip = {
    el: null,
    show(content, x, y) {
      const el = this.el || (this.el = $('#tooltip'));
      clear(el); el.appendChild(content); el.hidden = false;
      const r = el.getBoundingClientRect();
      let left = x + 14, top = y + 14;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
      el.style.left = Math.max(8, left) + 'px'; el.style.top = Math.max(8, top) + 'px';
    },
    hide() { if (this.el) this.el.hidden = true; }
  };
  function tipContent(title, rows, note, color) {
    return h('div', null,
      h('p', { class: 'tt-title' }, color ? h('span', { class: 'swatch', style: { background: color } }) : null, title),
      (rows || []).filter(Boolean).map(([k, v]) => h('p', { class: 'tt-row' }, h('span', { text: k }), h('b', { text: v }))),
      note ? h('p', { class: 'tt-note', text: note }) : null);
  }
  function bindTip(el, fn) {
    el.addEventListener('pointermove', (e) => tip.show(fn(), e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => tip.hide());
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); tip.show(fn(), r.left + r.width / 2, r.top + r.height / 2); });
    el.addEventListener('blur', () => tip.hide());
  }
  function activate(el, fn) {
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } });
  }
  function tween(dur, step, done) {
    if (reduceMotion.matches || dur <= 0) { step(1); done && done(); return; }
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function frame(now) { const t = clamp((now - t0) / dur, 0, 1); step(ease(t)); if (t < 1) requestAnimationFrame(frame); else done && done(); }
    requestAnimationFrame(frame);
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function emptyViz(host, title, text, withRun) {
    const box = h('div', { class: 'viz-empty' }, h('div', null, h('strong', { text: title }), text,
      withRun ? h('div', null, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: state.mode === 'offline' && demoAvailable() ? 'Run it on demo data' : 'Run cascade plan', onclick: () => (state.mode === 'offline' && demoAvailable() ? enterDemo().then(runPlan) : runPlan()) })) : null));
    host.appendChild(box);
  }
  function miniTable(headers, rows) {
    return h('table', { class: 'mini-table' },
      h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col', class: x.n ? 'n' : null, text: x.t })))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((v, i) => (i === 0 ? h('th', { scope: 'row', text: v }) : h('td', { class: headers[i].n ? 'n' : null, text: v })))))));
  }
  function lensName() { return state.lens === 'replan' && state.jam ? 'the re-plan under the jam' : 'the cascade plan'; }

  /* ------------------------------------------------------------------
     13. Studio: tier donut
     ------------------------------------------------------------------ */
  function tierGroups(rows, metrics, measure) {
    const groups = TIERS.map((t) => ({ key: TIER_INFO[t].key, name: TIER_INFO[t].short, tier: t, color: TIER_INFO[t].color, kg: 0, inr: 0, n: 0 }));
    const other = { key: 'other', name: 'Other tier', color: '#9fb3c8', kg: 0, inr: 0, n: 0 };
    rows.forEach((r) => {
      if (r.spoiled) return;
      const g = groups.find((x) => x.key === r.tierKey) || other;
      g.kg += r.allocated_kg || 0; g.inr += r.net_profit || 0; g.n += 1;
    });
    const out = groups.concat(other.n ? [other] : []);
    const lostKg = isNum(metrics.oSpoilKg) ? metrics.oSpoilKg : sum(rows, (r) => (r.spoiled ? r.qty : r.shortfall));
    out.push({ key: 'lost', name: 'Unallocated', color: LOST.color, kg: lostKg, inr: 0, n: rows.filter((r) => r.spoiled).length });
    out.forEach((g) => { g.value = measure === 'kg' ? g.kg : g.inr; });
    return out;
  }
  function arcPath(cx, cy, r0, r1, a0, a1) {
    if (a1 - a0 < 0.0005) return '';
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
    return 'M' + x0 + ' ' + y0 + 'A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2 + 'A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + x3 + ' ' + y3 + 'Z';
  }
  function renderTierDonut(host, expanded) {
    clear(host);
    const res = lensResult();
    const legend = expanded ? null : $('#legendTiers');
    if (legend) clear(legend);
    if (!res) { emptyViz(host, 'No plan yet', 'Run the cascade plan to see how the stock splits across tiers.', true); return; }
    const rows = buildRows(res), m = readMetrics(res.payload.metrics);
    const groups = tierGroups(rows, m, state.tierMeasure).filter((g) => !(state.tierMeasure === 'inr' && g.key === 'lost'));
    const vis = groups.filter((g) => !state.tierHidden.has(g.key) && g.value > 0);
    const total = sum(vis, (g) => g.value);
    const W = Math.max(260, host.clientWidth), size = expanded ? Math.min(W, 440) : Math.min(W, 300);
    const cx = W / 2, cy = size / 2, R = size / 2 - 10, r0 = R * 0.64;
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + size, role: 'img', 'aria-label': 'Donut chart of ' + (state.tierMeasure === 'kg' ? 'kilograms' : 'contribution') + ' by tier for ' + lensName() });
    svg.appendChild(s('circle', { cx, cy, r: (R + r0) / 2, fill: 'none', stroke: 'rgba(160,200,255,0.06)', 'stroke-width': R - r0 }));
    const gap = 2 / R;
    let acc = 0;
    const targets = vis.map((g) => { const a0 = acc / (total || 1) * Math.PI * 2; acc += g.value; const a1 = acc / (total || 1) * Math.PI * 2; return { g, a0: a0 + gap / 2, a1: Math.max(a0 + gap / 2, a1 - gap / 2) }; });
    const prev = host._prev || {};
    const paths = targets.map((t) => {
      const p = s('path', { class: 'mark', fill: t.g.color, tabindex: 0, role: 'button', 'aria-label': t.g.name + ': ' + (state.tierMeasure === 'kg' ? fmtKg(t.g.value) : fmtINR(t.g.value)) + ', ' + fmtPct(t.g.value / total * 100) + '. Select to filter the explorer.' });
      const tipFn = () => tipContent(t.g.name, [
        ['Kilograms', fmtKg(t.g.kg)], t.g.key !== 'lost' ? ['Contribution after transport', fmtINR(t.g.inr)] : null,
        ['Share', fmtPct(t.g.value / total * 100)], t.g.key !== 'lost' ? ['Allocations', String(t.g.n)] : null
      ], t.g.key === 'lost' ? 'From metrics.optimized_spoilage_kg: stock with no feasible buyer, plus leftovers the chosen buyer had no demand for.' : 'Summed from the returned allocations.', t.g.color);
      bindTip(p, tipFn);
      p.addEventListener('pointerenter', () => { p._hover = true; draw(1); });
      p.addEventListener('pointerleave', () => { p._hover = false; draw(1); });
      activate(p, () => { tip.hide(); filterExplorer(t.g.key === 'lost' ? { status: 'SPOILED' } : { tier: t.g.tier || '' }); });
      svg.appendChild(p);
      return p;
    });
    let k = 0;
    function draw(tt) {
      k = tt;
      targets.forEach((t, i) => {
        const pv = prev[t.g.key] || [t.a0, t.a0];
        const a0 = lerp(pv[0], t.a0, tt), a1 = lerp(pv[1], t.a1, tt);
        const bump = paths[i]._hover ? 6 : 0;
        paths[i].setAttribute('d', arcPath(cx, cy, r0, R + bump, a0, a1));
      });
    }
    const center = s('g', { 'pointer-events': 'none' },
      s('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'lbl-strong', style: 'font-size:' + (expanded ? 30 : 24) + 'px;font-weight:700', text: state.tierMeasure === 'kg' ? fmtCompact(total) + ' kg' : fmtCompactINR(total) }),
      s('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', class: 'lbl-mut', text: state.tierHidden.size ? 'of the tiers shown' : state.tierMeasure === 'kg' ? 'all stock, placed or not' : 'contribution after transport' }));
    svg.appendChild(center);
    host.appendChild(svg);
    tween(host._prev ? 650 : 900, draw, () => { host._prev = Object.fromEntries(targets.map((t) => [t.g.key, [t.a0, t.a1]])); });
    if (!targets.length) svg.appendChild(s('text', { x: cx, y: cy + 40, 'text-anchor': 'middle', class: 'lbl-mut', text: 'All tiers hidden' }));
    if (legend) {
      groups.forEach((g) => {
        const pressed = !state.tierHidden.has(g.key);
        const allTotal = sum(groups.filter((x) => x.value > 0), (x) => x.value);
        legend.appendChild(h('li', null, h('button', { type: 'button', 'aria-pressed': pressed ? 'true' : 'false', onclick: () => { if (pressed) state.tierHidden.add(g.key); else state.tierHidden.delete(g.key); renderStudio(); } },
          h('span', { class: 'swatch', style: { background: g.color } }), g.name, ' ', h('span', { class: 'lg-val', text: (state.tierMeasure === 'kg' ? fmtKg(g.value) : fmtINR(g.value)) + (allTotal ? ', ' + fmtPct(g.value / allTotal * 100) : '') }))));
      });
    }
    $('#vizTierSub').textContent = (state.tierMeasure === 'kg' ? 'Kilograms' : 'Contribution after transport (₹)') + ' in ' + lensName() + ', summed from the returned allocations';
    const tbl = $('#tableTiers'); clear(tbl);
    tbl.appendChild(miniTable([{ t: 'Tier' }, { t: 'Kilograms', n: 1 }, { t: 'Contribution after transport', n: 1 }, { t: 'Allocations', n: 1 }], groups.map((g) => [g.name, fmtKg(g.kg), g.key === 'lost' ? NA : fmtINR(g.inr), String(g.n)])));
  }

  /* ------------------------------------------------------------------
     14. Studio: destination fill
     ------------------------------------------------------------------ */
  function destStats(res) {
    const c = ctx(); const rows = res ? buildRows(res) : [];
    const list = c.dests.map((d) => ({ id: str(d.dest_id), name: str(d.name) || str(d.dest_id), tier: str(d.tier), demand: num(d.demand_kg), price: num(d.offering_price_per_kg), dest: d, kg: 0, inr: 0, batches: [] }));
    rows.forEach((r) => {
      if (r.spoiled || !r.dest_id) return;
      let e = list.find((x) => x.id === r.dest_id);
      if (!e) { e = { id: r.dest_id, name: (r.dest_name || r.dest_id) + ' (not in /api/data)', tier: r.tier, demand: null, kg: 0, inr: 0, batches: [], unknown: true }; list.push(e); }
      e.kg += r.allocated_kg || 0; e.inr += r.net_profit || 0; e.batches.push(r.batch_id);
    });
    list.forEach((e) => { e.fill = isNum(e.demand) && e.demand > 0 ? e.kg / e.demand : null; });
    return list;
  }
  function renderDestBars(host, expanded) {
    clear(host);
    const c = ctx();
    if (!c.dests.length) { emptyViz(host, 'No destination data', 'Connect the API or open the demo to load destinations.', false); return; }
    const res = lensResult();
    const list = destStats(res);
    const key = state.destSort;
    list.sort((a, b) => key === 'fill' ? (b.fill || 0) - (a.fill || 0) : key === 'kg' ? b.kg - a.kg : key === 'inr' ? b.inr - a.inr : (b.demand || 0) - (a.demand || 0));
    const W = Math.max(280, host.clientWidth);
    const rowH = expanded ? 70 : 64, top = 4;
    const H = top + list.length * rowH + 8;
    const maxV = Math.max(...list.map((e) => Math.max(e.demand || 0, e.kg)), 1);
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Allocated kilograms against demand for each destination in ' + lensName() });
    const prev = host._prev || {};
    const bars = [];
    list.forEach((e, i) => {
      const y = top + i * rowH;
      const ti = tierInfo(e.tier);
      const color = ti ? ti.color : '#9fb3c8';
      const g = s('g', { class: 'mark', tabindex: 0, role: 'button', 'aria-label': e.name + ': ' + fmtKg(e.kg) + ' of ' + fmtKg(e.demand) + ' demand. Select for details.' });
      g.appendChild(s('rect', { class: 'hit', x: 0, y, width: W, height: rowH - 4 }));
      g.appendChild(s('text', { x: 0, y: y + 16, class: 'lbl-strong', text: shortName(e.name, W < 420 ? 24 : 40) }));
      g.appendChild(s('text', { x: W, y: y + 16, 'text-anchor': 'end', class: 'lbl-val', text: res ? fmtNum(e.kg) + ' / ' + fmtNum(e.demand) + ' kg' + (isNum(e.fill) ? ', ' + fmtPct(e.fill * 100) : '') : fmtNum(e.demand) + ' kg demand' }));
      const by = y + 26, bh = 14;
      const trackW = isNum(e.demand) ? e.demand / maxV * W : 0;
      g.appendChild(s('rect', { x: 0, y: by, width: Math.max(trackW, 2), height: bh, rx: 4, fill: 'rgba(160,200,255,0.08)' }));
      g.appendChild(s('rect', { x: 0, y: by, width: Math.max(trackW, 2), height: bh, rx: 4, fill: 'none', stroke: 'rgba(160,200,255,0.18)' }));
      const fill = s('rect', { x: 0, y: by, height: bh, rx: 4, fill: color, width: 0 });
      g.appendChild(fill);
      bars.push({ fill, to: e.kg / maxV * W, from: prev[e.id] || 0, id: e.id });
      g.appendChild(s('text', { x: 0, y: by + bh + 14, class: 'lbl-mut', text: (ti ? ti.short : 'Unknown tier') + (res && e.batches.length ? ', from ' + e.batches.join(', ') : res ? ', nothing allocated' : '') + (e.unknown ? '. Not in /api/data' : '') }));
      bindTip(g, () => tipContent(e.name, [['Tier', ti ? ti.short : (e.tier || NA)], ['Demand', fmtKg(e.demand)], ['Allocated', res ? fmtKg(e.kg) : 'Run the plan'], ['Fill rate', isNum(e.fill) && res ? fmtPct(e.fill * 100) : NA], ['Contribution after transport', res ? fmtINR(e.inr) : NA], ['Offer price', isNum(e.price) ? fmtINR2(e.price) + '/kg' : NA]], res && e.batches.length ? 'Batches: ' + e.batches.join(', ') : null, color));
      if (!e.unknown) activate(g, () => { tip.hide(); openDrawer('dest', e.id); });
      svg.appendChild(g);
    });
    host.appendChild(svg);
    if (res) tween(700, (t) => bars.forEach((b) => b.fill.setAttribute('width', Math.max(0, lerp(b.from, b.to, t)))), () => { host._prev = Object.fromEntries(bars.map((b) => [b.id, b.to])); });
    const tbl = $('#tableDests'); clear(tbl);
    tbl.appendChild(miniTable([{ t: 'Destination' }, { t: 'Tier' }, { t: 'Demand', n: 1 }, { t: 'Allocated', n: 1 }, { t: 'Fill rate', n: 1 }, { t: 'Contribution', n: 1 }],
      list.map((e) => [e.name, tierInfo(e.tier) ? tierInfo(e.tier).short : (e.tier || NA), fmtKg(e.demand), res ? fmtKg(e.kg) : NA, res && isNum(e.fill) ? fmtPct(e.fill * 100) : NA, res ? fmtINR(e.inr) : NA])));
  }

  /* ------------------------------------------------------------------
     15. Studio: shelf-life runway
     ------------------------------------------------------------------ */
  function runwayRows(res) {
    const c = ctx(); const rows = res ? buildRows(res) : [];
    const byBatch = new Map(rows.map((r) => [r.batch_id, r]));
    return c.batches.map((b) => {
      const id = str(b.batch_id), shelf = num(b.shelf_life_hrs), r = byBatch.get(id) || null;
      const out = { id, commodity: str(b.commodity), shelf, qty: num(b.quantity_kg), r };
      if (r && !r.spoiled && isNum(shelf) && isNum(r.margin_hrs)) {
        out.trip = clamp(shelf - r.margin_hrs, 0, shelf);
        const delay = res && res === state.jam ? jamDelayFor(r.dest_id, res) : 0;
        out.delay = clamp(delay, 0, out.trip);
        const minReq = r.dest ? num(r.dest.min_shelf_life_hrs) : null;
        out.min = isNum(minReq) ? clamp(minReq, 0, shelf - out.trip) : null;
        out.buffer = isNum(out.min) ? Math.max(0, shelf - out.trip - out.min) : null;
      }
      return out;
    }).sort((a, b) => (a.shelf || 0) - (b.shelf || 0));
  }
  function renderRunway(host, expanded) {
    clear(host);
    const c = ctx();
    if (!c.batches.length) { emptyViz(host, 'No batch data', 'Connect the API or open the demo to load batches.', false); return; }
    const res = lensResult();
    const list = runwayRows(res);
    const W = Math.max(300, host.clientWidth);
    const labelW = W < 520 ? 92 : 170, rightW = W < 520 ? 0 : 150;
    const plotW = W - labelW - rightW - 8;
    const rowH = expanded ? 46 : 38, top = 22;
    const H = top + list.length * rowH + 30;
    const maxH = Math.ceil(Math.max(...list.map((x) => x.shelf || 0), 12) / 12) * 12;
    const xs = (v) => labelW + v / maxH * plotW;
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Shelf life of each batch split into trip, buyer minimum and spare buffer for ' + lensName() });
    const grid = s('g', { class: 'ax' });
    for (let v = 0; v <= maxH; v += 12) {
      grid.appendChild(s('line', { x1: xs(v), x2: xs(v), y1: top - 6, y2: H - 26, stroke: 'rgba(160,200,255,0.07)' }));
      grid.appendChild(s('text', { x: xs(v), y: H - 10, 'text-anchor': 'middle', text: v + ' h' }));
    }
    grid.appendChild(s('text', { x: labelW, y: 12, class: 'lbl-mut', text: 'Hours of shelf life' }));
    svg.appendChild(grid);
    const anims = [];
    list.forEach((x, i) => {
      const y = top + i * rowH, bh = Math.min(16, rowH - 18), by = y + (rowH - bh) / 2 - 4;
      const g = s('g', { class: 'mark', tabindex: 0, role: 'button', 'aria-label': x.id + ' ' + (x.commodity || '') + ': ' + fmtHrs(x.shelf) + ' shelf life' + (x.r ? (x.r.spoiled ? ', no feasible buyer' : ', ' + fmtHrs(x.trip) + ' trip, ' + fmtHrs(x.buffer) + ' spare') : '') + '. Select for details.' });
      g.appendChild(s('rect', { class: 'hit', x: 0, y: y - 2, width: W, height: rowH }));
      g.appendChild(s('text', { x: 0, y: by + bh / 2 + 4, class: 'lbl-strong', style: 'font-family:var(--font-mono);font-size:12.5px', text: x.id || NA }));
      if (labelW > 100) g.appendChild(s('text', { x: 48, y: by + bh / 2 + 4, class: 'lbl-mut', text: shortName(x.commodity || '', 16) }));
      const segs = [];
      if (!res || !x.r) segs.push({ a: 0, b: x.shelf || 0, fill: 'rgba(160,200,255,0.16)' });
      else if (x.r.spoiled) segs.push({ a: 0, b: x.shelf || 0, fill: 'url(#hatchCoral)' });
      else if (isNum(x.trip)) {
        segs.push({ a: 0, b: x.trip - x.delay, fill: '#4f6d96' });
        if (x.delay > 0) segs.push({ a: x.trip - x.delay, b: x.trip, fill: 'url(#hatchCoral)' });
        if (isNum(x.min)) { segs.push({ a: x.trip, b: x.trip + x.min, fill: '#7a5cf0' }); segs.push({ a: x.trip + x.min, b: x.shelf, fill: '#2ccbe6' }); }
        else segs.push({ a: x.trip, b: x.shelf, fill: '#2ccbe6' });
      }
      segs.forEach((sg, j) => {
        const w = Math.max(0, xs(sg.b) - xs(sg.a) - (j < segs.length - 1 ? 2 : 0));
        const rect = s('rect', { x: xs(sg.a), y: by, height: bh, fill: sg.fill, rx: j === segs.length - 1 ? 3 : 0, width: 0 });
        g.appendChild(rect); anims.push({ rect, w });
      });
      if (rightW) {
        const txt = !res ? '' : !x.r ? 'Not in the plan' : x.r.spoiled ? 'No feasible buyer' : (x.r.dest_id || '') + ', ' + fmtHrs(x.buffer) + ' spare';
        g.appendChild(s('text', { x: W - rightW + 12, y: by + bh / 2 + 4, class: x.r && x.r.spoiled ? 'lbl-val' : 'lbl', fill: x.r && x.r.spoiled ? '#ff9a8a' : null, text: txt }));
      }
      bindTip(g, () => tipContent(x.id + ', ' + (x.commodity || ''), [
        ['Shelf life', fmtHrs(x.shelf)], ['Quantity', fmtKg(x.qty)],
        x.r && !x.r.spoiled ? ['Buyer', x.r.dest_name || x.r.dest_id] : null,
        x.r && !x.r.spoiled ? ['Trip', fmtHrs(x.trip) + (x.delay ? ' (incl. +' + fmtHrs(x.delay) + ' jam)' : '')] : null,
        x.r && !x.r.spoiled ? ['Buyer\'s minimum on arrival', fmtHrs(x.min)] : null,
        x.r && !x.r.spoiled ? ['Spare buffer', fmtHrs(x.buffer)] : null,
        x.r && x.r.shortfall > 0 ? ['Left unallocated', fmtKg(x.r.shortfall)] : null
      ], !res ? 'Run the plan to see each trip.' : x.r && x.r.spoiled ? (x.r.reasoning || 'No destination is feasible.') : 'Trip = shelf_life_hrs − margin_hrs from the API.', null));
      activate(g, () => { tip.hide(); openDrawer('batch', x.id); });
      svg.appendChild(g);
    });
    host.appendChild(svg);
    tween(800, (t) => anims.forEach((a) => a.rect.setAttribute('width', a.w * t)));
    const tbl = $('#tableRunway'); clear(tbl);
    tbl.appendChild(miniTable([{ t: 'Batch' }, { t: 'Shelf life', n: 1 }, { t: 'Buyer' }, { t: 'Trip', n: 1 }, { t: 'Buyer minimum', n: 1 }, { t: 'Spare', n: 1 }],
      list.map((x) => [x.id + ' ' + (x.commodity || ''), fmtHrs(x.shelf), !x.r ? NA : x.r.spoiled ? 'None' : (x.r.dest_name || x.r.dest_id), fmtHrs(x.trip), fmtHrs(x.min), fmtHrs(x.buffer)])));
  }

  /* ------------------------------------------------------------------
     16. Studio: routes
     ------------------------------------------------------------------ */
  function routeBase(routeId, res) {
    // transit time the engine started from for this result (captured before the request)
    const snap = !res ? [] : res === state.jam ? (res.routesBefore || []) : res === state.plan ? (res.routesUsed || []) : [];
    const hit = snap.find((r) => r.route_id === routeId);
    if (hit && isNum(hit.transit_time_hrs)) return hit.transit_time_hrs;
    const r = ctx().routeById.get(routeId); return r ? num(r.transit_time_hrs) : null;
  }
  function renderRoutes(host, expanded) {
    clear(host);
    const c = ctx();
    if (!c.routes.length) { emptyViz(host, 'No route data', 'Connect the API or open the demo to load routes.', false); return; }
    const res = lensResult();
    const showJam = !!(state.lens === 'replan' && state.jam && res === state.jam);
    const list = c.routes.map((r) => {
      const id = str(r.route_id), d = c.destById.get(str(r.dest_id));
      const base = res ? routeBase(id, res) : num(r.transit_time_hrs);
      const delay = showJam ? jamDelayFor(str(r.dest_id), state.jam) : 0;
      return { id, dest: d, destId: str(r.dest_id), name: d ? str(d.name) : str(r.dest_id), tier: d ? str(d.tier) : null, hrs: base, delay, km: num(r.distance_km), cost: num(r.transport_cost_per_kg), vehicle: str(r.vehicle_type), status: str(r.status) };
    });
    const mKey = state.routeMeasure;
    const val = (x) => (mKey === 'hrs' ? (x.hrs || 0) + x.delay : mKey === 'km' ? x.km || 0 : x.cost || 0);
    const fmtV = (v) => (mKey === 'hrs' ? fmtHrs(v) : mKey === 'km' ? fmtNum(v) + ' km' : fmtINR2(v) + '/kg');
    const W = Math.max(260, host.clientWidth), rowH = expanded ? 58 : 50, top = 4;
    const H = top + list.length * rowH + 4;
    const maxV = Math.max(...list.map(val), 1);
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Route comparison by ' + (mKey === 'hrs' ? 'transit hours' : mKey === 'km' ? 'distance' : 'transport cost per kg') });
    const prev = host._prev || {}; const anims = [];
    list.forEach((x, i) => {
      const y = top + i * rowH;
      const ti = tierInfo(x.tier);
      const g = s('g', { class: 'mark', tabindex: 0, role: 'button', 'aria-label': x.id + ' to ' + x.name + ': ' + fmtV(val(x)) + (x.delay ? ' including a ' + x.delay + ' hour delay' : '') + '. Select for details.' });
      g.appendChild(s('rect', { class: 'hit', x: 0, y, width: W, height: rowH - 4 }));
      g.appendChild(s('text', { x: 0, y: y + 15, class: 'lbl-strong' }, s('tspan', { style: 'font-family:var(--font-mono);font-size:12px', text: x.id + '  ' }), s('tspan', { text: shortName(x.name, Math.max(14, Math.floor((W - (x.delay > 0 ? 190 : 110)) / 7.4))) })));
      g.appendChild(s('text', { x: W, y: y + 15, 'text-anchor': 'end', class: 'lbl-val', text: mKey === 'hrs' && x.delay > 0 ? fmtHrs(x.hrs) + ' + ' + fmtNum(x.delay) + ' h jam' : fmtV(val(x)) }));
      const by = y + 24, bh = 14;
      const baseV = mKey === 'hrs' ? (x.hrs || 0) : val(x);
      const r1 = s('rect', { x: 0, y: by, height: bh, rx: 0, fill: ti ? ti.color : '#9fb3c8', width: 0 });
      g.appendChild(r1); x._anim = { rect: r1, to: baseV / maxV * W, from: prev[x.id] || 0 }; anims.push(x._anim);
      if (mKey === 'hrs' && x.delay > 0) {
        const r2 = s('rect', { y: by, height: bh, fill: 'url(#hatchCoral)', width: 0, x: baseV / maxV * W + 2 });
        g.appendChild(r2); anims.push({ rect: r2, to: Math.max(0, x.delay / maxV * W - 2), from: 0 });
      }
      bindTip(g, () => tipContent(x.id + ' to ' + x.name, [['Vehicle', x.vehicle || NA], ['Distance', isNum(x.km) ? fmtNum(x.km) + ' km' : NA], ['Transit', fmtHrs(x.hrs) + (x.delay ? ' + ' + fmtHrs(x.delay) + ' jam' : '')], ['Transport', isNum(x.cost) ? fmtINR2(x.cost) + '/kg' : NA], ['Status field', x.status || NA]], 'Vehicle capacity is not in the data, so it is not checked.', ti ? ti.color : null));
      activate(g, () => { tip.hide(); openDrawer('route', x.id); });
      svg.appendChild(g);
    });
    host.appendChild(svg);
    tween(650, (t) => anims.forEach((a) => a.rect.setAttribute('width', Math.max(0, lerp(a.from, a.to, t)))), () => { host._prev = Object.fromEntries(list.map((x) => [x.id, x._anim.to])); });
    $('#vizRouteSub').textContent = showJam ? 'Transit includes the simulated +' + jamInfo().delay + ' h on ' + corridorLabel(jamInfo().aff) : 'From the route data' + (state.jam ? '; switch to the re-plan to see the jam' : '');
    const tbl = $('#tableRoutes'); clear(tbl);
    tbl.appendChild(miniTable([{ t: 'Route' }, { t: 'Destination' }, { t: 'Vehicle' }, { t: 'Km', n: 1 }, { t: 'Transit', n: 1 }, { t: 'Jam delay', n: 1 }, { t: '₹/kg', n: 1 }],
      list.map((x) => [x.id, x.name, x.vehicle || NA, isNum(x.km) ? fmtNum(x.km) : NA, fmtHrs(x.hrs), x.delay ? '+' + fmtHrs(x.delay) : '—', isNum(x.cost) ? fmtINR2(x.cost) : NA])));
  }

  function renderStudio() {
    renderTierDonut($('#vizTiers'));
    renderDestBars($('#vizDests'));
    renderRunway($('#vizRunway'));
    renderRoutes($('#vizRoutes'));
    $$('input[name="tierMeasure"]').forEach((i) => { i.checked = i.value === state.tierMeasure; });
    $$('input[name="routeMeasure"]').forEach((i) => { i.checked = i.value === state.routeMeasure; });
    $('#destSort').value = state.destSort;
    const res = lensResult();
    $('#studioSource').textContent = res ? 'Showing ' + lensName() + ': ' + sourceText(res) + '.' : 'Inventory, destinations and routes come from GET /api/data. Run the plan to fill in the allocations.';
  }
  function resetStudioSettings(silent) {
    state.tierMeasure = 'kg'; state.tierHidden.clear(); state.destSort = 'fill'; state.routeMeasure = 'hrs';
    if (!silent) { renderStudio(); toast('info', 'Chart settings reset', 'Measures, sorting and hidden tiers are back to their defaults.'); }
  }
  const CHARTS = {
    tiers: { title: 'How the stock splits across tiers', render: renderTierDonut, table: '#tableTiers' },
    dests: { title: 'How full each destination gets', render: renderDestBars, table: '#tableDests' },
    runway: { title: 'Shelf-life runway', render: renderRunway, table: '#tableRunway' },
    routes: { title: 'Route comparison', render: renderRoutes, table: '#tableRoutes' }
  };

  /* ------------------------------------------------------------------
     17. Network (schematic)
     ------------------------------------------------------------------ */
  const net = { particles: [], raf: 0, visible: false, paths: [] };
  function renderNetwork() {
    const host = $('#netChart'); clear(host);
    cancelAnimationFrame(net.raf); net.particles = []; net.paths = [];
    const c = ctx();
    if (!c.batches.length || !c.dests.length) { emptyViz(host, 'No network data', 'Connect the API or open the demo to load batches, destinations and routes.', false); renderNetDetail(); return; }
    const res = lensResult();
    const rows = res ? buildRows(res) : [];
    const byBatch = new Map(rows.map((r) => [r.batch_id, r]));
    const W = Math.max(320, host.clientWidth);
    const vertical = W < 640;
    const hubName = (c.routes[0] && str(c.routes[0].origin_hub)) || 'Aggregation hub';
    // destination groups by tier, plus unknown/unallocated
    const dests = c.dests.map((d) => ({ id: str(d.dest_id), name: str(d.name) || str(d.dest_id), tier: str(d.tier), demand: num(d.demand_kg), d })).sort((a, b) => ((tierInfo(a.tier) || { n: 9 }).n - (tierInfo(b.tier) || { n: 9 }).n) || a.id.localeCompare(b.id));
    rows.forEach((r) => { if (!r.spoiled && r.dest_id && !dests.find((x) => x.id === r.dest_id)) dests.push({ id: r.dest_id, name: (r.dest_name || r.dest_id) + ' (not in data)', tier: r.tier, demand: null, unknown: true }); });
    const lostKg = res ? (isNum(readMetrics(res.payload.metrics).oSpoilKg) ? readMetrics(res.payload.metrics).oSpoilKg : sum(rows, (r) => (r.spoiled ? r.qty : r.shortfall))) : 0;
    const nodesD = dests.concat(res && lostKg > 0 ? [{ id: 'LOST', name: 'Unallocated', lost: true, demand: null }] : []);
    const batches = c.batches.map((b) => ({ id: str(b.batch_id), name: str(b.commodity), qty: num(b.quantity_kg), shelf: num(b.shelf_life_hrs), b, r: byBatch.get(str(b.batch_id)) || null }));
    // allocated kg per dest
    const destKg = new Map(); rows.forEach((r) => { if (!r.spoiled && r.dest_id) destKg.set(r.dest_id, (destKg.get(r.dest_id) || 0) + (r.allocated_kg || 0)); });
    const maxQ = Math.max(...batches.map((b) => b.qty || 0), 1);
    const maxFlow = Math.max(maxQ, ...Array.from(destKg.values()), lostKg, 1);
    const wOf = (kg) => 1.5 + 12 * Math.sqrt(Math.max(0, kg) / maxFlow);
    let H, hub, place;
    if (!vertical) {
      H = Math.max(440, Math.max(batches.length, nodesD.length + 1) * 62 + 40);
      const bx = Math.min(170, W * 0.2), dx = W - Math.min(250, W * 0.3);
      hub = { x: (bx + dx) / 2 - 10, y: H / 2, r: 44 };
      batches.forEach((b, i) => { b.x = bx; b.y = 40 + (i + 0.5) * ((H - 80) / batches.length); });
      // tier group gaps
      let slot = 0; const slots = []; let lastTier = null;
      nodesD.forEach((d) => { const t = d.lost ? 'lost' : d.tier; if (lastTier !== null && t !== lastTier) slot += 0.6; slots.push(slot); slot += 1; lastTier = t; });
      const span = slot - 1 || 1;
      nodesD.forEach((d, i) => { d.x = dx; d.y = 50 + slots[i] / span * (H - 100); });
      place = 'h';
    } else {
      H = 600;
      hub = { x: W / 2, y: H / 2 - 20, r: 34 };
      batches.forEach((b, i) => { b.x = 24 + (i + 0.5) * ((W - 48) / batches.length); b.y = 74; });
      nodesD.forEach((d, i) => { d.x = 24 + (i + 0.5) * ((W - 48) / nodesD.length); d.y = H - 120; });
      place = 'v';
    }
    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': 'Schematic network of batches, the hub and destinations for ' + lensName() });
    const defs = s('defs');
    defs.appendChild(s('radialGradient', { id: 'hubGrad', cx: '.4', cy: '.35', r: '.8' }, s('stop', { offset: 0, 'stop-color': '#e9f7ff' }), s('stop', { offset: '.55', 'stop-color': '#7fc9ee' }), s('stop', { offset: 1, 'stop-color': '#2a6fae' })));
    svg.appendChild(defs);
    const gEdges = s('g'), gPart = s('g', { 'pointer-events': 'none' }), gNodes = s('g'), gPills = s('g');
    svg.append(gEdges, gPart, gNodes, gPills);
    const curve = (x1, y1, x2, y2) => place === 'h'
      ? 'M' + x1 + ' ' + y1 + 'C' + (x1 + (x2 - x1) * 0.5) + ' ' + y1 + ' ' + (x1 + (x2 - x1) * 0.5) + ' ' + y2 + ' ' + x2 + ' ' + y2
      : 'M' + x1 + ' ' + y1 + 'C' + x1 + ' ' + (y1 + (y2 - y1) * 0.5) + ' ' + x2 + ' ' + (y1 + (y2 - y1) * 0.5) + ' ' + x2 + ' ' + y2;
    const edges = [];
    // inbound: batch -> hub
    batches.forEach((b) => {
      const r = 8 + 12 * Math.sqrt((b.qty || 0) / maxQ); b.rad = r;
      const x1 = place === 'h' ? b.x + r : b.x, y1 = place === 'h' ? b.y : b.y + r;
      const x2 = place === 'h' ? hub.x - hub.r : hub.x, y2 = place === 'h' ? hub.y : hub.y - hub.r;
      const p = s('path', { class: 'net-edge', d: curve(x1, y1, x2, y2), fill: 'none', stroke: b.r && b.r.spoiled ? 'url(#hatchCoral)' : '#6f8fb8', 'stroke-opacity': b.r && b.r.spoiled ? 0.9 : 0.42, 'stroke-width': wOf(b.qty || 0), 'stroke-linecap': 'round' });
      gEdges.appendChild(p); edges.push({ el: p, from: 'B:' + b.id, to: 'HUB', batch: b.id, dest: b.r && !b.r.spoiled ? b.r.dest_id : (b.r && b.r.spoiled ? 'LOST' : null) });
      if (b.qty) net.paths.push({ el: p, n: 1, dur: 3200, color: '#cfe6f6' });
    });
    // outbound: hub -> destination (route)
    nodesD.forEach((d) => {
      const kg = d.lost ? lostKg : (destKg.get(d.id) || 0);
      const ti = tierInfo(d.tier);
      const route = d.lost ? null : c.routeByDest.get(d.id);
      const delay = state.lens === 'replan' && res && res === state.jam ? jamDelayFor(d.id, state.jam) : 0;
      const x1 = place === 'h' ? hub.x + hub.r : hub.x, y1 = place === 'h' ? hub.y : hub.y + hub.r;
      const x2 = place === 'h' ? d.x - 16 : d.x, y2 = place === 'h' ? d.y : d.y - 16;
      const dpath = curve(x1, y1, x2, y2);
      const color = d.lost ? LOST.color : ti ? ti.color : '#9fb3c8';
      const p = s('path', { class: 'net-edge', d: dpath, fill: 'none', stroke: color, 'stroke-opacity': kg > 0 ? 0.75 : 0.18, 'stroke-width': kg > 0 ? wOf(kg) : 1.2, 'stroke-dasharray': d.lost ? '6 6' : (kg > 0 ? null : '3 5'), 'stroke-linecap': 'round' });
      gEdges.appendChild(p);
      if (delay > 0) gEdges.appendChild(s('path', { d: dpath, fill: 'none', stroke: '#ff7461', 'stroke-width': Math.max(2, wOf(kg) + 4), 'stroke-opacity': 0.28, 'stroke-dasharray': '2 6', 'pointer-events': 'none' }));
      edges.push({ el: p, from: 'HUB', to: d.lost ? 'LOST' : 'D:' + d.id, dest: d.id });
      if (kg > 0 && !d.lost) {
        const transit = route ? num(route.transit_time_hrs) || 4 : 4;
        net.paths.push({ el: p, n: clamp(Math.round(kg / 900), 1, 5), dur: 2200 + (transit + delay) * 380, color });
      }
      // route pill
      if (route) {
        const mid = p.getPointAtLength ? null : null; // computed after attach
        const label = str(route.route_id) + '  ' + fmtHrs(routeBase(str(route.route_id), res) || num(route.transit_time_hrs)) + (delay ? '  +' + fmtNum(delay) + ' h' : '');
        const pill = s('g', { class: 'route-pill mark' + (delay ? ' is-jam' : ''), tabindex: 0, role: 'button', 'aria-label': 'Route ' + str(route.route_id) + ' to ' + d.name + (delay ? ', with a ' + delay + ' hour delay' : '') + '. Select for details.' });
        const tw = label.length * 6.6 + 16;
        pill.appendChild(s('rect', { width: tw, height: 22, rx: 11 }));
        pill.appendChild(s('text', { x: tw / 2, y: 15, 'text-anchor': 'middle', text: label }));
        pill._pos = { p, tw };
        activate(pill, () => selectNet({ kind: 'route', id: str(route.route_id) }));
        bindTip(pill, () => tipContent('Route ' + str(route.route_id), [['To', d.name], ['Vehicle', str(route.vehicle_type) || NA], ['Transit', fmtHrs(num(route.transit_time_hrs)) + (delay ? ' + ' + fmtHrs(delay) + ' jam' : '')], ['Allocated on it', fmtKg(kg)]], null, color));
        gPills.appendChild(pill);
      }
    });
    // nodes: batches
    batches.forEach((b) => {
      const spoiled = b.r && b.r.spoiled;
      const g = s('g', { class: 'net-node', tabindex: 0, role: 'button', 'data-node': 'B:' + b.id, 'aria-label': 'Batch ' + b.id + ', ' + (b.name || '') + ', ' + fmtKg(b.qty) + (b.r ? (spoiled ? ', no feasible buyer' : ', to ' + (b.r.dest_name || b.r.dest_id)) : '') });
      g.appendChild(s('circle', { class: 'node-pulse', cx: b.x, cy: b.y, r: 0, fill: 'none', stroke: commodityColor(b.name), 'stroke-width': 2 }));
      g.appendChild(s('circle', { class: 'node-ring', cx: b.x, cy: b.y, r: b.rad + 3, fill: '#081426', stroke: spoiled ? '#ff7461' : 'rgba(207,230,246,0.5)', 'stroke-width': 1.5, 'stroke-dasharray': spoiled ? '3 3' : null }));
      g.appendChild(s('circle', { cx: b.x, cy: b.y, r: b.rad, fill: commodityColor(b.name) }));
      g.appendChild(s('circle', { cx: b.x - b.rad * 0.3, cy: b.y - b.rad * 0.35, r: b.rad * 0.28, fill: '#fff', opacity: 0.28 }));
      if (place === 'h') {
        g.appendChild(s('text', { x: b.x - b.rad - 10, y: b.y - 2, 'text-anchor': 'end', class: 'net-label', text: b.id }));
        g.appendChild(s('text', { x: b.x - b.rad - 10, y: b.y + 13, 'text-anchor': 'end', class: 'net-sub', text: shortName(b.name || '', 18) + ', ' + fmtCompact(b.qty) + ' kg' }));
      } else {
        g.appendChild(s('text', { x: b.x, y: b.y - b.rad - 10, 'text-anchor': 'middle', class: 'net-label', style: 'font-size:11px', text: b.id }));
      }
      activate(g, () => selectNet({ kind: 'batch', id: b.id }));
      g.addEventListener('pointerenter', () => highlight('B:' + b.id)); g.addEventListener('pointerleave', () => highlight(null));
      g.addEventListener('focus', () => highlight('B:' + b.id)); g.addEventListener('blur', () => highlight(null));
      gNodes.appendChild(g);
    });
    // hub
    const hubG = s('g', { class: 'net-node', tabindex: 0, role: 'button', 'data-node': 'HUB', 'aria-label': hubName + ', the origin of every route' });
    hubG.appendChild(s('circle', { class: 'node-pulse', cx: hub.x, cy: hub.y, r: 0, fill: 'none', stroke: '#5ee3f5', 'stroke-width': 2 }));
    hubG.appendChild(s('circle', { cx: hub.x, cy: hub.y, r: hub.r + 14, fill: 'rgba(94,227,245,0.06)' }));
    hubG.appendChild(s('circle', { class: 'node-ring', cx: hub.x, cy: hub.y, r: hub.r, fill: 'url(#hubGrad)', stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 1.5 }));
    const sf = s('g', { stroke: '#0b1a33', 'stroke-width': 3.2, 'stroke-linecap': 'round', transform: 'translate(' + hub.x + ' ' + hub.y + ')' });
    const k = hub.r * 0.45;
    sf.appendChild(s('path', { d: 'M0 ' + (-k) + 'V' + k + 'M' + (-k * 0.87) + ' ' + (-k / 2) + 'L' + (k * 0.87) + ' ' + (k / 2) + 'M' + (-k * 0.87) + ' ' + (k / 2) + 'L' + (k * 0.87) + ' ' + (-k / 2) }));
    hubG.appendChild(sf);
    if (place === 'v') hubG.appendChild(s('rect', { x: hub.x - 120, y: hub.y + hub.r + 6, width: 240, height: 38, rx: 8, fill: 'rgba(6,15,30,0.85)' }));
    hubG.appendChild(s('text', { x: hub.x, y: hub.y + hub.r + 22, 'text-anchor': 'middle', class: 'net-label', text: place === 'h' ? hubName : shortName(hubName, 30) }));
    hubG.appendChild(s('text', { x: hub.x, y: hub.y + hub.r + 38, 'text-anchor': 'middle', class: 'net-sub', text: fmtKg(sum(batches, (b) => b.qty)) + ' in, ' + c.routes.length + ' routes out' }));
    activate(hubG, () => selectNet({ kind: 'hub', id: 'HUB' }));
    gNodes.appendChild(hubG);
    // destinations
    nodesD.forEach((d) => {
      const kg = d.lost ? lostKg : (destKg.get(d.id) || 0);
      const ti = tierInfo(d.tier);
      const color = d.lost ? LOST.color : ti ? ti.color : '#9fb3c8';
      const r = 14;
      const g = s('g', { class: 'net-node', tabindex: 0, role: 'button', 'data-node': d.lost ? 'LOST' : 'D:' + d.id, 'aria-label': (d.lost ? 'Unallocated stock: ' + fmtKg(kg) : d.name + ', ' + (ti ? ti.short : '') + ', ' + fmtKg(kg) + ' allocated of ' + fmtKg(d.demand) + ' demand') });
      g.appendChild(s('circle', { class: 'node-pulse', cx: d.x, cy: d.y, r: 0, fill: 'none', stroke: color, 'stroke-width': 2 }));
      g.appendChild(s('circle', { cx: d.x, cy: d.y, r: r + 6, fill: 'none', stroke: 'rgba(160,200,255,0.12)', 'stroke-width': 4 }));
      if (!d.lost && isNum(d.demand) && d.demand > 0 && res) {
        const frac = clamp(kg / d.demand, 0, 1), C = 2 * Math.PI * (r + 6);
        g.appendChild(s('circle', { cx: d.x, cy: d.y, r: r + 6, fill: 'none', stroke: color, 'stroke-width': 4, 'stroke-dasharray': (C * frac) + ' ' + C, transform: 'rotate(-90 ' + d.x + ' ' + d.y + ')', 'stroke-linecap': 'round' }));
      }
      g.appendChild(s('circle', { class: 'node-ring', cx: d.x, cy: d.y, r, fill: d.lost ? 'url(#hatchCoral)' : color, stroke: '#081426', 'stroke-width': 2 }));
      if (place === 'h') {
        g.appendChild(s('text', { x: d.x + r + 14, y: d.y - 2, class: 'net-label', text: shortName(d.name, Math.max(14, Math.floor((W - d.x - 30) / 7.2))) }));
        g.appendChild(s('text', { x: d.x + r + 14, y: d.y + 13, class: 'net-sub', text: d.lost ? fmtKg(kg) + ' with no buyer' : (ti ? ti.short : 'Unknown tier') + (res ? ', ' + fmtCompact(kg) + ' / ' + fmtCompact(d.demand) + ' kg' : ', ' + fmtCompact(d.demand) + ' kg demand') }));
      } else {
        g.appendChild(s('text', { x: d.x, y: d.y + r + 22, 'text-anchor': 'middle', class: 'net-label', style: 'font-size:11px', text: d.lost ? 'Lost' : d.id }));
        if (res) g.appendChild(s('text', { x: d.x, y: d.y + r + 36, 'text-anchor': 'middle', class: 'net-sub', style: 'font-size:10.5px', text: fmtCompact(kg) }));
      }
      activate(g, () => selectNet(d.lost ? { kind: 'lost', id: 'LOST' } : { kind: 'dest', id: d.id }));
      const key = d.lost ? 'LOST' : 'D:' + d.id;
      g.addEventListener('pointerenter', () => highlight(key)); g.addEventListener('pointerleave', () => highlight(null));
      g.addEventListener('focus', () => highlight(key)); g.addEventListener('blur', () => highlight(null));
      gNodes.appendChild(g);
    });
    if (place === 'v') {
      svg.appendChild(s('text', { x: 24, y: 16, class: 'lbl-mut', text: 'Batches' }));
      svg.appendChild(s('text', { x: 24, y: H - 14, class: 'lbl-mut', text: 'Buyers. Select one for its name and details.' }));
    }
    host.appendChild(svg);
    // place route pills at path midpoints now that paths are in the DOM
    $$('.route-pill', svg).forEach((pill) => {
      const { p, tw } = pill._pos; const L = p.getTotalLength(); const pt = p.getPointAtLength(L * (place === 'h' ? 0.74 : 0.55));
      const x = place === 'v' ? clamp(pt.x - tw / 2, 2, W - tw - 2) : pt.x - tw / 2;
      pill.setAttribute('transform', 'translate(' + x + ' ' + (pt.y - 11) + ')');
      if (place === 'v') pill.style.display = 'none';
    });
    function highlight(key) {
      if (!key) { edges.forEach((e) => e.el.classList.remove('is-dim')); $$('.net-node', svg).forEach((n) => n.classList.remove('is-dim')); return; }
      let keepDest = new Set(), keepBatch = new Set();
      if (key.startsWith('B:')) { const b = batches.find((x) => 'B:' + x.id === key); keepBatch.add(b.id); if (b.r) keepDest.add(b.r.spoiled ? 'LOST' : b.r.dest_id); }
      else if (key.startsWith('D:') || key === 'LOST') { const id = key === 'LOST' ? 'LOST' : key.slice(2); keepDest.add(id); batches.forEach((b) => { if (b.r && ((id === 'LOST' && (b.r.spoiled || b.r.shortfall > 0)) || (!b.r.spoiled && b.r.dest_id === id))) keepBatch.add(b.id); }); }
      edges.forEach((e) => {
        const on = (e.batch && keepBatch.has(e.batch)) || (!e.batch && keepDest.has(e.dest === undefined ? '' : (e.to === 'LOST' ? 'LOST' : e.dest)));
        e.el.classList.toggle('is-dim', !on);
      });
      $$('.net-node', svg).forEach((n) => {
        const k2 = n.dataset.node;
        const on = k2 === 'HUB' || (k2.startsWith('B:') && keepBatch.has(k2.slice(2))) || (k2 === 'LOST' && keepDest.has('LOST')) || (k2.startsWith('D:') && keepDest.has(k2.slice(2)));
        n.classList.toggle('is-dim', !on);
      });
    }
    // selection state
    if (state.netSelected) {
      const sel = state.netSelected;
      const key = sel.kind === 'batch' ? 'B:' + sel.id : sel.kind === 'dest' ? 'D:' + sel.id : sel.kind === 'hub' ? 'HUB' : sel.kind === 'lost' ? 'LOST' : null;
      if (key) { const n = svg.querySelector('[data-node="' + key + '"]'); if (n) n.classList.add('is-selected'); }
    }
    renderNetDetail();
    startParticles(gPart);
  }
  function startParticles(layer) {
    cancelAnimationFrame(net.raf);
    clear(layer); net.particles = [];
    if (reduceMotion.matches) return;
    net.paths.forEach((pp) => {
      const L = pp.el.getTotalLength();
      for (let i = 0; i < pp.n; i++) {
        const dot = s('circle', { r: 2.6, fill: pp.color, opacity: 0, cx: -20, cy: -20 });
        layer.appendChild(dot);
        net.particles.push({ dot, el: pp.el, L, dur: pp.dur, off: i / pp.n });
      }
    });
    const t0 = performance.now();
    function frame(now) {
      if (net.visible && !document.hidden) {
        net.particles.forEach((p) => {
          const t = (((now - t0) / p.dur) + p.off) % 1;
          const pt = p.el.getPointAtLength(t * p.L);
          p.dot.setAttribute('cx', pt.x); p.dot.setAttribute('cy', pt.y);
          p.dot.setAttribute('opacity', p.el.classList.contains('is-dim') ? 0.08 : (t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1) * 0.9);
        });
      }
      net.raf = requestAnimationFrame(frame);
    }
    net.raf = requestAnimationFrame(frame);
  }
  function selectNet(sel) {
    state.netSelected = sel;
    $$('#netChart .net-node').forEach((n) => n.classList.remove('is-selected'));
    const key = sel.kind === 'batch' ? 'B:' + sel.id : sel.kind === 'dest' ? 'D:' + sel.id : sel.kind === 'hub' ? 'HUB' : sel.kind === 'lost' ? 'LOST' : null;
    if (key) { const n = $('#netChart [data-node="' + key + '"]'); if (n) n.classList.add('is-selected'); }
    renderNetDetail();
    if (window.innerWidth < 1140) $('#netDetail').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'nearest' });
  }
  function ndRow(k, v) { return h('div', { class: 'nd-row' }, h('span', { text: k }), h('b', { text: v })); }
  function renderNetDetail() {
    const el = $('#netDetail'); clear(el);
    const sel = state.netSelected; const c = ctx(); const res = lensResult(); const rows = res ? buildRows(res) : [];
    if (!sel) { el.appendChild(h('p', { class: 'net-detail-empty', text: 'Select a batch, the hub, a route or a buyer to see its details here.' })); return; }
    if (sel.kind === 'batch') {
      const b = c.batchById.get(sel.id); if (!b) return;
      const r = rows.find((x) => x.batch_id === sel.id);
      el.append(h('p', { class: 'nd-kind', text: 'Batch' }), h('h3', { class: 'nd-title', text: sel.id + ', ' + (str(b.commodity) || '') }),
        h('div', { class: 'nd-list' }, ndRow('Quantity', fmtKg(num(b.quantity_kg))), ndRow('Shelf life', fmtHrs(num(b.shelf_life_hrs))), ndRow('Grade', str(b.quality_grade) || NA), ndRow('Base cost', fmtINR2(num(b.base_cost_per_kg)) + '/kg'),
          ndRow('In ' + lensName(), !r ? (res ? 'Not listed' : 'Run the plan') : r.spoiled ? 'No feasible buyer' : (r.dest_name || r.dest_id) + ', ' + fmtKg(r.allocated_kg))),
        r && r.reasoning ? h('p', { class: 'reasoning' + (res.source === 'demo' ? ' is-demo' : res.source === 'api_fallback' ? ' is-fallback' : ''), style: { fontSize: '14px' }, text: r.reasoning }) : null,
        h('div', { class: 'nd-actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Open full details', onclick: () => openDrawer('batch', sel.id) })));
    } else if (sel.kind === 'dest') {
      const d = c.destById.get(sel.id); if (!d) return;
      const into = rows.filter((x) => !x.spoiled && x.dest_id === sel.id);
      const kg = sum(into, (x) => x.allocated_kg);
      el.append(h('p', { class: 'nd-kind', text: (tierInfo(d.tier) || { short: 'Destination' }).short }), h('h3', { class: 'nd-title', text: str(d.name) }),
        h('div', { class: 'nd-list' }, ndRow('Demand', fmtKg(num(d.demand_kg))), ndRow('Allocated', res ? fmtKg(kg) + (num(d.demand_kg) ? ' (' + fmtPct(kg / num(d.demand_kg) * 100) + ')' : '') : 'Run the plan'),
          ndRow('Offer price', fmtINR2(num(d.offering_price_per_kg)) + '/kg'), ndRow('Minimum shelf life on arrival', fmtHrs(num(d.min_shelf_life_hrs))), ndRow('Transit', fmtHrs(num(d.transit_time_hrs)) + (state.lens === 'replan' && jamDelayFor(sel.id) ? ' + ' + fmtHrs(jamDelayFor(sel.id)) + ' jam' : ''))),
        into.length ? h('div', { class: 'nd-flows' }, into.map((x) => h('div', { class: 'nd-flow' }, h('span', { text: x.batch_id + ' ' + (x.commodity || '') }), h('b', { text: fmtKg(x.allocated_kg) })))) : (res ? h('p', { class: 'net-detail-empty', style: { marginTop: '12px' }, text: 'Nothing allocated here in ' + lensName() + '.' }) : null),
        h('div', { class: 'nd-actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Open full details', onclick: () => openDrawer('dest', sel.id) }), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Show in explorer', onclick: () => filterExplorer({ q: str(d.name) }) })));
    } else if (sel.kind === 'route') {
      const r = c.routeById.get(sel.id); if (!r) return;
      const d = c.destById.get(str(r.dest_id));
      const delay = state.lens === 'replan' ? jamDelayFor(str(r.dest_id)) : 0;
      el.append(h('p', { class: 'nd-kind', text: 'Route' }), h('h3', { class: 'nd-title', text: sel.id + ' to ' + (d ? str(d.name) : str(r.dest_id)) }),
        h('div', { class: 'nd-list' }, ndRow('From', str(r.origin_hub) || NA), ndRow('Vehicle', str(r.vehicle_type) || NA), ndRow('Distance', fmtNum(num(r.distance_km)) + ' km'), ndRow('Transit', fmtHrs(routeBase(sel.id, res) || num(r.transit_time_hrs)) + (delay ? ' + ' + fmtHrs(delay) + ' simulated jam' : '')), ndRow('Transport cost', fmtINR2(num(r.transport_cost_per_kg)) + '/kg'), ndRow('Status field', str(r.status) || NA)),
        h('p', { class: 'net-note', text: 'The data has no numeric vehicle capacity, so loads are not checked against the vehicle.' }),
        h('div', { class: 'nd-actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Open full details', onclick: () => openDrawer('route', sel.id) })));
    } else if (sel.kind === 'hub') {
      el.append(h('p', { class: 'nd-kind', text: 'Origin' }), h('h3', { class: 'nd-title', text: (c.routes[0] && str(c.routes[0].origin_hub)) || 'Hub' }),
        h('div', { class: 'nd-list' }, ndRow('Batches', String(c.batches.length)), ndRow('Stock', fmtKg(sum(c.batches, (b) => b.quantity_kg))), ndRow('Routes out', String(c.routes.length))),
        h('p', { class: 'net-note', text: 'Every route in the data starts here, so it is drawn as a single hub.' }));
    } else if (sel.kind === 'lost') {
      const lost = rows.filter((x) => x.spoiled || x.shortfall > 0);
      el.append(h('p', { class: 'nd-kind', text: 'Unallocated' }), h('h3', { class: 'nd-title', text: fmtKg(readMetrics(res && res.payload.metrics).oSpoilKg) + ' with no buyer' }),
        h('div', { class: 'nd-flows' }, lost.map((x) => h('div', { class: 'nd-flow' }, h('span', { text: x.batch_id + (x.spoiled ? ', no feasible buyer' : ', left over at ' + (x.dest_id || '')) }), h('b', { text: fmtKg(x.spoiled ? x.qty : x.shortfall) })))),
        h('p', { class: 'net-note', text: 'The engine sends each batch to one buyer; whatever that buyer cannot take is counted here.' }));
    }
  }

  /* ------------------------------------------------------------------
     18. Explorer
     ------------------------------------------------------------------ */
  function barCell(v, max, color, text) {
    const fill = h('span', { class: 'fill', style: { width: (isNum(v) && max ? clamp(v / max, 0, 1) * 100 : 0) + '%', background: color || null } });
    return h('span', { class: 'cell-bar' }, h('span', { class: 'track' }, fill), h('span', { text }));
  }
  function exColumns(tab) {
    const c = ctx();
    const res = lensResult();
    const rows = res ? buildRows(res) : [];
    const byBatch = new Map(rows.map((r) => [r.batch_id, r]));
    if (tab === 'alloc') {
      return {
        rows, key: (r) => 'a' + r.idx, open: (r) => openDrawer('alloc', r.idx),
        tierOf: (r) => (r.spoiled ? '' : r.tier), statusOf: (r) => r.status,
        text: (r) => [r.batch_id, r.commodity, r.dest_name, r.dest_id, r.tier, r.action, r.status].join(' '),
        lost: (r) => r.spoiled,
        cols: [
          { k: 'batch_id', t: 'Batch', v: (r) => r.batch_id, cell: (r) => h('td', null, h('span', { class: 'id', text: r.batch_id || NA }), h('span', { class: 'cell-sub', text: r.commodity || '' })) },
          { k: 'dest_name', t: 'Destination', v: (r) => r.dest_name, cell: (r) => h('td', { class: 'wrap' }, r.spoiled ? h('span', { class: 'neg', text: r.dest_name || 'Unallocated' }) : (r.dest_name || NA), h('span', { class: 'cell-sub', text: (r.dest_id || '') + (r.unknownDest ? ', not in /api/data' : '') })) },
          { k: 'tier', t: 'Tier and action', v: (r) => (r.spoiled ? 9 : (tierInfo(r.tier) || { n: 8 }).n), cell: (r) => h('td', null, tierTag(r.tier, r.spoiled), h('span', { class: 'cell-sub', style: { marginTop: '4px' }, text: actionLabel(r.action) + (isNum(r.discount_pct) && r.discount_pct > 0 ? ', ' + fmtPct(r.discount_pct) + ' off' : '') })) },
          { k: 'allocated_kg', t: 'Allocated', n: 1, v: (r) => r.allocated_kg, cell: (r) => h('td', { class: 'n' }, barCell(r.allocated_kg, r.qty || r.allocated_kg, r.spoiled ? '#ff7461' : (tierInfo(r.tier) || {}).color, fmtKg(r.allocated_kg)), r.shortfall > 0 ? h('span', { class: 'cell-sub neg', text: fmtKg(r.shortfall) + ' left over' }) : null) },
          { k: 'effective_price_per_kg', t: 'Price/kg', n: 1, title: 'effective_price_per_kg, with transport_cost_per_kg underneath', v: (r) => r.effective_price_per_kg, cell: (r) => h('td', { class: 'n' }, fmtINR2(r.effective_price_per_kg), h('span', { class: 'cell-sub', text: 'transport ' + fmtINR2(r.transport_cost_per_kg) })) },
          { k: 'net_profit', t: 'Contribution', n: 1, title: 'API field net_profit: allocated kg × (price − transport). Acquisition cost not included.', v: (r) => r.net_profit, cell: (r) => h('td', { class: 'n' }, h('span', { class: isNum(r.net_profit) && r.net_profit > 0 ? 'pos' : isNum(r.net_profit) && r.net_profit < 0 ? 'neg' : '', text: fmtINR(r.net_profit) })) },
          { k: 'margin_hrs', t: 'Margin', n: 1, title: 'API field margin_hrs: shelf life left on arrival.', v: (r) => r.margin_hrs, cell: (r) => h('td', { class: 'n', text: fmtHrs(r.margin_hrs) }) },
          { k: 'status', t: 'Status', v: (r) => r.status, cell: (r) => h('td', null, statusEl(r.status)) },
          { k: '_why', t: '', nosort: 1, cls: 'col-why', cell: (r) => h('td', { class: 'col-why' }, h('button', { type: 'button', class: 'why-btn', text: 'Why?', 'aria-label': 'Why ' + (r.batch_id || '') + ' went here', onclick: (e) => { e.stopPropagation(); openDrawer('alloc', r.idx); } })) }
        ]
      };
    }
    if (tab === 'batch') {
      const maxQ = Math.max(...c.batches.map((b) => num(b.quantity_kg) || 0), 1);
      const maxS = Math.max(...c.batches.map((b) => num(b.shelf_life_hrs) || 0), 1);
      const list = c.batches.map((b) => ({ b, id: str(b.batch_id), r: byBatch.get(str(b.batch_id)) || null }));
      return {
        rows: list, key: (x) => 'b' + x.id, open: (x) => openDrawer('batch', x.id),
        tierOf: (x) => (x.r && !x.r.spoiled ? x.r.tier : ''), statusOf: (x) => (x.r ? x.r.status : ''),
        text: (x) => [x.id, x.b.commodity, x.b.quality_grade, x.r && x.r.dest_name].join(' '), lost: (x) => x.r && x.r.spoiled,
        cols: [
          { k: 'batch_id', t: 'Batch', v: (x) => x.id, cell: (x) => h('td', null, h('span', { class: 'id', text: x.id || NA })) },
          { k: 'commodity', t: 'Produce', v: (x) => str(x.b.commodity), cell: (x) => h('td', null, h('span', { class: 'swatch', style: { display: 'inline-block', marginRight: '8px', verticalAlign: '-1px', background: commodityColor(x.b.commodity), borderRadius: '50%' } }), str(x.b.commodity) || NA) },
          { k: 'quantity_kg', t: 'Quantity', n: 1, v: (x) => num(x.b.quantity_kg), cell: (x) => h('td', { class: 'n' }, barCell(num(x.b.quantity_kg), maxQ, '#6f8fb8', fmtKg(num(x.b.quantity_kg)))) },
          { k: 'shelf_life_hrs', t: 'Shelf life', n: 1, v: (x) => num(x.b.shelf_life_hrs), cell: (x) => h('td', { class: 'n' }, barCell(num(x.b.shelf_life_hrs), maxS, (num(x.b.shelf_life_hrs) || 0) <= 20 ? '#ff7461' : '#2ccbe6', fmtHrs(num(x.b.shelf_life_hrs)))) },
          { k: 'quality_grade', t: 'Grade', v: (x) => str(x.b.quality_grade), cell: (x) => h('td', { text: str(x.b.quality_grade) || NA }) },
          { k: 'base_cost_per_kg', t: 'Base cost/kg', n: 1, v: (x) => num(x.b.base_cost_per_kg), cell: (x) => h('td', { class: 'n', text: fmtINR2(num(x.b.base_cost_per_kg)) }) },
          { k: '_dest', t: res ? 'Goes to' : 'Goes to (run the plan)', v: (x) => (x.r ? x.r.dest_name : ''), cell: (x) => h('td', { class: 'wrap' }, !x.r ? h('span', { class: 'cell-sub', text: res ? 'Not in the plan' : '—' }) : x.r.spoiled ? h('span', { class: 'neg', text: 'No feasible buyer' }) : (x.r.dest_name || x.r.dest_id), x.r && !x.r.spoiled ? h('span', { class: 'cell-sub', text: (tierInfo(x.r.tier) || { short: '' }).short }) : null) },
          { k: '_status', t: 'Status', v: (x) => (x.r ? x.r.status : ''), cell: (x) => h('td', null, x.r ? statusEl(x.r.status) : '—') }
        ]
      };
    }
    if (tab === 'dest') {
      const stats = destStats(res).filter((e) => !e.unknown);
      const maxD = Math.max(...stats.map((e) => e.demand || 0), 1);
      return {
        rows: stats, key: (e) => 'd' + e.id, open: (e) => openDrawer('dest', e.id), tierOf: (e) => e.tier, statusOf: () => '',
        text: (e) => [e.id, e.name, e.tier].join(' '), lost: () => false,
        cols: [
          { k: 'dest_id', t: 'ID', v: (e) => e.id, cell: (e) => h('td', null, h('span', { class: 'id', text: e.id })) },
          { k: 'name', t: 'Destination', v: (e) => e.name, cell: (e) => h('td', { class: 'wrap', text: e.name }) },
          { k: 'tier', t: 'Tier', v: (e) => (tierInfo(e.tier) || { n: 9 }).n, cell: (e) => h('td', null, tierTag(e.tier)) },
          { k: 'demand_kg', t: 'Demand', n: 1, v: (e) => e.demand, cell: (e) => h('td', { class: 'n', text: fmtKg(e.demand) }) },
          { k: '_kg', t: 'Allocated', n: 1, v: (e) => e.kg, cell: (e) => h('td', { class: 'n' }, res ? barCell(e.kg, e.demand || maxD, (tierInfo(e.tier) || {}).color, fmtKg(e.kg)) : '—') },
          { k: 'offering_price_per_kg', t: 'Price/kg', n: 1, v: (e) => num(e.dest.offering_price_per_kg), cell: (e) => h('td', { class: 'n', text: fmtINR2(num(e.dest.offering_price_per_kg)) }) },
          { k: 'min_shelf_life_hrs', t: 'Min shelf life', n: 1, v: (e) => num(e.dest.min_shelf_life_hrs), cell: (e) => h('td', { class: 'n', text: fmtHrs(num(e.dest.min_shelf_life_hrs)) }) },
          { k: 'transit_time_hrs', t: 'Transit', n: 1, v: (e) => num(e.dest.transit_time_hrs), cell: (e) => h('td', { class: 'n', text: fmtHrs(num(e.dest.transit_time_hrs)) }) },
          { k: 'transport_cost_per_kg', t: 'Transport/kg', n: 1, v: (e) => num(e.dest.transport_cost_per_kg), cell: (e) => h('td', { class: 'n', text: fmtINR2(num(e.dest.transport_cost_per_kg)) }) }
        ]
      };
    }
    const list = c.routes.map((r) => ({ r, id: str(r.route_id), d: c.destById.get(str(r.dest_id)), delay: state.lens === 'replan' && state.jam ? jamDelayFor(str(r.dest_id)) : 0 }));
    return {
      rows: list, key: (x) => 'r' + x.id, open: (x) => openDrawer('route', x.id), tierOf: (x) => (x.d ? x.d.tier : ''), statusOf: (x) => str(x.r.status),
      text: (x) => [x.id, x.r.dest_id, x.d && x.d.name, x.r.vehicle_type, x.r.status].join(' '), lost: () => false,
      cols: [
        { k: 'route_id', t: 'Route', v: (x) => x.id, cell: (x) => h('td', null, h('span', { class: 'id', text: x.id })) },
        { k: 'dest', t: 'Destination', v: (x) => (x.d ? str(x.d.name) : str(x.r.dest_id)), cell: (x) => h('td', { class: 'wrap' }, x.d ? str(x.d.name) : str(x.r.dest_id), h('span', { class: 'cell-sub', text: str(x.r.dest_id) || '' })) },
        { k: 'vehicle_type', t: 'Vehicle', v: (x) => str(x.r.vehicle_type), cell: (x) => h('td', { text: str(x.r.vehicle_type) || NA }) },
        { k: 'distance_km', t: 'Distance', n: 1, v: (x) => num(x.r.distance_km), cell: (x) => h('td', { class: 'n', text: fmtNum(num(x.r.distance_km)) + ' km' }) },
        { k: 'transit_time_hrs', t: 'Transit', n: 1, v: (x) => (routeBase(x.id, lensResult()) || 0) + x.delay, cell: (x) => h('td', { class: 'n' }, fmtHrs(routeBase(x.id, lensResult()) || num(x.r.transit_time_hrs)), x.delay ? h('span', { class: 'cell-sub neg', text: '+' + fmtHrs(x.delay) + ' simulated jam' }) : null) },
        { k: 'transport_cost_per_kg', t: 'Transport/kg', n: 1, v: (x) => num(x.r.transport_cost_per_kg), cell: (x) => h('td', { class: 'n', text: fmtINR2(num(x.r.transport_cost_per_kg)) }) },
        { k: 'status', t: 'Status field', v: (x) => str(x.r.status), cell: (x) => h('td', null, h('span', { class: 'tag', text: str(x.r.status) || NA })) }
      ]
    };
  }
  function renderExplorer() {
    const tab = state.ex.tab;
    $$('#exTabs [role="tab"]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    $('#exPanel').setAttribute('aria-labelledby', 'tab-' + tab);
    const c = ctx(); const res = lensResult();
    const counts = { alloc: res ? res.payload.allocations.length : 0, batch: c.batches.length, dest: c.dests.length, route: c.routes.length };
    $$('.tab-count').forEach((sp) => { sp.textContent = counts[sp.dataset.count] || ''; });
    const spec = exColumns(tab);
    // filter controls
    const tierSel = $('#exTier'), stSel = $('#exStatus');
    const tierOpts = Array.from(new Set(spec.rows.map(spec.tierOf).filter(Boolean)));
    const stOpts = Array.from(new Set(spec.rows.map(spec.statusOf).filter(Boolean)));
    const fillSel = (sel, opts, cur, all, lab) => { clear(sel); sel.appendChild(h('option', { value: '', text: all })); opts.sort().forEach((o) => sel.appendChild(h('option', { value: o, selected: o === cur, text: lab(o) }))); if (cur && !opts.includes(cur)) sel.appendChild(h('option', { value: cur, selected: true, text: lab(cur) })); };
    fillSel(tierSel, tierOpts, state.ex.tier, 'All tiers', (o) => (tierInfo(o) ? tierInfo(o).short : o));
    fillSel(stSel, stOpts, state.ex.status, 'All statuses', (o) => o.charAt(0) + o.slice(1).toLowerCase());
    tierSel.parentElement.hidden = tab === 'route' || (!tierOpts.length && !state.ex.tier);
    stSel.parentElement.hidden = tab === 'dest' || (!stOpts.length && !state.ex.status);
    // filter + sort
    const q = state.ex.q.trim().toLowerCase();
    let list = spec.rows.filter((r) => (!q || spec.text(r).toLowerCase().includes(q)) && (!state.ex.tier || spec.tierOf(r) === state.ex.tier || (tab === 'route' && false)) && (!state.ex.status || spec.statusOf(r) === state.ex.status));
    const [sk, sd] = state.ex.sort[tab] || [];
    const col = spec.cols.find((x) => x.k === sk);
    if (col && col.v) list = list.slice().sort((a, b) => { const va = col.v(a), vb = col.v(b); if (va === vb) return 0; if (va === null || va === undefined || va === '') return 1; if (vb === null || vb === undefined || vb === '') return -1; return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * sd; });
    const table = $('#exTable'), thead = table.tHead, tbody = table.tBodies[0];
    clear(thead); clear(tbody);
    thead.appendChild(h('tr', null, spec.cols.map((cl) => {
      const th = h('th', { scope: 'col', class: [cl.n ? 'n' : '', cl.cls || ''].join(' ').trim() || null, title: cl.title || null });
      if (cl.nosort || !cl.t) th.appendChild(h('span', { class: 'sr-only', text: cl.t || 'Actions' }));
      else {
        if (cl.k === sk) th.setAttribute('aria-sort', sd > 0 ? 'ascending' : 'descending');
        th.appendChild(h('button', { type: 'button', class: 'th-sort', text: cl.t, onclick: () => { const cur = state.ex.sort[tab]; state.ex.sort[tab] = [cl.k, cur && cur[0] === cl.k ? -cur[1] : 1]; renderExplorer(); } }));
      }
      return th;
    })));
    list.forEach((r) => {
      const tr = h('tr', { tabindex: 0, class: spec.lost(r) ? 'is-lost' : null, 'aria-label': 'Open details' });
      spec.cols.forEach((cl) => tr.appendChild(cl.cell(r)));
      tr.addEventListener('click', () => spec.open(r));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); spec.open(r); } });
      tbody.appendChild(tr);
    });
    const empty = $('#exEmpty'); clear(empty);
    const filtered = q || state.ex.tier || state.ex.status;
    if (!spec.rows.length) {
      empty.hidden = false;
      if (tab === 'alloc' && state.data) empty.append(h('strong', { text: 'No allocations yet' }), h('span', { text: 'Run the cascade plan and every allocation appears here.' }), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Run cascade plan', onclick: () => runPlan() }));
      else empty.append(h('strong', { text: 'No data loaded' }), h('span', { text: 'Connect the API or open the demo to load records.' }));
    } else if (!list.length) {
      empty.hidden = false;
      empty.append(h('strong', { text: 'Nothing matches' }), h('span', { text: 'No records match the search and filters.' }), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Clear search and filters', onclick: clearExplorer }));
    } else empty.hidden = true;
    table.parentElement.hidden = !list.length;
    $('#exCount').textContent = spec.rows.length ? 'Showing ' + list.length + ' of ' + spec.rows.length + (filtered ? ' (filtered)' : '') + (tab === 'alloc' || tab === 'batch' || tab === 'dest' ? (res ? ', ' + lensName() : '') : '') + (res && (tab === 'alloc' || tab === 'batch') ? '. ' + sourceText(res) : '') : '';
  }
  function clearExplorer() { state.ex.q = ''; state.ex.tier = ''; state.ex.status = ''; $('#exSearch').value = ''; renderExplorer(); }
  function filterExplorer(f) {
    state.ex.tab = f.tab || 'alloc';
    state.ex.q = f.q || ''; state.ex.tier = f.tier || ''; state.ex.status = f.status || '';
    $('#exSearch').value = state.ex.q;
    renderExplorer();
    document.getElementById('explorer').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    toast('info', 'Explorer filtered', f.tier ? 'Showing ' + (tierInfo(f.tier) ? tierInfo(f.tier).short : f.tier) + ' allocations.' : f.status ? 'Showing allocations with status ' + f.status.toLowerCase() + '.' : 'Showing matches for "' + f.q + '".');
  }

  /* ------------------------------------------------------------------
     19. Drawer (details with related-record navigation)
     ------------------------------------------------------------------ */
  let drawerOpener = null;
  function kv(items) { return h('dl', { class: 'kv' }, items.filter(Boolean).map(([k, v, wide, sub]) => h('div', { class: wide ? 'wide' : null }, h('dt', { text: k }), h('dd', null, v, sub ? h('small', { text: sub }) : null)))); }
  function relatedBtns(items) { const f = items.filter(Boolean); return f.length ? h('div', null, h('p', { class: 'd-section-title', text: 'Related' }), h('div', { class: 'related', style: { marginTop: '8px' } }, f.map(([label, kind, id]) => h('button', { type: 'button', text: label, onclick: () => openDrawer(kind, id, true) })))) : null; }
  function openDrawer(kind, id, keepOpener) {
    const c = ctx(); const res = lensResult(); const rows = res ? buildRows(res) : [];
    const body = $('#drawerBody'); clear(body);
    let title = '', sub = '', k = '';
    if (kind === 'alloc') {
      const r = rows.find((x) => x.idx === id); if (!r) return;
      k = 'Allocation in ' + lensName(); title = (r.batch_id || NA) + ' to ' + (r.spoiled ? 'no buyer' : (r.dest_name || r.dest_id || NA)); sub = (r.commodity || '') + (r.batch ? ', ' + fmtKg(r.qty) + ' batch' : '');
      body.appendChild(h('div', { class: 'route-card' + (r.spoiled ? ' is-lost' : '') },
        h('div', { class: 'rc-node' }, h('span', { text: 'From' }), h('strong', { text: (c.routes[0] && str(c.routes[0].origin_hub)) || 'Hub' })),
        h('div', { class: 'rc-arrow', text: r.spoiled ? 'No route' : fmtKg(r.allocated_kg) }),
        h('div', { class: 'rc-node' }, h('span', { text: r.spoiled ? 'Outcome' : 'To' }), h('strong', { text: r.spoiled ? 'Unallocated' : (r.dest_name || r.dest_id || NA) }))));
      body.appendChild(h('div', { class: 'related' }, tierTag(r.tier, r.spoiled), statusEl(r.status), h('span', { class: 'tag', text: actionLabel(r.action) })));
      const why = h('div', null, h('p', { class: 'd-section-title', text: 'Why the engine chose this' }));
      why.appendChild(r.reasoning ? h('p', { class: 'reasoning' + (res.source === 'demo' ? ' is-demo' : res.source === 'api_fallback' ? ' is-fallback' : ''), text: r.reasoning }) : h('p', { class: 'd-note', text: 'The response has no reasoning text for this allocation.' }));
      why.appendChild(h('p', { class: 'd-foot', style: { marginTop: '6px' }, text: 'Quoted from the reasoning field. ' + sourceText(res) + '.' }));
      body.appendChild(why);
      if (r.shortfall > 0) body.appendChild(h('p', { class: 'd-note warn', text: fmtKg(r.shortfall) + ' of this ' + fmtKg(r.qty) + ' batch is not allocated anywhere. The engine sends each batch to one destination, and this one had demand left for ' + fmtKg(r.allocated_kg) + '.' }));
      if (r.unknownDest) body.appendChild(h('p', { class: 'd-note bad', text: 'Destination ' + r.dest_id + ' is not in GET /api/data. This usually means the backend returned its built-in mock response.' }));
      const acq = r.batch && isNum(num(r.batch.base_cost_per_kg)) && isNum(r.allocated_kg) ? r.allocated_kg * num(r.batch.base_cost_per_kg) : null;
      body.appendChild(kv([
        ['Allocated', fmtKg(r.allocated_kg)], ['Margin on arrival', fmtHrs(r.margin_hrs), false, 'margin_hrs'],
        ['Price', fmtINR2(r.effective_price_per_kg) + '/kg', false, isNum(r.discount_pct) && r.discount_pct > 0 ? fmtPct(r.discount_pct) + ' velocity discount' : 'No discount'],
        ['Transport', fmtINR2(r.transport_cost_per_kg) + '/kg'],
        ['Contribution after transport', fmtINR(r.net_profit), false, 'API field net_profit'],
        ['After acquisition cost (derived)', isNum(acq) && isNum(r.net_profit) ? fmtINR(r.net_profit - acq) : NA, false, isNum(acq) ? 'net_profit − allocated kg × base cost ' + fmtINR(acq) : 'Base cost unknown'],
        r.dest ? ['Buyer needs on arrival', fmtHrs(num(r.dest.min_shelf_life_hrs)), false, 'min_shelf_life_hrs'] : null,
        r.batch ? ['Batch shelf life', fmtHrs(num(r.batch.shelf_life_hrs)), false, 'Grade ' + (str(r.batch.quality_grade) || NA)] : null
      ]));
      body.appendChild(relatedBtns([r.batch ? ['Batch ' + r.batch_id, 'batch', r.batch_id] : null, r.dest ? [r.dest_name || r.dest_id, 'dest', r.dest_id] : null, r.dest && c.routeByDest.get(r.dest_id) ? ['Route ' + str(c.routeByDest.get(r.dest_id).route_id), 'route', str(c.routeByDest.get(r.dest_id).route_id)] : null]));
    } else if (kind === 'batch') {
      const b = c.batchById.get(id); if (!b) return;
      const r = rows.find((x) => x.batch_id === id);
      k = 'Batch'; title = id + ', ' + (str(b.commodity) || ''); sub = fmtKg(num(b.quantity_kg)) + ', grade ' + (str(b.quality_grade) || NA);
      body.appendChild(kv([['Quantity', fmtKg(num(b.quantity_kg))], ['Shelf life', fmtHrs(num(b.shelf_life_hrs))], ['Quality grade', str(b.quality_grade) || NA], ['Base cost', fmtINR2(num(b.base_cost_per_kg)) + '/kg'], ['Acquisition value (derived)', fmtINR((num(b.quantity_kg) || 0) * (num(b.base_cost_per_kg) || 0)), true, 'quantity_kg × base_cost_per_kg']]));
      const pr = state.plan ? buildRows(state.plan).find((x) => x.batch_id === id) : null;
      const jr = state.jam ? buildRows(state.jam).find((x) => x.batch_id === id) : null;
      const where = (x) => (!x ? NA : x.spoiled ? 'No feasible buyer' : (x.dest_name || x.dest_id) + ', ' + fmtKg(x.allocated_kg));
      body.appendChild(h('div', null, h('p', { class: 'd-section-title', text: 'Where it goes' }), kv([['Cascade plan', state.plan ? where(pr) : 'Run the plan', true], ['Re-plan under jam', state.jam ? where(jr) : 'Simulate a jam', true]])));
      if (r && r.reasoning) body.appendChild(h('div', null, h('p', { class: 'd-section-title', text: 'Engine reasoning, ' + lensName() }), h('p', { class: 'reasoning' + (res.source === 'demo' ? ' is-demo' : res.source === 'api_fallback' ? ' is-fallback' : ''), text: r.reasoning })));
      body.appendChild(relatedBtns([r ? ['This allocation', 'alloc', r.idx] : null, r && r.dest ? [r.dest_name || r.dest_id, 'dest', r.dest_id] : null]));
    } else if (kind === 'dest') {
      const d = c.destById.get(id); if (!d) return;
      const into = rows.filter((x) => !x.spoiled && x.dest_id === id);
      const route = c.routeByDest.get(id);
      k = (tierInfo(d.tier) || { short: 'Destination' }).short; title = str(d.name) || id; sub = id + ', ' + (str(d.tier) || '');
      const kg = sum(into, (x) => x.allocated_kg);
      body.appendChild(kv([['Demand', fmtKg(num(d.demand_kg))], ['Allocated', res ? fmtKg(kg) : 'Run the plan', false, res && num(d.demand_kg) ? fmtPct(kg / num(d.demand_kg) * 100) + ' filled' : null], ['Offer price', fmtINR2(num(d.offering_price_per_kg)) + '/kg'], ['Minimum shelf life on arrival', fmtHrs(num(d.min_shelf_life_hrs))], ['Distance', fmtNum(num(d.distance_km)) + ' km'], ['Transit', fmtHrs(num(d.transit_time_hrs))], ['Transport', fmtINR2(num(d.transport_cost_per_kg)) + '/kg'], ['Contribution in ' + (state.lens === 'replan' ? 're-plan' : 'plan'), res ? fmtINR(sum(into, (x) => x.net_profit)) : NA]]));
      if (res) body.appendChild(h('div', null, h('p', { class: 'd-section-title', text: into.length ? 'Batches sent here' : 'No batches sent here in ' + lensName() }), into.length ? h('div', { class: 'related', style: { marginTop: '8px' } }, into.map((x) => h('button', { type: 'button', text: x.batch_id + ', ' + fmtKg(x.allocated_kg), onclick: () => openDrawer('alloc', x.idx, true) }))) : null));
      if (d.tier === 'Tier 1 - Premium Retail') body.appendChild(h('p', { class: 'd-note', text: 'Premium retail only accepts grade A stock in this engine.' }));
      body.appendChild(relatedBtns([route ? ['Route ' + str(route.route_id), 'route', str(route.route_id)] : null]));
    } else if (kind === 'route') {
      const r = c.routeById.get(id); if (!r) return;
      const d = c.destById.get(str(r.dest_id));
      const delay = state.jam ? jamDelayFor(str(r.dest_id)) : 0;
      k = 'Route'; title = id + ' to ' + (d ? str(d.name) : str(r.dest_id)); sub = (str(r.origin_hub) || '') + ', ' + (str(r.vehicle_type) || '');
      body.appendChild(kv([['From', str(r.origin_hub) || NA, true], ['Vehicle', str(r.vehicle_type) || NA], ['Status field', str(r.status) || NA], ['Distance', fmtNum(num(r.distance_km)) + ' km'], ['Transit now', fmtHrs(num(r.transit_time_hrs)), false, 'From GET /api/data'], ['Transport', fmtINR2(num(r.transport_cost_per_kg)) + '/kg'], ['Last simulated jam', state.jam ? (delay ? '+' + fmtHrs(delay) : 'Not affected') : 'None yet']]));
      body.appendChild(h('p', { class: 'd-note', text: 'The route data lists a vehicle type but no numeric capacity, so the engine does not check loads against the vehicle.' }));
      body.appendChild(relatedBtns([d ? [str(d.name), 'dest', str(d.dest_id)] : null]));
    }
    $('#drawerKind').textContent = k; $('#drawerTitle').textContent = title; $('#drawerSub').textContent = sub;
    const drawer = $('#drawer'), bd = $('#drawerBackdrop');
    if (!keepOpener || drawer.hidden) drawerOpener = document.activeElement;
    if (drawer.hidden) {
      drawer.hidden = false; bd.hidden = false; document.body.classList.add('has-overlay');
      requestAnimationFrame(() => { drawer.classList.add('is-open'); bd.classList.add('is-open'); });
    }
    body.scrollTop = 0;
    setTimeout(() => $('#drawerClose').focus(), 40);
  }
  function closeDrawer() {
    const drawer = $('#drawer'), bd = $('#drawerBackdrop');
    if (drawer.hidden) return;
    drawer.classList.remove('is-open'); bd.classList.remove('is-open'); document.body.classList.remove('has-overlay');
    setTimeout(() => { drawer.hidden = true; bd.hidden = true; }, reduceMotion.matches ? 0 : 400);
    if (drawerOpener && document.contains(drawerOpener)) drawerOpener.focus();
  }
  function trapFocus(container, e) {
    const f = $$('button, [href], input, select, [tabindex]:not([tabindex="-1"])', container).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ------------------------------------------------------------------
     20. Expanded chart modal
     ------------------------------------------------------------------ */
  let modalOpener = null, modalChart = null;
  function openModal(key) {
    const ch = CHARTS[key]; if (!ch) return;
    modalOpener = document.activeElement; modalChart = key;
    $('#modalTitle').textContent = ch.title + ', ' + lensName();
    const body = $('#modalBody'); clear(body);
    const host = h('div', { class: 'viz-body' });
    body.appendChild(host);
    const src = $(ch.table);
    const tableCopy = src.firstChild ? src.firstChild.cloneNode(true) : null;
    $('#modal').hidden = false; document.body.classList.add('has-overlay');
    ch.render(host, true);
    if (tableCopy) body.appendChild(h('div', { class: 'viz-table' }, tableCopy));
    setTimeout(() => $('#modalClose').focus(), 30);
  }
  function closeModal() {
    if ($('#modal').hidden) return;
    $('#modal').hidden = true; modalChart = null; document.body.classList.remove('has-overlay'); tip.hide();
    if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  }

  /* ------------------------------------------------------------------
     21. Impact ledger
     ------------------------------------------------------------------ */
  function renderLedger() {
    const el = $('#ledgerBody'); clear(el);
    const sc = scenarios(); const c = ctx();
    if (!sc.conv || !sc.plan) {
      el.appendChild(h('div', { class: 'ledger-empty' }, h('strong', { text: 'The ledger fills in after the first plan' }), h('span', { text: 'Every figure here is computed from one API response, with its formula written underneath.' }),
        h('button', { type: 'button', class: 'btn btn-secondary', text: state.mode === 'offline' && demoAvailable() ? 'Run it on demo data' : 'Run cascade plan', onclick: () => (state.mode === 'offline' && demoAvailable() ? enterDemo().then(runPlan) : runPlan()) })));
      return;
    }
    const P = sc.plan, C = sc.conv, J = sc.replan, CJ = sc.convJam;
    const src = (r) => (r.src ? sourceText(r.src) : '');
    const rowsP = P.rows || [];
    const rowsJ = J ? (J.rows || []) : [];
    const acqTotal = c.batches.length ? sum(c.batches, (b) => (num(b.quantity_kg) || 0) * (num(b.base_cost_per_kg) || 0)) : null;
    const demandTotal = c.dests.length ? sum(c.dests, (d) => d.demand_kg) : null;
    const allocP = rowsP.length ? sum(rowsP.filter((r) => !r.spoiled), (r) => r.allocated_kg) : null;
    const t3 = (rows) => sum(rows.filter((r) => r.tierKey === 't3'), (r) => r.allocated_kg);
    const placed = (rows) => rows.filter((r) => !r.spoiled).length;
    const jamLabel = J ? '+' + jamInfo().delay + ' h on ' + corridorLabel(jamInfo().aff) : '';
    const diff = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
    const items = [
      {
        label: 'Spoilage avoided', value: diff(C.spoilKg, P.spoilKg), fmt: (v) => fmtNum(v), unit: 'kg',
        compare: 'Conventional dispatch ' + fmtKg(C.spoilKg) + ' → cascade plan ' + fmtKg(P.spoilKg) + (isNum(readMetrics(state.plan ? state.plan.payload.metrics : null).redPct) ? ' (' + fmtPct(readMetrics(state.plan.payload.metrics).redPct) + ' less, per spoilage_reduction_pct)' : ''),
        formula: ['baseline_spoilage_kg − optimized_spoilage_kg'],
        jam: J ? 'With ' + jamLabel + ': ' + fmtKg(CJ.spoilKg) + ' → ' + fmtKg(J.spoilKg) + ' (' + signed(diff(CJ.spoilKg, J.spoilKg), fmtKg).replace(/^\+/, '') + ' avoided)' : null
      },
      {
        label: 'Extra revenue after transport', value: diff(P.rev, C.rev), fmt: (v) => fmtINR(v), unit: '',
        compare: fmtINR(C.rev) + ' → ' + fmtINR(P.rev) + (isNum(C.rev) && C.rev ? ' (' + signed((P.rev - C.rev) / C.rev * 100, (x) => nf1.format(x) + '%') + ')' : ''),
        formula: ['optimized_net_revenue − baseline_net_revenue', 'Both are revenue minus transport cost. Acquisition cost is not included, so this is not profit.'],
        jam: J ? 'With ' + jamLabel + ': ' + fmtINR(CJ.rev) + ' → ' + fmtINR(J.rev) : null
      },
      {
        label: 'Recovered through processing', value: rowsP.length ? t3(rowsP) : null, fmt: (v) => fmtNum(v), unit: 'kg',
        compare: 'Stock sent to Tier 3 processing, a channel the conventional baseline never uses',
        formula: ['Σ allocated_kg where tier = "Tier 3 - Processing Plant"'],
        jam: J ? 'With ' + jamLabel + ': ' + fmtKg(t3(rowsJ)) : null
      },
      {
        label: 'Demand fulfilled', value: P.fulfil, fmt: (v) => nf1.format(v), unit: '%',
        compare: isNum(allocP) && isNum(demandTotal) ? fmtKg(allocP) + ' allocated against ' + fmtKg(demandTotal) + ' of total demand' : 'Allocated share of total destination demand',
        formula: ['demand_fulfillment_pct = Σ allocated_kg ÷ Σ demand_kg'],
        jam: J ? 'With ' + jamLabel + ': ' + fmtPct(J.fulfil) : null
      },
      {
        label: 'Batches with a buyer', value: rowsP.length ? placed(rowsP) : null, fmt: (v) => fmtNum(v), unit: 'of ' + (c.batches.length || rowsP.length),
        compare: (() => { const left = rowsP.filter((r) => r.shortfall > 0); return left.length ? left.map((r) => fmtKg(r.shortfall) + ' of ' + r.batch_id).join(', ') + ' left over, because each batch goes to one buyer' : 'Every placed batch is sent in full'; })(),
        formula: ['Count of allocations whose status is not SPOILED'],
        jam: J ? 'With ' + jamLabel + ': ' + placed(rowsJ) + ' of ' + (c.batches.length || rowsJ.length) : null
      },
      {
        label: 'After acquisition cost (derived)', value: isNum(acqTotal) && isNum(P.rev) ? P.rev - acqTotal : null, fmt: (v) => fmtINR(v), unit: '',
        compare: isNum(acqTotal) && isNum(C.rev) ? 'Conventional ' + fmtINR(C.rev - acqTotal) + ' → cascade ' + fmtINR(P.rev - acqTotal) : 'Needs base costs from /api/data',
        formula: ['net revenue after transport − Σ quantity_kg × base_cost_per_kg', 'Computed on this page, not returned by the API. Both plans buy the same stock (' + fmtINR(acqTotal) + '). Other overheads are not modelled.'],
        jam: J && isNum(acqTotal) ? 'With ' + jamLabel + ': ' + fmtINR(J.rev - acqTotal) : null
      }
    ];
    items.forEach((it, i) => {
      const v = h('span');
      const valEl = h('p', { class: 'ledger-value' + (isNum(it.value) ? '' : ' is-na') }, v, it.unit && isNum(it.value) ? h('span', { class: 'unit', text: it.unit }) : null);
      if (isNum(it.value)) countTo(v, it.value, it.fmt, 'ledger-' + i); else v.textContent = NA;
      el.appendChild(h('div', { class: 'ledger-item' },
        h('p', { class: 'ledger-label', text: it.label }), valEl,
        h('p', { class: 'ledger-compare', text: it.compare }),
        h('p', { class: 'ledger-formula' }, it.formula.map((f, j) => (j === 0 ? h('code', { text: f }) : h('span', { text: ' ' + f })))),
        it.jam ? h('p', { class: 'ledger-jam', text: it.jam }) : null));
    });
    el.appendChild(h('p', { class: 'source-note', style: { gridColumn: '1 / -1', paddingTop: '14px' }, text: 'Plan: ' + src(P) + '.' + (J ? ' Jam: ' + src(J) + '.' : '') + ' Sample data from the repository, not field measurements.' }));
  }

  /* ------------------------------------------------------------------
     22. Count-up numbers (animate once when seen; from the last value after that)
     ------------------------------------------------------------------ */
  const lastVals = new Map();
  let revealIO = null;
  function countTo(el, to, fmt, key) {
    const from = key ? lastVals.get(key) : undefined;
    if (key) lastVals.set(key, to);
    if (!isNum(to) || reduceMotion.matches || from === to) { el.textContent = fmt(to); return; }
    const run = (start) => tween(start === 0 ? 1100 : 700, (t) => { el.textContent = fmt(lerp(start, to, t)); });
    if (isNum(from)) { el.textContent = fmt(from); run(from); return; }
    el.textContent = fmt(0);
    if (!revealIO) {
      revealIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { revealIO.unobserve(e.target); e.target._run && e.target._run(); } }), { threshold: 0.4 });
    }
    el._run = () => run(0);
    revealIO.observe(el);
  }

  /* ------------------------------------------------------------------
     23. The knitted penguin
     ------------------------------------------------------------------ */
  const penguin = {
    timer: null, hidden: false, said: new Set(), heroVisible: true,
    mount() {
      const tpl = $('#penguinTpl');
      [$('#heroPenguin'), $('#buddyPenguin')].forEach((host) => { if (host && tpl) host.appendChild(tpl.content.cloneNode(true)); });
      try { this.hidden = localStorage.getItem('cs-penguin-hidden') === '1'; } catch (e) { this.hidden = false; }
      this.apply();
    },
    hosts() { return [$('#heroPenguin'), $('#buddyPenguin')].filter(Boolean); },
    react(kind) {
      const dur = { cheer: 1700, shiver: 1400, worried: 2800, wave: 2100, think: 1600 }[kind] || 1500;
      this.hosts().forEach((el) => {
        ['is-cheer', 'is-shiver', 'is-worried', 'is-wave', 'is-think'].forEach((c) => el.classList.remove(c));
        void el.offsetWidth; el.classList.add('is-' + kind);
        clearTimeout(el._rt); el._rt = setTimeout(() => el.classList.remove('is-' + kind), dur);
      });
    },
    say(text, ms = 3800) {
      if (this.hidden) return;
      const b = $('#buddyBubble');
      b.textContent = text; b.hidden = false; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
      $('#buddy').classList.add('is-speaking');
      clearTimeout(this.timer); this.timer = setTimeout(() => { b.hidden = true; $('#buddy').classList.remove('is-speaking'); }, ms);
    },
    once(key, text) { if (this.said.has(key)) return; this.said.add(key); this.say(text); },
    apply() {
      $('#buddy').classList.toggle('is-hidden', this.hidden || this.heroVisible);
      const t = $('#buddyToggle');
      t.setAttribute('aria-pressed', this.hidden ? 'false' : 'true');
      t.textContent = this.hidden ? 'Show penguin' : '×';
      t.title = this.hidden ? 'Show the penguin' : 'Hide the penguin';
      t.setAttribute('aria-label', t.title);
      t.hidden = this.heroVisible && !this.hidden;
      if (this.hidden) $('#buddyBubble').hidden = true;
    },
    toggle() { this.hidden = !this.hidden; try { localStorage.setItem('cs-penguin-hidden', this.hidden ? '1' : '0'); } catch (e) { /* storage unavailable */ } this.apply(); if (!this.hidden) this.say('Back again. I will keep quiet unless something changes.'); }
  };

  /* ------------------------------------------------------------------
     24. Ambient effects: snow, scroll progress, section tracking
     ------------------------------------------------------------------ */
  const snow = { running: false, raf: 0 };
  function initSnow() {
    const cv = $('#snow'); if (!cv || !cv.getContext) return;
    const g = cv.getContext('2d');
    let flakes = [], w = 0, hgt = 0;
    function size() {
      const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; hgt = r.height; cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(clamp(w / 16, 30, 90));
      flakes = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * hgt, r: 0.6 + Math.random() * 1.9, s: 0.25 + Math.random() * 0.7, d: Math.random() * 6.28 }));
    }
    function frame(t) {
      g.clearRect(0, 0, w, hgt); g.fillStyle = '#ffffff';
      flakes.forEach((f) => {
        f.y += f.s; f.x += Math.sin(t / 1700 + f.d) * 0.3;
        if (f.y > hgt + 4) { f.y = -4; f.x = Math.random() * w; }
        g.globalAlpha = 0.25 + f.r / 2.5 * 0.5; g.beginPath(); g.arc(f.x, f.y, f.r, 0, 6.283); g.fill();
      });
      snow.raf = requestAnimationFrame(frame);
    }
    snow.start = () => { if (snow.running || reduceMotion.matches || document.hidden) return; snow.running = true; size(); snow.raf = requestAnimationFrame(frame); };
    snow.stop = () => { snow.running = false; cancelAnimationFrame(snow.raf); };
    snow.resize = debounce(() => { if (snow.running) size(); }, 200);
    window.addEventListener('resize', snow.resize);
  }
  function initScrollUI() {
    const bar = $('#scrollProgress'), top = $('#topbar'), bud = $('#buddyPenguin');
    let last = window.scrollY, tiltT = 0;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? clamp(window.scrollY / max, 0, 1) : 0) + ')';
      top.classList.toggle('is-scrolled', window.scrollY > 8);
      if (!reduceMotion.matches) {
        const dv = window.scrollY - last; last = window.scrollY;
        bud.style.transform = 'rotate(' + clamp(dv * 0.5, -9, 9) + 'deg)';
        clearTimeout(tiltT); tiltT = setTimeout(() => { bud.style.transform = ''; }, 160);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (!('IntersectionObserver' in window)) return;
    const navLinks = $$('.nav a');
    const secIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const id = e.target.id;
        navLinks.forEach((a) => { const on = a.dataset.nav === id; a.classList.toggle('is-current', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
        if (id === 'lab' && !penguin.said.has('lab')) { penguin.said.add('lab'); penguin.react('wave'); }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['story', 'coldchain', 'lab', 'studio', 'network', 'explorer', 'ledger'].forEach((id) => { const el = document.getElementById(id); if (el) secIO.observe(el); });
    const heroIO = new IntersectionObserver((entries) => entries.forEach((e) => {
      penguin.heroVisible = e.isIntersecting; penguin.apply();
      if (e.isIntersecting) { snow.start && snow.start(); } else { snow.stop && snow.stop(); }
    }), { threshold: 0.15 });
    heroIO.observe($('#hero'));
    const stepIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) setStoryStep(Number(e.target.dataset.step)); }), { rootMargin: '-42% 0px -42% 0px' });
    $$('.chapter').forEach((ch) => stepIO.observe(ch));
    const thermoIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { const host = $('#thermoChart'); if (host._draw) { host._draw(); host._draw = null; } } }), { threshold: 0.35 });
    thermoIO.observe($('#thermoChart'));
    const netIO = new IntersectionObserver((entries) => entries.forEach((e) => { net.visible = e.isIntersecting; }), { threshold: 0.05 });
    netIO.observe($('#network'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) snow.stop && snow.stop(); else if (penguin.heroVisible) snow.start && snow.start(); });
  }

  /* ------------------------------------------------------------------
     25. Wiring
     ------------------------------------------------------------------ */
  function renderLenses() {
    if (!state.jam && state.lens === 'replan') state.lens = 'plan';
    $$('[data-lens-group] input').forEach((i) => {
      if (i.value === 'replan') { i.disabled = !state.jam; i.closest('label').title = state.jam ? '+' + jamInfo().delay + ' h on ' + corridorLabel(jamInfo().aff) : 'Simulate a jam in the Rescue Lab first'; }
      i.checked = i.value === state.lens;
    });
  }
  function setLens(v) {
    if (v === 'replan' && !state.jam) return;
    state.lens = v; renderLenses(); renderStudio(); renderNetwork(); renderExplorer();
  }
  function renderAll() {
    renderLenses(); renderBanner(); renderHeroFacts(); renderStory(); buildPhases();
    renderLab(); renderStudio(); renderNetwork(); renderExplorer(); renderLedger();
    document.body.classList.remove('is-booting');
  }
  function bindEvents() {
    $('#heroRunBtn').addEventListener('click', async () => {
      $('#lab').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      $('#lab').focus({ preventScroll: true });
      if (state.mode === 'offline' && demoAvailable()) { await enterDemo(); }
      runPlan();
    });
    $('#runPlanBtn').addEventListener('click', runPlan);
    $('#runJamBtn').addEventListener('click', runJam);
    const scSel = $('#scenarioSelect');
    if (scSel) scSel.addEventListener('change', () => runPlan());
    const rainChip = $('#rainScenarioChip');
    if (rainChip) rainChip.addEventListener('click', () => {
      if (scSel) scSel.value = 'rain_delay';
      toast('info', 'Monsoon Rain Delay Scenario Activated', 'Western Ghats / NH48 corridors flooded (+14h delay) with 30% humidity decay.');
      runPlan();
    });
    $('#resetBtn').addEventListener('click', resetLab);
    $('#reconnectBtn').addEventListener('click', () => connect());
    $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const [dest, delay] = b.dataset.preset.split('|');
      const c = ctx();
      if (dest !== 'ALL' && c.dests.length && !c.destById.has(dest)) { toast('warn', 'Corridor not in the data', dest + ' is not in GET /api/data.'); return; }
      state.jamSel = { dest, delay: Number(delay) }; renderConsole(); runJam();
    }));
    $('#pickA').addEventListener('change', (e) => { state.pickA = e.target.value; state.pair = Object.keys(PAIRS).find((k) => PAIRS[k].a === state.pickA && PAIRS[k].b === state.pickB) || null; renderLab(); });
    $('#pickB').addEventListener('change', (e) => { state.pickB = e.target.value; state.pair = Object.keys(PAIRS).find((k) => PAIRS[k].a === state.pickA && PAIRS[k].b === state.pickB) || null; renderLab(); });
    $$('input[name="cmpView"]').forEach((i) => i.addEventListener('change', () => { state.cmpView = i.value; renderCompare(); }));
    $$('[data-lens-group] input').forEach((i) => i.addEventListener('change', () => setLens(i.value)));
    $$('input[name="tierMeasure"]').forEach((i) => i.addEventListener('change', () => { state.tierMeasure = i.value; renderStudio(); }));
    $$('input[name="routeMeasure"]').forEach((i) => i.addEventListener('change', () => { state.routeMeasure = i.value; renderRoutes($('#vizRoutes')); }));
    $('#destSort').addEventListener('change', (e) => { state.destSort = e.target.value; renderDestBars($('#vizDests')); });
    $('#studioReset').addEventListener('click', () => resetStudioSettings(false));
    $$('.table-toggle').forEach((b) => b.addEventListener('click', () => {
      const t = $('#table' + b.dataset.table.charAt(0).toUpperCase() + b.dataset.table.slice(1));
      const open = t.hidden; t.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.textContent = open ? 'Hide data table' : 'Show data table';
    }));
    $$('[data-expand]').forEach((b) => b.addEventListener('click', () => openModal(b.dataset.expand)));
    // explorer
    const tabs = $$('#exTabs [role="tab"]');
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => { if (state.ex.tab !== b.dataset.tab) { state.ex.tab = b.dataset.tab; state.ex.tier = ''; state.ex.status = ''; } renderExplorer(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault(); const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); n.click();
      });
    });
    $('#exSearch').addEventListener('input', debounce((e) => { state.ex.q = e.target.value; renderExplorer(); }, 120));
    $('#exTier').addEventListener('change', (e) => { state.ex.tier = e.target.value; renderExplorer(); });
    $('#exStatus').addEventListener('change', (e) => { state.ex.status = e.target.value; renderExplorer(); });
    $('#exClear').addEventListener('click', clearExplorer);
    // overlays
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else closeDrawer(); tip.hide(); }
      if (e.key === 'Tab') { if (!$('#drawer').hidden) trapFocus($('#drawer'), e); else if (!$('#modal').hidden) trapFocus($('#modal'), e); }
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && $('#drawer').hidden && $('#modal').hidden) { e.preventDefault(); $('#exSearch').focus(); }
    });
    $('#thermoScrub').addEventListener('input', (e) => { const host = $('#thermoChart'); host._place && host._place(Number(e.target.value)); });
    $('#buddyToggle').addEventListener('click', () => penguin.toggle());
    $('#buddyPenguin').addEventListener('click', () => { penguin.react('wave'); const sc = scenarios(); penguin.say(sc.plan && sc.conv && isNum(sc.conv.spoilKg) && isNum(sc.plan.spoilKg) ? 'Last plan: ' + fmtKg(sc.plan.spoilKg) + ' spoiled versus ' + fmtKg(sc.conv.spoilKg) + ' conventionally.' : 'Hi! Run the plan in the Rescue Lab and I will keep score.'); });
    $('#heroRunBtn').addEventListener('pointerenter', () => $('#heroPenguin').classList.add('is-look-l'));
    $('#heroRunBtn').addEventListener('pointerleave', () => $('#heroPenguin').classList.remove('is-look-l'));
    window.addEventListener('scroll', () => tip.hide(), { passive: true });
    // re-render size-dependent charts
    let lastW = window.innerWidth;
    window.addEventListener('resize', debounce(() => {
      if (Math.abs(window.innerWidth - lastW) < 2) return; lastW = window.innerWidth;
      renderThermo(); renderStudio(); renderNetwork();
      if (modalChart) { const host = $('#modalBody .viz-body'); if (host) CHARTS[modalChart].render(host, true); }
    }, 180));
  }
  function heroEntrance() {
    const hp = $('#heroPenguin');
    if (reduceMotion.matches) { hp.classList.add('is-here'); return; }
    hp.classList.add('is-entering');
    hp.addEventListener('animationend', function done(e) {
      if (e.animationName !== 'penguinEnter') return;
      hp.removeEventListener('animationend', done);
      hp.classList.remove('is-entering'); hp.classList.add('is-here');
      penguin.react('wave');
    });
  }
  function boot() {
    penguin.mount();
    bindEvents();
    initSnow();
    initScrollUI();
    renderThermo();
    renderAll();
    heroEntrance();
    if (CONFIG.FORCE_DEMO) {
      if (demoAvailable()) enterDemo().then(() => { if (CONFIG.AUTORUN) runPlan(); });
      else connect();
    } else {
      connect({ quiet: true }).then((ok) => { if (ok && CONFIG.AUTORUN) runPlan(); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
