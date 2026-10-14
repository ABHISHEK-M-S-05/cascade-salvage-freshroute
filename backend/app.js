/* =====================================================================
   CASCADE SALVAGE — app.js (frontend)

   The backend (backend/main.py + engine/optimizer.py) is the single source
   of truth for allocations, feasibility, economics, metrics and reasoning.
   This file displays, formats, filters and explains what the API returns.
   It never re-runs or re-derives the optimizer's business logic.

   Sections
     1. CONFIG ............ every endpoint, method and payload lives here
     2. Contract constants  exact tier strings, statuses, metric names
     3. Local demo bundle . illustrative snapshot, always labelled DEMO
     4. Formatting helpers
     5. State
     6. API layer
     7. Validation & normalisation (read-only views of the response)
     8. Connection, context & run flows
     9. Rendering — one path: renderAll()
    10. Charts
    11. Drawer
    12. Toasts
    13. Boot & events
   ===================================================================== */
(function () {
  'use strict';

  /* ===================================================================
     1. CONFIG — matches backend/main.py exactly
     -------------------------------------------------------------------
     GET  /api/health            → { status, service, optimizer_available, data_loaded }
     GET  /api/data              → { batches, destinations, routes }
     GET  /api/stats             → { batches:{count,total_kg,shelf_life_hrs:{min,max,avg}},
                                     destinations:{count,total_demand_kg,by_tier}, routes:{count} }
     POST /api/optimize          body OptimizeRequest   { delay_hrs?: float = 0 }
     POST /api/simulate-disruption body DisruptionRequest
                                 { delay_hrs: float (required), disruption_type: str = "HIGHWAY_JAM",
                                   affected_dest_id?: str | null  (null → all routes) }
     Errors: FastAPI HTTPException → { detail: "..." } (HTTP 500),
             validation errors     → { detail: [ { msg, loc, ... } ] } (HTTP 422).

     Runtime overrides (no code change needed):
       ?api=http://127.0.0.1:8000   different backend base URL
       ?mock=1                      local demo only, never call the API
       ?jam=all | ?jam=D3           disruption scope (all routes, or one dest_id)
     =================================================================== */
  var CONFIG = Object.freeze({
    API_BASE_URL: 'http://localhost:8000',
    ENDPOINTS: Object.freeze({
      health: Object.freeze({ method: 'GET', path: '/api/health' }),
      data: Object.freeze({ method: 'GET', path: '/api/data' }),
      stats: Object.freeze({ method: 'GET', path: '/api/stats' }),
      optimize: Object.freeze({ method: 'POST', path: '/api/optimize', body: Object.freeze({ delay_hrs: 0 }) }),
      disruption: Object.freeze({
        method: 'POST',
        path: '/api/simulate-disruption',
        body: Object.freeze({ delay_hrs: 6, disruption_type: 'HIGHWAY_JAM', affected_dest_id: 'D1' })
      })
    }),
    // Corridor naming: the dataset does not name highways, so the label says "D1 corridor".
    // Confirm with the team before renaming it (e.g. to NH48).
    DISRUPTION_LABEL: '🚨 Simulate 6h Highway Jam — D1 corridor',
    TIMEOUTS: Object.freeze({ health: 4000, context: 8000, run: 20000, reconnect: 2500 }),
    SLOW_NOTICE_MS: 2500,
    UI_LOW_MARGIN_HRS: 6,       // display highlight only — not a backend rule
    UI_SHORT_SHELF_HRS: 24,     // display highlight only — not a backend rule
    DEMO_LATENCY_MS: 350        // brief local delay so loading states are visible in demo mode
  });

  var PARAMS = new URLSearchParams(window.location.search);
  var RUNTIME = buildRuntime();

  function buildRuntime() {
    var base = CONFIG.API_BASE_URL;
    var apiParam = PARAMS.get('api');
    if (apiParam) {
      try {
        var u = new URL(apiParam);
        if (u.protocol === 'http:' || u.protocol === 'https:') base = (u.origin + u.pathname).replace(/\/+$/, '');
      } catch (e) { /* ignore invalid override */ }
    }
    var body = Object.assign({}, CONFIG.ENDPOINTS.disruption.body);
    var label = CONFIG.DISRUPTION_LABEL;
    var jam = PARAMS.get('jam');
    if (jam) {
      if (jam.toLowerCase() === 'all') { body.affected_dest_id = null; label = '🚨 Simulate 6h Highway Jam — all routes'; }
      else if (/^D\d+$/i.test(jam)) { body.affected_dest_id = jam.toUpperCase(); label = '🚨 Simulate 6h Highway Jam — ' + jam.toUpperCase() + ' corridor'; }
    }
    return { baseUrl: base, forceMock: PARAMS.get('mock') === '1', disruptionBody: body, disruptionLabel: label };
  }

  function requestBodyFor(key) {
    if (key === 'disruption') return RUNTIME.disruptionBody;
    var ep = CONFIG.ENDPOINTS[key];
    return ep.body ? Object.assign({}, ep.body) : null;
  }

  /* ===================================================================
     2. Contract constants (never mutate — display labels only)
     =================================================================== */
  var TIER = Object.freeze({
    PREMIUM: 'Tier 1 - Premium Retail',
    MANDI: 'Tier 2 - Rapid Mandi',
    PROCESSING: 'Tier 3 - Processing Plant'
  });
  var TIER_ORDER = [TIER.PREMIUM, TIER.MANDI, TIER.PROCESSING];
  var TIER_META = {};
  TIER_META[TIER.PREMIUM] = { short: 'Premium Retail', rank: 1, tone: 'tone-t1' };
  TIER_META[TIER.MANDI] = { short: 'Rapid Mandi', rank: 2, tone: 'tone-t2' };
  TIER_META[TIER.PROCESSING] = { short: 'Processing Plant', rank: 3, tone: 'tone-t3' };

  var METRIC_KEYS = [
    'baseline_spoilage_kg', 'baseline_spoilage_pct', 'baseline_net_revenue',
    'optimized_spoilage_kg', 'optimized_spoilage_pct', 'optimized_net_revenue',
    'spoilage_reduction_pct', 'revenue_gain_pct', 'demand_fulfillment_pct'
  ];

  // Values produced by engine/optimizer.py (and PREMIUM_SALE from main.py's fallback mock).
  var STATUS_TONE = { OPTIMAL: 'tone-ok', SAVED: 'tone-ok', DISCOUNTED: 'tone-warn', SPOILED: 'tone-danger' };
  var ACTION_LABEL = {
    PREMIUM_DISPATCH: 'Premium dispatch',
    DYNAMIC_DISCOUNT_DISPATCH: 'Discount dispatch',
    SALVAGE_RECOVERY: 'Salvage recovery',
    SPOILED_DISPOSAL: 'Spoiled — disposal',
    PREMIUM_SALE: 'Premium sale'
  };

  var SOURCE_LABEL = {
    optimizer: 'Optimizer result',
    api_fallback: 'API fallback (backend mock)',
    api_unverified: 'API result · optimizer status unknown',
    mock: 'DEMO · local snapshot'
  };

  /* ===================================================================
     3. LOCAL DEMO BUNDLE — ILLUSTRATIVE, NOT A LIVE API RESPONSE
     -------------------------------------------------------------------
     A frozen snapshot generated offline by running engine/optimizer.py's
     run_cascade_optimization() on the repository's data/*.json files
     (base plan, +6 h on D1, +6 h on all routes), plus copies of those data
     files and the /api/stats summary. It lets the dashboard work with no
     backend. Every view built from it is labelled DEMO and is never shown
     as live output.
     =================================================================== */
  var DEMO = Object.freeze({
    snapshots: {
      optimize: {
        allocations: [
          {"batch_id": "B001", "commodity": "Tomato (Hybrid)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 2500.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 42000.0, "margin_hrs": 16.5, "status": "SAVED", "reasoning": "Shelf life (18h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹37,500 total spoilage."},
          {"batch_id": "B002", "commodity": "Tomato (Hybrid)", "dest_id": "D1", "dest_name": "Mumbai Nature's Basket", "tier": "Tier 1 - Premium Retail", "allocated_kg": 3000.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 42.0, "transport_cost_per_kg": 3.5, "net_profit": 115500.0, "margin_hrs": 55.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 62h shelf life comfortably exceeds 48h retail requirement. Dispatched to Mumbai Nature's Basket capturing top ₹42.0/kg realization."},
          {"batch_id": "B003", "commodity": "Capsicum (Green)", "dest_id": "D2", "dest_name": "Pune Reliance Fresh Hub", "tier": "Tier 1 - Premium Retail", "allocated_kg": 1800.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 40.0, "transport_cost_per_kg": 3.2, "net_profit": 66240.0, "margin_hrs": 48.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 54h shelf life comfortably exceeds 42h retail requirement. Dispatched to Pune Reliance Fresh Hub capturing top ₹40.0/kg realization."},
          {"batch_id": "B004", "commodity": "Robusta Banana", "dest_id": "D5", "dest_name": "Zepto/Blinkit Dark Store Hub", "tier": "Tier 2 - Rapid Mandi", "allocated_kg": 2200.0, "action": "DYNAMIC_DISCOUNT_DISPATCH", "discount_pct": 10.0, "effective_price_per_kg": 27.0, "transport_cost_per_kg": 2.5, "net_profit": 53900.0, "margin_hrs": 31.5, "status": "DISCOUNTED", "reasoning": "Remaining shelf-life buffer (31.5h) is tight for long retail storage. Allocated to Zepto/Blinkit Dark Store Hub with 10% velocity discount (₹27.0/kg) to accelerate clearance and protect ₹53,900 net profit."},
          {"batch_id": "B005", "commodity": "Onion (Nashik Red)", "dest_id": "D2", "dest_name": "Pune Reliance Fresh Hub", "tier": "Tier 1 - Premium Retail", "allocated_kg": 1000.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 40.0, "transport_cost_per_kg": 3.2, "net_profit": 36800.0, "margin_hrs": 66.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 72h shelf life comfortably exceeds 42h retail requirement. Dispatched to Pune Reliance Fresh Hub capturing top ₹40.0/kg realization."},
          {"batch_id": "B006", "commodity": "Spinach (Leafy Greens)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 1200.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 20160.0, "margin_hrs": 15.5, "status": "SAVED", "reasoning": "Shelf life (17h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹12,000 total spoilage."},
          {"batch_id": "B007", "commodity": "Tomato (Local)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 800.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 13440.0, "margin_hrs": 12.5, "status": "SAVED", "reasoning": "Shelf life (14h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹8,800 total spoilage."}
        ],
        metrics: {"baseline_spoilage_kg": 4500.0, "baseline_spoilage_pct": 34.6, "baseline_net_revenue": 248090.0, "optimized_spoilage_kg": 500.0, "optimized_spoilage_pct": 3.8, "optimized_net_revenue": 348040.0, "spoilage_reduction_pct": 88.9, "revenue_gain_pct": 40.3, "demand_fulfillment_pct": 74.4}
      },
      disruption: {
        D1: {
          allocations: [
            {"batch_id": "B001", "commodity": "Tomato (Hybrid)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 2500.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 42000.0, "margin_hrs": 16.5, "status": "SAVED", "reasoning": "Shelf life (18h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹37,500 total spoilage."},
            {"batch_id": "B002", "commodity": "Tomato (Hybrid)", "dest_id": "D1", "dest_name": "Mumbai Nature's Basket", "tier": "Tier 1 - Premium Retail", "allocated_kg": 3000.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 42.0, "transport_cost_per_kg": 3.5, "net_profit": 115500.0, "margin_hrs": 49.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 62h shelf life comfortably exceeds 48h retail requirement. Dispatched to Mumbai Nature's Basket capturing top ₹42.0/kg realization."},
            {"batch_id": "B003", "commodity": "Capsicum (Green)", "dest_id": "D2", "dest_name": "Pune Reliance Fresh Hub", "tier": "Tier 1 - Premium Retail", "allocated_kg": 1800.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 40.0, "transport_cost_per_kg": 3.2, "net_profit": 66240.0, "margin_hrs": 48.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 54h shelf life comfortably exceeds 42h retail requirement. Dispatched to Pune Reliance Fresh Hub capturing top ₹40.0/kg realization."},
            {"batch_id": "B004", "commodity": "Robusta Banana", "dest_id": "D5", "dest_name": "Zepto/Blinkit Dark Store Hub", "tier": "Tier 2 - Rapid Mandi", "allocated_kg": 2200.0, "action": "DYNAMIC_DISCOUNT_DISPATCH", "discount_pct": 10.0, "effective_price_per_kg": 27.0, "transport_cost_per_kg": 2.5, "net_profit": 53900.0, "margin_hrs": 31.5, "status": "DISCOUNTED", "reasoning": "Remaining shelf-life buffer (31.5h) is tight for long retail storage. Allocated to Zepto/Blinkit Dark Store Hub with 10% velocity discount (₹27.0/kg) to accelerate clearance and protect ₹53,900 net profit."},
            {"batch_id": "B005", "commodity": "Onion (Nashik Red)", "dest_id": "D2", "dest_name": "Pune Reliance Fresh Hub", "tier": "Tier 1 - Premium Retail", "allocated_kg": 1000.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 40.0, "transport_cost_per_kg": 3.2, "net_profit": 36800.0, "margin_hrs": 66.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 72h shelf life comfortably exceeds 42h retail requirement. Dispatched to Pune Reliance Fresh Hub capturing top ₹40.0/kg realization."},
            {"batch_id": "B006", "commodity": "Spinach (Leafy Greens)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 1200.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 20160.0, "margin_hrs": 15.5, "status": "SAVED", "reasoning": "Shelf life (17h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹12,000 total spoilage."},
            {"batch_id": "B007", "commodity": "Tomato (Local)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 800.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 13440.0, "margin_hrs": 12.5, "status": "SAVED", "reasoning": "Shelf life (14h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹8,800 total spoilage."}
          ],
          metrics: {"baseline_spoilage_kg": 4500.0, "baseline_spoilage_pct": 34.6, "baseline_net_revenue": 248090.0, "optimized_spoilage_kg": 500.0, "optimized_spoilage_pct": 3.8, "optimized_net_revenue": 348040.0, "spoilage_reduction_pct": 88.9, "revenue_gain_pct": 40.3, "demand_fulfillment_pct": 74.4},
          disruption: {"type": "HIGHWAY_JAM", "delay_hrs": 6.0, "affected_dest_id": "D1", "baseline_metrics": {"baseline_spoilage_kg": 4500.0, "baseline_spoilage_pct": 34.6, "baseline_net_revenue": 248090.0, "optimized_spoilage_kg": 500.0, "optimized_spoilage_pct": 3.8, "optimized_net_revenue": 348040.0, "spoilage_reduction_pct": 88.9, "revenue_gain_pct": 40.3, "demand_fulfillment_pct": 74.4}}
        },
        ALL: {
          allocations: [
            {"batch_id": "B001", "commodity": "Tomato (Hybrid)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 2500.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 42000.0, "margin_hrs": 10.5, "status": "SAVED", "reasoning": "Shelf life (18h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹37,500 total spoilage."},
            {"batch_id": "B002", "commodity": "Tomato (Hybrid)", "dest_id": "D1", "dest_name": "Mumbai Nature's Basket", "tier": "Tier 1 - Premium Retail", "allocated_kg": 3000.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 42.0, "transport_cost_per_kg": 3.5, "net_profit": 115500.0, "margin_hrs": 49.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 62h shelf life comfortably exceeds 48h retail requirement. Dispatched to Mumbai Nature's Basket capturing top ₹42.0/kg realization."},
            {"batch_id": "B003", "commodity": "Capsicum (Green)", "dest_id": "D2", "dest_name": "Pune Reliance Fresh Hub", "tier": "Tier 1 - Premium Retail", "allocated_kg": 1800.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 40.0, "transport_cost_per_kg": 3.2, "net_profit": 66240.0, "margin_hrs": 42.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 54h shelf life comfortably exceeds 42h retail requirement. Dispatched to Pune Reliance Fresh Hub capturing top ₹40.0/kg realization."},
            {"batch_id": "B004", "commodity": "Robusta Banana", "dest_id": "D5", "dest_name": "Zepto/Blinkit Dark Store Hub", "tier": "Tier 2 - Rapid Mandi", "allocated_kg": 2200.0, "action": "DYNAMIC_DISCOUNT_DISPATCH", "discount_pct": 15.0, "effective_price_per_kg": 25.5, "transport_cost_per_kg": 2.5, "net_profit": 50600.0, "margin_hrs": 25.5, "status": "DISCOUNTED", "reasoning": "Remaining shelf-life buffer (25.5h) is tight for long retail storage. Allocated to Zepto/Blinkit Dark Store Hub with 15% velocity discount (₹25.5/kg) to accelerate clearance and protect ₹50,600 net profit."},
            {"batch_id": "B005", "commodity": "Onion (Nashik Red)", "dest_id": "D2", "dest_name": "Pune Reliance Fresh Hub", "tier": "Tier 1 - Premium Retail", "allocated_kg": 1000.0, "action": "PREMIUM_DISPATCH", "discount_pct": 0.0, "effective_price_per_kg": 40.0, "transport_cost_per_kg": 3.2, "net_profit": 36800.0, "margin_hrs": 60.5, "status": "OPTIMAL", "reasoning": "Grade A premium produce with 72h shelf life comfortably exceeds 42h retail requirement. Dispatched to Pune Reliance Fresh Hub capturing top ₹40.0/kg realization."},
            {"batch_id": "B006", "commodity": "Spinach (Leafy Greens)", "dest_id": "D4", "dest_name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "allocated_kg": 1200.0, "action": "SALVAGE_RECOVERY", "discount_pct": 0.0, "effective_price_per_kg": 18.0, "transport_cost_per_kg": 1.2, "net_profit": 20160.0, "margin_hrs": 9.5, "status": "SAVED", "reasoning": "Shelf life (17h) too short for Mumbai retail (48h min). Salvaged to Kissan Puree plant to prevent ₹12,000 total spoilage."},
            {"batch_id": "B007", "commodity": "Tomato (Local)", "dest_id": "NONE", "dest_name": "Unallocated / Composting", "tier": "Tier 3 - Processing Plant", "allocated_kg": 0.0, "action": "SPOILED_DISPOSAL", "discount_pct": 0.0, "effective_price_per_kg": 0.0, "transport_cost_per_kg": 0.0, "net_profit": 0.0, "margin_hrs": 0.0, "status": "SPOILED", "reasoning": "Critical shelf life (14.0h) expired before reaching destination minimum."}
          ],
          metrics: {"baseline_spoilage_kg": 4500.0, "baseline_spoilage_pct": 34.6, "baseline_net_revenue": 248090.0, "optimized_spoilage_kg": 1300.0, "optimized_spoilage_pct": 10.0, "optimized_net_revenue": 331300.0, "spoilage_reduction_pct": 71.1, "revenue_gain_pct": 33.5, "demand_fulfillment_pct": 69.6},
          disruption: {"type": "HIGHWAY_JAM", "delay_hrs": 6.0, "affected_dest_id": "ALL", "baseline_metrics": {"baseline_spoilage_kg": 4500.0, "baseline_spoilage_pct": 34.6, "baseline_net_revenue": 248090.0, "optimized_spoilage_kg": 500.0, "optimized_spoilage_pct": 3.8, "optimized_net_revenue": 348040.0, "spoilage_reduction_pct": 88.9, "revenue_gain_pct": 40.3, "demand_fulfillment_pct": 74.4}}
        }
      }
    },
    data: {
      batches: [
        {"batch_id": "B001", "commodity": "Tomato (Hybrid)", "quantity_kg": 2500, "shelf_life_hrs": 18.0, "quality_grade": "B", "base_cost_per_kg": 15.0},
        {"batch_id": "B002", "commodity": "Tomato (Hybrid)", "quantity_kg": 3000, "shelf_life_hrs": 62.0, "quality_grade": "A", "base_cost_per_kg": 16.0},
        {"batch_id": "B003", "commodity": "Capsicum (Green)", "quantity_kg": 1800, "shelf_life_hrs": 54.0, "quality_grade": "A", "base_cost_per_kg": 20.0},
        {"batch_id": "B004", "commodity": "Robusta Banana", "quantity_kg": 2200, "shelf_life_hrs": 36.0, "quality_grade": "B", "base_cost_per_kg": 12.0},
        {"batch_id": "B005", "commodity": "Onion (Nashik Red)", "quantity_kg": 1500, "shelf_life_hrs": 72.0, "quality_grade": "A", "base_cost_per_kg": 18.0},
        {"batch_id": "B006", "commodity": "Spinach (Leafy Greens)", "quantity_kg": 1200, "shelf_life_hrs": 17.0, "quality_grade": "B", "base_cost_per_kg": 10.0},
        {"batch_id": "B007", "commodity": "Tomato (Local)", "quantity_kg": 800, "shelf_life_hrs": 14.0, "quality_grade": "C", "base_cost_per_kg": 11.0}
      ],
      destinations: [
        {"dest_id": "D1", "name": "Mumbai Nature's Basket", "tier": "Tier 1 - Premium Retail", "demand_kg": 3000, "offering_price_per_kg": 42.0, "min_shelf_life_hrs": 48.0, "distance_km": 170, "transit_time_hrs": 6.5, "transport_cost_per_kg": 3.5},
        {"dest_id": "D2", "name": "Pune Reliance Fresh Hub", "tier": "Tier 1 - Premium Retail", "demand_kg": 2800, "offering_price_per_kg": 40.0, "min_shelf_life_hrs": 42.0, "distance_km": 210, "transit_time_hrs": 5.5, "transport_cost_per_kg": 3.2},
        {"dest_id": "D3", "name": "Vashi APMC Rapid Mandi", "tier": "Tier 2 - Rapid Mandi", "demand_kg": 3500, "offering_price_per_kg": 28.0, "min_shelf_life_hrs": 20.0, "distance_km": 160, "transit_time_hrs": 5.0, "transport_cost_per_kg": 2.8},
        {"dest_id": "D4", "name": "Kissan Food Processing Hub", "tier": "Tier 3 - Processing Plant", "demand_kg": 5000, "offering_price_per_kg": 18.0, "min_shelf_life_hrs": 8.0, "distance_km": 45, "transit_time_hrs": 1.5, "transport_cost_per_kg": 1.2},
        {"dest_id": "D5", "name": "Zepto/Blinkit Dark Store Hub", "tier": "Tier 2 - Rapid Mandi", "demand_kg": 2500, "offering_price_per_kg": 30.0, "min_shelf_life_hrs": 14.0, "distance_km": 140, "transit_time_hrs": 4.5, "transport_cost_per_kg": 2.5}
      ],
      routes: [
        {"route_id": "R01", "origin_hub": "Nashik Agri Aggregation Hub", "dest_id": "D1", "distance_km": 170, "transit_time_hrs": 6.5, "transport_cost_per_kg": 3.5, "vehicle_type": "Refrigerated Reefer 5T", "status": "CLEAR"},
        {"route_id": "R02", "origin_hub": "Nashik Agri Aggregation Hub", "dest_id": "D2", "distance_km": 210, "transit_time_hrs": 5.5, "transport_cost_per_kg": 3.2, "vehicle_type": "Refrigerated Reefer 5T", "status": "CLEAR"},
        {"route_id": "R03", "origin_hub": "Nashik Agri Aggregation Hub", "dest_id": "D3", "distance_km": 160, "transit_time_hrs": 5.0, "transport_cost_per_kg": 2.8, "vehicle_type": "Covered Ventilated 8T", "status": "CLEAR"},
        {"route_id": "R04", "origin_hub": "Nashik Agri Aggregation Hub", "dest_id": "D4", "distance_km": 45, "transit_time_hrs": 1.5, "transport_cost_per_kg": 1.2, "vehicle_type": "Direct Bulk Tipper 10T", "status": "CLEAR"},
        {"route_id": "R05", "origin_hub": "Nashik Agri Aggregation Hub", "dest_id": "D5", "distance_km": 140, "transit_time_hrs": 4.5, "transport_cost_per_kg": 2.5, "vehicle_type": "Express Reefer Van 2T", "status": "CLEAR"}
      ]
    },
    stats: {"batches": {"count": 7, "total_kg": 13000, "shelf_life_hrs": {"min": 14.0, "max": 72.0, "avg": 39.0}}, "destinations": {"count": 5, "total_demand_kg": 16800, "by_tier": {"Tier 1 - Premium Retail": 2, "Tier 2 - Rapid Mandi": 2, "Tier 3 - Processing Plant": 1}}, "routes": {"count": 5}}
  });

  /* ===================================================================
     4. Formatting helpers (en-IN)
     =================================================================== */
  var NA = 'N/A';
  var MINUS = '−';
  var nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nfMax2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
  function sign(v) { return v < 0 ? MINUS : ''; }

  var fmt = {
    kg: function (v) { return isNum(v) ? sign(v) + (Number.isInteger(v) ? nf0 : nf1).format(Math.abs(v)) + ' kg' : NA; },
    inr: function (v) { return isNum(v) ? sign(v) + '₹' + nf0.format(Math.abs(Math.round(v))) : NA; },
    inrPrice: function (v) { return isNum(v) ? sign(v) + '₹' + nf2.format(Math.abs(v)) : NA; },
    inrCompact: function (v) {
      if (!isNum(v)) return NA;
      var a = Math.abs(v);
      if (a >= 1e7) return sign(v) + '₹' + nfMax2.format(a / 1e7) + ' Cr';
      if (a >= 1e5) return sign(v) + '₹' + nfMax2.format(a / 1e5) + ' L';
      if (a >= 1e3) return sign(v) + '₹' + nfMax2.format(a / 1e3) + 'K';
      return sign(v) + '₹' + nf0.format(a);
    },
    pct: function (v) { return isNum(v) ? sign(v) + nf1.format(Math.abs(v)) + '%' : NA; },
    pctLoose: function (v) { return isNum(v) ? sign(v) + nfMax2.format(Math.abs(v)) + '%' : NA; },
    hrs: function (v) { return isNum(v) ? sign(v) + nf1.format(Math.abs(v)) + ' h' : NA; },
    signedHrs: function (v) { return isNum(v) ? (v > 0 ? '+' : sign(v)) + nf1.format(Math.abs(v)) + ' h' : NA; },
    signedInr: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmt.inr(v) : NA; },
    signedKg: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmt.kg(v) : NA; },
    time: function (d) { return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); },
    action: function (a) { return a ? (ACTION_LABEL[a] || humanize(a)) : NA; },
    status: function (s) { return s ? humanize(s) : NA; }
  };

  function humanize(s) {
    var t = String(s).replace(/_/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') { var n = Number(v); return Number.isFinite(n) ? n : null; }
    return null;
  }
  function toStr(v) { return v === null || v === undefined ? '' : String(v); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function tierMeta(t) { return TIER_META[t] || { short: t ? String(t) : 'Unassigned', rank: 9, tone: 'tone-t0' }; }
  function cssVar(name, fallback) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : (/(ch|sh|s|x)$/.test(word) ? 'es' : 's')); }

  var ICON = {
    alert: '<svg class="notice-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    flask: '<svg class="notice-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7 15h10"/></svg>',
    siren: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14v-3H5z"/><path d="M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4"/></svg>'
  };

  /* ===================================================================
     5. State — one canonical result drives every view
     =================================================================== */
  var state = {
    api: { reach: 'checking', health: null, checkedAt: null, forced: false },
    context: null,   // { source: 'api'|'mock', data, stats, errors: [] }
    result: null,    // canonical result (see buildResult)
    runError: null,  // last failed run, shown in the banner until a success or reset
    pending: null,   // { kind, controller, seq }
    connecting: false,
    seq: 0,
    apiDisruptionRan: false,
    filters: { search: '', tier: '', status: '' },
    sort: { key: null, dir: 'asc' },
    drawerIdx: null,
    lastFocus: null,
    slowTimer: null,
    charts: { spoilage: null, revenue: null },
    chartsFailed: false
  };
  var els = {};

  /* ===================================================================
     6. API layer
     =================================================================== */
  function ApiError(kind, message, status) {
    this.name = 'ApiError';
    this.kind = kind;         // network | timeout | http | invalid_json | contract | aborted
    this.message = message;
    this.status = status || null;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function endpointLabel(key) { var ep = CONFIG.ENDPOINTS[key]; return ep.method + ' ' + ep.path; }

  function fastApiDetail(text) {
    try {
      var j = JSON.parse(text);
      if (j && typeof j.detail === 'string') return j.detail;
      if (j && Array.isArray(j.detail)) {
        return j.detail.map(function (d) {
          var loc = Array.isArray(d.loc) ? d.loc.join('.') : '';
          return (loc ? loc + ': ' : '') + (d.msg || 'invalid');
        }).join('; ');
      }
    } catch (e) { /* non-JSON error body */ }
    return '';
  }

  async function request(key, opts) {
    var ep = CONFIG.ENDPOINTS[key];
    var ctrl = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, opts.timeoutMs);
    var onOuter = function () { ctrl.abort(); };
    if (opts.signal) opts.signal.addEventListener('abort', onOuter);

    var init = { method: ep.method, headers: { Accept: 'application/json' }, signal: ctrl.signal, cache: 'no-store' };
    var body = ep.method === 'POST' ? requestBodyFor(key) : null;
    if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }

    var t0 = performance.now();
    var res, text;
    try {
      res = await fetch(RUNTIME.baseUrl + ep.path, init);
      text = await res.text();
    } catch (err) {
      if (timedOut) throw new ApiError('timeout', 'No response within ' + Math.round(opts.timeoutMs / 1000) + ' s');
      if (err && err.name === 'AbortError') throw new ApiError('aborted', 'Request cancelled');
      throw new ApiError('network', 'Network request failed');
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onOuter);
    }
    var ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      var detail = fastApiDetail(text);
      throw new ApiError('http', 'HTTP ' + res.status + (detail ? ' — ' + detail : ''), res.status);
    }
    var json;
    try { json = JSON.parse(text); } catch (e) { throw new ApiError('invalid_json', 'Response was not valid JSON'); }
    return { json: json, ms: ms, body: body };
  }

  function describeError(err) {
    switch (err.kind) {
      case 'timeout': return 'No response from ' + RUNTIME.baseUrl + ' in time.';
      case 'network': return 'Could not reach ' + RUNTIME.baseUrl + ' (server offline, wrong port, or blocked by the browser).';
      case 'http': return 'Backend responded with ' + err.message + '.';
      case 'invalid_json': return 'Backend response was not valid JSON.';
      case 'contract': return 'Response did not match the API contract: ' + err.message + '.';
      default: return 'Unexpected error.';
    }
  }

  // Recognise the known main.py ↔ optimizer.py method mismatch so the banner can say so plainly.
  function knownBackendHint(err) {
    if (err && err.kind === 'http' && /no attribute 'optimize'/.test(err.message)) {
      return 'Known integration issue: backend/main.py calls optimizer.optimize(...), but engine/optimizer.py defines run_cascade_optimization(...). This must be fixed in the backend; the frontend cannot work around it.';
    }
    return '';
  }

  /* ===================================================================
     7. Validation & normalisation (never mutates the response)
     =================================================================== */
  function validateRunPayload(json) {
    if (!isObj(json)) throw new ApiError('contract', 'expected a JSON object');
    if (!Array.isArray(json.allocations)) throw new ApiError('contract', '"allocations" is not an array');
    if (!isObj(json.metrics)) throw new ApiError('contract', '"metrics" is not an object');
    return json;
  }

  function readMetrics(raw) {
    var out = { _missing: [] };
    METRIC_KEYS.forEach(function (k) {
      var v = isObj(raw) ? toNum(raw[k]) : null;
      out[k] = v;
      if (v === null) out._missing.push(k);
    });
    return out;
  }

  function isSpoiledRow(r) { return r.status === 'SPOILED' || r.action === 'SPOILED_DISPOSAL' || r.dest_id === 'NONE'; }

  function buildRows(allocations) {
    return allocations.map(function (a, idx) {
      var ok = isObj(a);
      var o = ok ? a : {};
      var row = {
        idx: idx,
        malformed: !ok,
        batch_id: toStr(o.batch_id),
        commodity: toStr(o.commodity),
        dest_id: toStr(o.dest_id),
        dest_name: toStr(o.dest_name),
        tier: toStr(o.tier),
        allocated_kg: toNum(o.allocated_kg),
        action: toStr(o.action),
        discount_pct: toNum(o.discount_pct),
        effective_price_per_kg: toNum(o.effective_price_per_kg),
        transport_cost_per_kg: toNum(o.transport_cost_per_kg),
        net_profit: toNum(o.net_profit),
        margin_hrs: toNum(o.margin_hrs),
        status: toStr(o.status),
        reasoning: typeof o.reasoning === 'string' ? o.reasoning : ''
      };
      row.spoiled = isSpoiledRow(row);
      return row;
    });
  }

  function readDisruption(d) {
    if (!isObj(d)) return null;
    return {
      type: toStr(d.type),
      delay_hrs: toNum(d.delay_hrs),
      affected_dest_id: toStr(d.affected_dest_id),
      baseline_metrics: isObj(d.baseline_metrics) ? readMetrics(d.baseline_metrics) : null
    };
  }

  function buildResult(payload, meta) {
    return {
      source: meta.source,           // 'optimizer' | 'api_fallback' | 'api_unverified' | 'mock'
      kind: meta.kind,               // 'optimize' | 'disruption'
      endpointKey: meta.endpointKey || null,
      requestBody: meta.requestBody || null,
      ms: meta.ms == null ? null : meta.ms,
      mockReason: meta.mockReason || null,
      rows: buildRows(payload.allocations),
      metrics: readMetrics(payload.metrics),
      disruption: readDisruption(payload.disruption),
      receivedAt: new Date(),
      compareTo: null,
      changes: null
    };
  }

  function sourceFromHealth() {
    var h = state.api.health;
    if (h && h.optimizer_available === true) return 'optimizer';
    if (h && h.optimizer_available === false) return 'api_fallback';
    return 'api_unverified';
  }

  // Display-only diff between two plans of the same source.
  function computeChanges(prevRows, curRows) {
    function index(rows) {
      var m = new Map();
      rows.forEach(function (r) {
        if (!r.batch_id) return;
        if (!m.has(r.batch_id)) m.set(r.batch_id, { dests: new Map(), rows: [], spoiled: false });
        var e = m.get(r.batch_id);
        e.rows.push(r);
        if (r.spoiled) e.spoiled = true;
        else e.dests.set(r.dest_id || r.dest_name, r.dest_name || r.dest_id);
      });
      return m;
    }
    var before = index(prevRows), after = index(curRows), out = new Map();
    after.forEach(function (cur, batch) {
      var prev = before.get(batch);
      if (!prev) return;
      var keysA = Array.from(cur.dests.keys()), same = keysA.length === prev.dests.size && keysA.every(function (k) { return prev.dests.has(k); });
      var marginDelta = null;
      if (same && cur.rows.length === 1 && prev.rows.length === 1 && isNum(cur.rows[0].margin_hrs) && isNum(prev.rows[0].margin_hrs) && !cur.spoiled) {
        marginDelta = Math.round((cur.rows[0].margin_hrs - prev.rows[0].margin_hrs) * 10) / 10;
        if (marginDelta === 0) marginDelta = null;
      }
      var becameSpoiled = cur.spoiled && !prev.spoiled;
      var rerouted = !same && !becameSpoiled && cur.dests.size > 0;
      if (rerouted || becameSpoiled || marginDelta !== null) {
        out.set(batch, { rerouted: rerouted, becameSpoiled: becameSpoiled, marginDelta: marginDelta, prevDests: Array.from(prev.dests.values()) });
      }
    });
    return out;
  }

  // Per-batch quantity the plan leaves unallocated (batch quantity_kg − Σ allocated_kg).
  // Only computed when the batch list belongs to the same dataset as the result.
  function shortfallMap(result) {
    var batches = null;
    if (result.source === 'mock') batches = DEMO && DEMO.data && DEMO.data.batches;
    else if (result.source === 'optimizer' && state.context && state.context.source === 'api' && state.context.data) batches = state.context.data.batches;
    if (!Array.isArray(batches)) return null;
    var allocated = new Map();
    result.rows.forEach(function (r) { if (r.batch_id && isNum(r.allocated_kg)) allocated.set(r.batch_id, (allocated.get(r.batch_id) || 0) + r.allocated_kg); });
    var out = new Map();
    batches.forEach(function (b) {
      var q = toNum(b.quantity_kg);
      if (!isNum(q) || !allocated.has(b.batch_id)) return;
      var gap = Math.round((q - allocated.get(b.batch_id)) * 10) / 10;
      if (gap > 0) out.set(b.batch_id, { gap: gap, qty: q });
    });
    return out;
  }

  /* ===================================================================
     8. Connection, context & run flows
     =================================================================== */
  async function checkHealth(timeoutMs) {
    try {
      var out = await request('health', { timeoutMs: timeoutMs });
      if (!isObj(out.json)) throw new ApiError('contract', 'health response is not an object');
      state.api.reach = 'ok';
      state.api.health = out.json;
      state.api.checkedAt = new Date();
      return true;
    } catch (err) {
      state.api.reach = 'down';
      state.api.health = null;
      state.api.checkedAt = new Date();
      state.api.lastError = err;
      return false;
    }
  }

  async function loadContext() {
    var results = await Promise.allSettled([
      request('data', { timeoutMs: CONFIG.TIMEOUTS.context }),
      request('stats', { timeoutMs: CONFIG.TIMEOUTS.context })
    ]);
    var ctx = { source: 'api', data: null, stats: null, errors: [] };
    var d = results[0], s = results[1];
    if (d.status === 'fulfilled' && isObj(d.value.json) && Array.isArray(d.value.json.batches) && Array.isArray(d.value.json.destinations) && Array.isArray(d.value.json.routes)) {
      ctx.data = d.value.json;
    } else {
      ctx.errors.push(endpointLabel('data') + ': ' + (d.status === 'rejected' ? describeError(d.reason) : 'unexpected shape'));
    }
    if (s.status === 'fulfilled' && isObj(s.value.json) && isObj(s.value.json.batches) && isObj(s.value.json.destinations)) {
      ctx.stats = s.value.json;
    } else {
      ctx.errors.push(endpointLabel('stats') + ': ' + (s.status === 'rejected' ? describeError(s.reason) : 'unexpected shape'));
    }
    state.context = ctx;
    renderContext();
    return ctx;
  }

  function useDemoContext() {
    state.context = { source: 'mock', data: clone(DEMO.data), stats: clone(DEMO.stats), errors: [] };
    renderContext();
  }

  async function connect(opts) {
    opts = opts || {};
    if (state.connecting || state.pending) return;
    state.connecting = true;
    setActionsDisabled(true);
    els.reconnectBtn.classList.add('is-spinning');
    els.reconnectBtn.disabled = true;
    state.api.reach = 'checking';
    renderApiStatus();

    var ok = await checkHealth(CONFIG.TIMEOUTS.health);
    if (ok) {
      await loadContext();
      var h = state.api.health;
      toast({
        tone: h.optimizer_available === true ? 'success' : 'warning',
        title: h.optimizer_available === true ? 'Backend connected · optimizer available' : 'Backend connected · optimizer NOT available',
        message: h.optimizer_available === true
          ? 'Run the optimizer to compute a live plan.'
          : 'The API will answer with its built-in fallback mock, not real optimizer output.'
      });
      if (h.data_loaded === false) toast({ tone: 'warning', title: 'Backend reports data_loaded: false', message: 'The server could not load data/*.json; results may be empty.' });
    } else if (opts.boot) {
      useDemoContext();
      applyResult(makeDemoResult('optimize', 'unreachable'));
      toast({
        tone: 'demo',
        title: 'Running in DEMO MODE',
        message: describeError(state.api.lastError) + ' Showing an illustrative local snapshot — not a live API response.',
        actions: [{ label: 'Retry connection', run: function () { connect(); } }],
        timeout: 9000
      });
    } else {
      toast({ tone: 'error', title: 'Backend still unreachable', message: describeError(state.api.lastError) + ' The current view is unchanged.' });
    }

    state.connecting = false;
    setActionsDisabled(false);
    els.reconnectBtn.classList.remove('is-spinning');
    els.reconnectBtn.disabled = false;
    renderAll({ fresh: false });
  }

  function makeDemoResult(kind, reason) {
    var payload;
    if (kind === 'optimize') payload = clone(DEMO.snapshots.optimize);
    else {
      var key = RUNTIME.disruptionBody.affected_dest_id || 'ALL';
      if (!DEMO.snapshots.disruption[key]) return null;
      payload = clone(DEMO.snapshots.disruption[key]);
    }
    return buildResult(payload, { source: 'mock', kind: kind, mockReason: reason });
  }

  async function runScenario(kind) {
    if (state.pending || state.connecting) return;
    var seq = ++state.seq;
    var controller = new AbortController();
    state.pending = { kind: kind, controller: controller, seq: seq };
    setBusy(kind, true);

    try {
      var live = !RUNTIME.forceMock && state.api.reach === 'ok';
      // If we were offline, quietly re-check before falling back to demo data.
      if (!RUNTIME.forceMock && !live) {
        live = await checkHealth(CONFIG.TIMEOUTS.reconnect);
        if (seq !== state.seq) return;
        if (live) await loadContext();
        renderApiStatus();
      }

      if (!live) {
        await delay(CONFIG.DEMO_LATENCY_MS);
        if (seq !== state.seq) return;
        showDemo(kind, RUNTIME.forceMock ? 'forced' : 'unreachable');
        return;
      }

      var out = await request(kind, { timeoutMs: CONFIG.TIMEOUTS.run, signal: controller.signal });
      if (seq !== state.seq) return;
      var payload = validateRunPayload(out.json);
      var result = buildResult(payload, { source: sourceFromHealth(), kind: kind, endpointKey: kind, ms: out.ms, requestBody: out.body });
      if (kind === 'disruption') state.apiDisruptionRan = true;
      applyResult(result);
      announceSuccess(result);
      // Re-read server data so the network panel reflects the server's current route state.
      loadContext();
    } catch (err) {
      if (seq !== state.seq) return;
      if (!(err instanceof ApiError)) { console.error(err); err = new ApiError('contract', 'response could not be displayed'); }
      if (err.kind === 'aborted') return;
      handleRunFailure(kind, err);
    } finally {
      if (seq === state.seq) {
        state.pending = null;
        setBusy(kind, false);
      }
    }
  }

  function showDemo(kind, reason) {
    var result = makeDemoResult(kind, reason);
    if (!result) {
      toast({ tone: 'warning', title: 'No demo snapshot for this scenario', message: 'The local demo covers D1 and all-routes disruptions only.' });
      return;
    }
    if (!state.context || state.context.source !== 'mock') {
      if (state.api.reach !== 'ok') useDemoContext();
    }
    applyResult(result);
    toast({
      tone: 'demo',
      title: kind === 'disruption' ? 'Demo disruption shown' : 'Demo plan shown',
      message: 'Illustrative local snapshot — not a live API response.' + (reason === 'unreachable' ? ' The backend is unreachable.' : '')
    });
  }

  function announceSuccess(result) {
    var n = result.rows.length;
    var title = result.kind === 'disruption' ? 'Disruption simulated' : 'Optimization complete';
    var extra = '';
    if (result.kind === 'disruption' && result.changes) {
      var rer = 0, sp = 0;
      result.changes.forEach(function (c) { if (c.rerouted) rer++; if (c.becameSpoiled) sp++; });
      extra = ' ' + plural(rer, 'batch') + ' rerouted, ' + sp + ' newly spoiled.';
    }
    toast({
      tone: result.source === 'optimizer' ? 'success' : 'warning',
      title: title + (result.source === 'optimizer' ? '' : ' (' + SOURCE_LABEL[result.source] + ')'),
      message: plural(n, 'allocation') + ' from ' + endpointLabel(result.endpointKey) + ' in ' + result.ms + ' ms.' + extra
    });
    if (result.metrics._missing.length) {
      toast({ tone: 'warning', title: 'Some metrics missing', message: result.metrics._missing.join(', ') + ' — shown as N/A.', timeout: 9000 });
    }
    var bad = result.rows.filter(function (r) { return r.malformed; }).length;
    if (bad) toast({ tone: 'warning', title: 'Malformed allocations', message: bad + ' entr' + (bad === 1 ? 'y is' : 'ies are') + ' not objects; shown as N/A rows.' });
  }

  function handleRunFailure(kind, err) {
    var unreachable = err.kind === 'network' || err.kind === 'timeout';
    if (unreachable) state.api.reach = 'down';
    state.runError = { kind: kind, err: err, at: new Date() };
    renderApiStatus();
    renderBanner();
    var label = kind === 'disruption' ? 'Disruption simulation' : 'Optimization';
    toast({
      tone: 'error',
      title: label + ' failed',
      message: describeError(err) + ' The previous view is unchanged.',
      actions: [
        { label: 'Retry', run: function () { runScenario(kind); } },
        { label: 'Show demo data', run: function () { showDemo(kind, 'user'); } }
      ],
      timeout: 10000
    });
  }

  function applyResult(result) {
    var prev = state.result;
    if (result.kind === 'disruption' && prev) {
      var base = prev.kind === 'optimize' ? prev : prev.compareTo;
      if (base && base.source === result.source) {
        result.compareTo = base;
        result.changes = computeChanges(base.rows, result.rows);
      }
    }
    state.result = result;
    state.runError = null;
    closeDrawer({ restoreFocus: false });
    rebuildFilterOptions();
    renderAll({ fresh: true });
    if (!reducedMotion()) {
      var grid = document.querySelector('.kpi-grid');
      grid.classList.remove('flash'); void grid.offsetWidth; grid.classList.add('flash');
    }
  }

  function resetView() {
    var cancelled = false;
    if (state.pending) {
      var kind = state.pending.kind;
      state.pending.controller.abort();
      state.seq++;
      state.pending = null;
      setBusy(kind, false);
      cancelled = true;
    }
    closeDrawer({ restoreFocus: false });
    state.filters = { search: '', tier: '', status: '' };
    els.searchInput.value = '';
    state.sort = { key: null, dir: 'asc' };
    state.runError = null;

    var msg;
    if (state.result && state.result.source === 'mock') {
      state.result = null;
      applyResult(makeDemoResult('optimize', 'reset'));
      msg = 'Restored the demo base plan. No API call was made.';
    } else {
      state.result = null;
      rebuildFilterOptions();
      renderAll({ fresh: false });
      if (state.api.reach === 'ok') loadContext();
      msg = state.apiDisruptionRan
        ? 'Cleared the local view. The backend was NOT rolled back: its disruption endpoint changes route timings in server memory, so restart the backend to restore the original route data.'
        : 'Cleared the local view. No server state was changed.';
    }
    toast({ tone: 'info', title: 'View reset', message: (cancelled ? 'In-flight request cancelled. ' : '') + msg, timeout: state.apiDisruptionRan ? 10000 : 5000 });
  }

  /* ===================================================================
     9. Rendering — single path
     =================================================================== */
  function renderAll(opts) {
    var fresh = !!(opts && opts.fresh);
    document.body.classList.remove('is-booting');
    document.body.classList.toggle('no-result', !state.result);
    renderApiStatus();
    renderBanner();
    renderRunMeta();
    renderSourceTag();
    renderDisruption();
    renderKPIs();
    renderCharts(fresh);
    renderTierFlow();
    renderTable(fresh);
  }

  function renderApiStatus() {
    var s, label, title;
    var h = state.api.health;
    if (state.api.reach === 'checking') { s = 'checking'; label = 'CHECKING API'; title = 'Contacting ' + RUNTIME.baseUrl; }
    else if (state.api.reach === 'ok') {
      if (h && h.optimizer_available === true) { s = 'live'; label = 'LIVE OPTIMIZER'; title = 'GET /api/health: optimizer_available = true'; }
      else if (h && h.optimizer_available === false) { s = 'fallback'; label = 'API FALLBACK'; title = 'API reachable but optimizer_available = false — responses are the backend’s built-in mock'; }
      else { s = 'fallback'; label = 'API · OPTIMIZER UNKNOWN'; title = 'Health response did not include optimizer_available'; }
    } else {
      var demoShown = (!state.result || state.result.source === 'mock') && (!state.context || state.context.source === 'mock');
      if (demoShown || RUNTIME.forceMock) { s = 'demo'; label = 'DEMO MODE'; title = RUNTIME.forceMock ? 'Forced with ?mock=1' : 'API unreachable at ' + RUNTIME.baseUrl + ' — local demo data'; }
      else { s = 'offline'; label = 'API UNREACHABLE'; title = 'API unreachable at ' + RUNTIME.baseUrl + ' — showing the last API result'; }
    }
    els.apiStatus.dataset.state = s;
    els.apiStatusLabel.textContent = label;
    els.apiStatus.title = title;
    els.demoBtn.hidden = !(state.api.reach !== 'ok' || state.runError) || (state.result && state.result.source === 'mock');

    var r = state.result;
    if (r) {
      els.lastUpdated.hidden = false;
      els.lastUpdated.dateTime = r.receivedAt.toISOString();
      els.lastUpdated.textContent = (r.source === 'mock' ? 'Demo loaded ' : 'Updated ') + fmt.time(r.receivedAt);
    } else if (state.api.checkedAt) {
      els.lastUpdated.hidden = false;
      els.lastUpdated.dateTime = state.api.checkedAt.toISOString();
      els.lastUpdated.textContent = 'Checked ' + fmt.time(state.api.checkedAt);
    } else {
      els.lastUpdated.hidden = true;
    }
  }

  function banner(tone, icon, html, actions) {
    els.sourceBanner.dataset.tone = tone;
    els.sourceBanner.innerHTML = icon + '<div class="notice-text">' + html + '</div>' +
      (actions && actions.length ? '<div class="notice-actions">' + actions.map(function (a) {
        return '<button type="button" class="btn btn-ghost btn-sm" data-banner-action="' + esc(a.action) + '">' + esc(a.label) + '</button>';
      }).join('') + '</div>' : '');
    els.sourceBanner.hidden = false;
  }

  function renderBanner() {
    var r = state.result, e = state.runError, h = state.api.health;
    if (e) {
      var hint = knownBackendHint(e.err);
      banner('error', ICON.alert,
        '<strong>' + (e.kind === 'disruption' ? 'Disruption simulation failed.' : 'Optimization failed.') + '</strong>' +
        esc(describeError(e.err)) + (hint ? '<br><span>' + esc(hint) + '</span>' : '') +
        (r ? '<br><span>The view below still shows the previous ' + (r.source === 'mock' ? 'demo' : 'API') + ' result.</span>' : ''),
        [{ action: 'retry', label: 'Retry' }, { action: 'demo', label: 'Show demo data' }]);
      return;
    }
    if (r && r.source === 'mock') {
      var why = { forced: 'Forced with ?mock=1.', unreachable: 'The backend at ' + RUNTIME.baseUrl + ' is unreachable.', user: 'Shown on request.', reset: 'Demo base plan restored.' }[r.mockReason] || '';
      banner('demo', ICON.flask,
        '<strong>Demo data.</strong>Illustrative local snapshot of the engine’s output on the repository sample data — not a live API response. ' + esc(why),
        RUNTIME.forceMock ? [] : [{ action: 'reconnect', label: 'Use live API' }]);
      return;
    }
    if (r && r.source === 'api_fallback') {
      banner('warn', ICON.alert,
        '<strong>API fallback result.</strong>The backend reports <code>optimizer_available: false</code>, so it returned its built-in mock response. These numbers are placeholders and do not correspond to the sample dataset.', []);
      return;
    }
    if (r && r.source === 'api_unverified') {
      banner('warn', ICON.alert, '<strong>Optimizer status unknown.</strong>This API result arrived, but <code>/api/health</code> did not confirm <code>optimizer_available</code>.', [{ action: 'reconnect', label: 'Re-check health' }]);
      return;
    }
    if (state.api.reach === 'ok' && h && h.data_loaded === false) {
      banner('warn', ICON.alert, '<strong>Backend data not loaded.</strong><code>/api/health</code> reports <code>data_loaded: false</code>.', []);
      return;
    }
    els.sourceBanner.hidden = true;
    els.sourceBanner.innerHTML = '';
  }

  function renderRunMeta() {
    var r = state.result;
    if (!r) {
      els.runMeta.innerHTML = state.api.reach === 'ok'
        ? 'Backend connected. Run the optimizer to compute a plan.'
        : (state.api.reach === 'checking' ? 'Checking backend…' : 'No plan computed yet.');
      return;
    }
    var n = plural(r.rows.length, 'allocation');
    if (r.source === 'mock') { els.runMeta.innerHTML = 'Local demo snapshot · ' + esc(n) + ' · <strong>not an API response</strong>'; return; }
    els.runMeta.innerHTML = '<code>' + esc(endpointLabel(r.endpointKey)) + '</code> <code>' + esc(JSON.stringify(r.requestBody)) + '</code> · ' + esc(String(r.ms)) + ' ms · ' + esc(n);
  }

  function renderSourceTag() {
    var r = state.result;
    els.resultSourceTag.dataset.source = r ? r.source : 'none';
    els.resultSourceTag.textContent = r ? SOURCE_LABEL[r.source] + (r.kind === 'disruption' ? ' · disruption' : '') : 'No result yet';
  }

  /* ---- Disruption panel ---- */
  function destName(id) {
    var d = state.context && state.context.data && state.context.data.destinations;
    if (!Array.isArray(d)) return '';
    for (var i = 0; i < d.length; i++) if (d[i].dest_id === id) return toStr(d[i].name);
    return '';
  }

  function renderDisruption() {
    var r = state.result, p = els.disruptionPanel;
    if (!r || r.kind !== 'disruption') { p.hidden = true; p.innerHTML = ''; return; }
    var d = r.disruption;
    var isMock = r.source === 'mock';
    var facts = [];
    if (d) {
      facts.push(['Type', d.type ? humanize(d.type) : NA]);
      facts.push(['Delay', isNum(d.delay_hrs) ? '+' + fmt.hrs(d.delay_hrs) : NA]);
      var aff = d.affected_dest_id;
      facts.push(['Affected', !aff ? NA : aff === 'ALL' ? 'All routes' : aff + (destName(aff) ? ' · ' + destName(aff) : '')]);
    }

    // Summary of per-batch changes vs the previous plan of the same source
    var items = [];
    if (r.changes) {
      var rer = [], sp = [], mar = [];
      r.changes.forEach(function (c, b) { if (c.rerouted) rer.push(b); if (c.becameSpoiled) sp.push(b); if (c.marginDelta !== null) mar.push(b + ' ' + fmt.signedHrs(c.marginDelta)); });
      if (!rer.length && !sp.length) items.push('No batch changed destination — remaining shelf-life margins absorbed the delay.');
      if (rer.length) items.push(plural(rer.length, 'batch') + ' rerouted: ' + rer.join(', '));
      if (sp.length) items.push(plural(sp.length, 'batch') + ' now spoiled (no feasible destination): ' + sp.join(', '));
      if (mar.length) items.push('Shelf-life margin changed: ' + mar.join(', '));
    } else {
      items.push('Run the base optimization first to see per-batch changes against it.');
    }

    var table = '';
    var bm = d && d.baseline_metrics, m = r.metrics;
    if (bm) {
      var rowsT = [
        ['Modelled spoilage', fmt.kg(bm.optimized_spoilage_kg), fmt.kg(m.optimized_spoilage_kg), isNum(bm.optimized_spoilage_kg) && isNum(m.optimized_spoilage_kg) ? fmt.signedKg(m.optimized_spoilage_kg - bm.optimized_spoilage_kg) : NA],
        ['Modelled net revenue', fmt.inr(bm.optimized_net_revenue), fmt.inr(m.optimized_net_revenue), isNum(bm.optimized_net_revenue) && isNum(m.optimized_net_revenue) ? fmt.signedInr(m.optimized_net_revenue - bm.optimized_net_revenue) : NA],
        ['Demand fulfilled', fmt.pct(bm.demand_fulfillment_pct), fmt.pct(m.demand_fulfillment_pct), '']
      ];
      table = '<table class="mini-table"><caption>Optimized plan before vs after the delay (from <code>disruption.baseline_metrics</code>)</caption>' +
        '<thead><tr><th scope="col">Metric</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead><tbody>' +
        rowsT.map(function (x) { return '<tr><th scope="row">' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td><td>' + esc(x[2]) + '</td><td>' + esc(x[3]) + '</td></tr>'; }).join('') +
        '</tbody></table>';
    } else {
      table = '<p class="card-sub">Pre-disruption metrics were not included in this response (<code>disruption.baseline_metrics</code> missing).</p>';
    }

    p.innerHTML =
      '<div class="disruption-head"><div>' +
        '<h2 id="disruptionTitle" class="disruption-title">' + ICON.siren + 'Disruption scenario' + (isMock ? ' <span class="mock-tag">DEMO SCENARIO — NOT API OUTPUT</span>' : '') + '</h2>' +
        (d ? '<div class="disruption-facts">' + facts.map(function (f) { return '<span class="fact"><span>' + esc(f[0]) + '</span><strong>' + esc(f[1]) + '</strong></span>'; }).join('') + '</div>'
           : '<p class="card-sub">The response did not include a <code>disruption</code> object.</p>') +
      '</div><span class="source-tag" data-source="' + esc(r.source) + '">' + esc(SOURCE_LABEL[r.source]) + '</span></div>' +
      '<div class="disruption-grid"><ul class="disruption-summary">' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' +
      '<div>' + table + '</div></div>';
    p.hidden = false;
  }

  /* ---- KPI cards ---- */
  function animateNumber(el, to, format) {
    if (el._raf) { cancelAnimationFrame(el._raf); el._raf = null; }
    if (!isNum(to)) { el._value = null; el.textContent = state.result ? NA : '—'; el.classList.toggle('is-na', !!state.result); return; }
    el.classList.remove('is-na');
    var from = isNum(el._value) ? el._value : null;
    if (from === to || reducedMotion()) { el._value = to; el.textContent = format(to); return; }
    var start = from === null ? 0 : from, t0 = performance.now(), dur = 900;
    el._value = to;
    var step = function (now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = format(start + (to - start) * e);
      if (p < 1) el._raf = requestAnimationFrame(step); else { el.textContent = format(to); el._raf = null; }
    };
    el._raf = requestAnimationFrame(step);
  }

  function setTrend(el, value, pos, neg) {
    if (!state.result) { el.dataset.tone = 'neutral'; el.textContent = '—'; return; }
    if (!isNum(value)) { el.dataset.tone = 'neutral'; el.textContent = 'Not available'; return; }
    if (value > 0) { el.dataset.tone = 'good'; el.textContent = pos; }
    else if (value < 0) { el.dataset.tone = 'bad'; el.textContent = neg; }
    else { el.dataset.tone = 'neutral'; el.textContent = 'No change'; }
  }

  function setBars(a, b, va, vb) {
    var max = Math.max(isNum(va) ? Math.abs(va) : 0, isNum(vb) ? Math.abs(vb) : 0);
    a.style.width = (max > 0 && isNum(va) ? Math.abs(va) / max * 100 : 0) + '%';
    b.style.width = (max > 0 && isNum(vb) ? Math.abs(vb) / max * 100 : 0) + '%';
  }

  // The engine clamps spoilage_reduction_pct and revenue_gain_pct at 0 and uses
  // conventions for zero baselines. If the reported % disagrees with the absolute
  // values it was derived from, show N/A plus an explanation instead of a claim.
  function checkPct(reported, base, opt, higherIsBetter) {
    if (!isNum(reported)) return { value: null, warn: '' };
    if (!isNum(base) || !isNum(opt)) return { value: reported, warn: '' };
    if (base <= 0) {
      return { value: null, warn: 'Baseline is ' + (higherIsBetter ? fmt.inr(base) : fmt.kg(base)) + ', so a percentage is not meaningful. The API reported ' + fmt.pct(reported) + ' by convention.' };
    }
    var implied = higherIsBetter ? (opt - base) / base * 100 : (base - opt) / base * 100;
    if (Math.abs(implied - reported) > 0.6) {
      return { value: null, warn: 'The API reported ' + fmt.pct(reported) + ', but its own values imply ' + fmt.pct(implied) + '. The engine clamps negative changes to 0%, so the reported figure is treated as inconsistent.' };
    }
    return { value: reported, warn: '' };
  }

  function setWarn(el, text) { el.hidden = !text; el.textContent = text || ''; }

  function renderKPIs() {
    var r = state.result;
    var m = r ? r.metrics : readMetrics(null);

    // Card A — Spoilage
    var bk = m.baseline_spoilage_kg, ok = m.optimized_spoilage_kg;
    var a = checkPct(m.spoilage_reduction_pct, bk, ok, false);
    animateNumber(els.kpiSpoilagePct, a.value, fmt.pct);
    setTrend(els.kpiSpoilageTrend, a.value, '↓ Less spoilage', '↑ More spoilage');
    if (!r) els.kpiSpoilageSaved.textContent = 'Run the optimizer to compute.';
    else if (isNum(bk) && isNum(ok)) {
      var saved = bk - ok;
      els.kpiSpoilageSaved.innerHTML = saved >= 0
        ? '<strong>' + esc(fmt.kg(saved)) + '</strong> kept out of spoilage (modelled)'
        : '<strong>' + esc(fmt.kg(-saved)) + '</strong> more spoilage than baseline (modelled)';
    } else els.kpiSpoilageSaved.textContent = 'Kilograms saved: ' + NA;
    els.kpiSpoilageBaseline.textContent = r ? fmt.kg(bk) + (isNum(m.baseline_spoilage_pct) ? ' · ' + fmt.pct(m.baseline_spoilage_pct) : '') : '—';
    els.kpiSpoilageOptimized.textContent = r ? fmt.kg(ok) + (isNum(m.optimized_spoilage_pct) ? ' · ' + fmt.pct(m.optimized_spoilage_pct) : '') : '—';
    setBars(els.kpiSpoilageBaselineBar, els.kpiSpoilageOptimizedBar, bk, ok);
    setWarn(els.kpiSpoilageWarn, a.warn);

    // Card B — Revenue
    var br = m.baseline_net_revenue, orv = m.optimized_net_revenue;
    var b = checkPct(m.revenue_gain_pct, br, orv, true);
    animateNumber(els.kpiRevenuePct, b.value, fmt.pct);
    setTrend(els.kpiRevenueTrend, b.value, '↑ Higher revenue', '↓ Lower revenue');
    if (!r) els.kpiRevenueGain.textContent = 'Run the optimizer to compute.';
    else if (isNum(br) && isNum(orv)) {
      var gain = orv - br;
      els.kpiRevenueGain.innerHTML = gain >= 0
        ? '<strong>' + esc(fmt.inr(gain)) + '</strong> additional net revenue (modelled)'
        : '<strong>' + esc(fmt.inr(-gain)) + '</strong> below baseline (modelled)';
    } else els.kpiRevenueGain.textContent = 'Rupees gained: ' + NA;
    els.kpiRevenueBaseline.textContent = r ? fmt.inrCompact(br) : '—';
    els.kpiRevenueOptimized.textContent = r ? fmt.inrCompact(orv) : '—';
    els.kpiRevenueBaseline.title = fmt.inr(br);
    els.kpiRevenueOptimized.title = fmt.inr(orv);
    setBars(els.kpiRevenueBaselineBar, els.kpiRevenueOptimizedBar, br, orv);
    setWarn(els.kpiRevenueWarn, b.warn);

    // Card C — Demand
    var dp = m.demand_fulfillment_pct;
    animateNumber(els.kpiDemandPct, dp, fmt.pct);
    if (isNum(dp)) {
      var w = Math.max(0, Math.min(100, dp));
      els.kpiDemandBar.style.width = w + '%';
      els.kpiDemandProgress.setAttribute('aria-valuenow', String(Math.round(w * 10) / 10));
      els.kpiDemandProgress.setAttribute('aria-valuetext', fmt.pct(dp));
      els.kpiDemandTrend.dataset.tone = 'neutral';
      els.kpiDemandTrend.textContent = 'As reported';
      els.kpiDemandNote.textContent = 'Share of total destination demand allocated (modelled).';
    } else {
      els.kpiDemandBar.style.width = '0%';
      els.kpiDemandProgress.removeAttribute('aria-valuenow');
      els.kpiDemandProgress.setAttribute('aria-valuetext', 'Not available');
      els.kpiDemandTrend.dataset.tone = 'neutral';
      els.kpiDemandTrend.textContent = r ? 'Not available' : '—';
      els.kpiDemandNote.textContent = r ? 'demand_fulfillment_pct was not returned.' : 'Share of total destination demand allocated.';
    }
  }

  /* ---- Inventory & network context ---- */
  function renderContext() {
    var ctx = state.context;
    var tag = els.contextSourceTag;
    if (!ctx) { tag.dataset.source = 'none'; tag.textContent = 'Not loaded'; return; }
    tag.dataset.source = ctx.source === 'api' ? 'api' : 'mock';
    tag.textContent = ctx.source === 'api' ? 'Live · /api/data · /api/stats' : 'DEMO · copy of repo sample data';

    var data = ctx.data, stats = ctx.stats;
    var errNote = ctx.errors.length ? '<li class="context-empty">' + esc(ctx.errors.join(' · ')) + '</li>' : '';

    // Inventory
    if (stats && isObj(stats.batches)) {
      var sl = isObj(stats.batches.shelf_life_hrs) ? stats.batches.shelf_life_hrs : {};
      els.invSummary.textContent = plural(toNum(stats.batches.count) || 0, 'batch') + ' · ' + fmt.kg(toNum(stats.batches.total_kg)) +
        ' · shelf life ' + fmt.hrs(toNum(sl.min)) + ' min / ' + fmt.hrs(toNum(sl.avg)) + ' avg / ' + fmt.hrs(toNum(sl.max)) + ' max';
    } else els.invSummary.textContent = 'Inventory summary unavailable';
    if (data && Array.isArray(data.batches)) {
      var batches = data.batches.slice().sort(function (x, y) { return (toNum(x.shelf_life_hrs) || 0) - (toNum(y.shelf_life_hrs) || 0); });
      var maxLife = Math.max.apply(null, batches.map(function (b) { return toNum(b.shelf_life_hrs) || 0; }).concat([1]));
      els.batchList.innerHTML = batches.map(function (b) {
        var life = toNum(b.shelf_life_hrs);
        var short = isNum(life) && life < CONFIG.UI_SHORT_SHELF_HRS;
        return '<li class="batch-item"><span class="cell-id">' + esc(toStr(b.batch_id)) + '</span>' +
          '<div><span class="batch-name">' + esc(toStr(b.commodity)) + '<span class="grade" title="Quality grade">' + esc(toStr(b.quality_grade) || '?') + '</span></span>' +
          '<span class="batch-sub">' + esc(fmt.kg(toNum(b.quantity_kg))) + ' · base cost ' + esc(fmt.inrPrice(toNum(b.base_cost_per_kg))) + '/kg</span>' +
          '<span class="life-track"><span class="life-fill" style="width:' + (isNum(life) ? (life / maxLife * 100).toFixed(1) : 0) + '%;' + (short ? 'background:var(--t2)' : '') + '"></span></span></div>' +
          '<span class="life-val"' + (short ? ' style="color:var(--t2)" title="Under ' + CONFIG.UI_SHORT_SHELF_HRS + ' h (display highlight only)"' : '') + '>' + esc(fmt.hrs(life)) + '</span></li>';
      }).join('') + errNote;
    } else els.batchList.innerHTML = '<li class="context-empty">Batch data unavailable.</li>' + errNote;

    // Destinations
    if (stats && isObj(stats.destinations)) {
      var bt = isObj(stats.destinations.by_tier) ? stats.destinations.by_tier : {};
      els.destSummary.textContent = plural(toNum(stats.destinations.count) || 0, 'destination') + ' · ' + fmt.kg(toNum(stats.destinations.total_demand_kg)) + ' total demand · ' +
        TIER_ORDER.map(function (t) { return (toNum(bt[t]) || 0) + ' ' + tierMeta(t).short; }).join(', ');
    } else els.destSummary.textContent = 'Destination summary unavailable';
    if (data && Array.isArray(data.destinations)) {
      els.destList.innerHTML = data.destinations.map(function (d) {
        return '<li class="dest-item"><div><span class="dest-name">' + esc(toStr(d.name)) + '</span>' +
          '<span class="dest-meta">' + esc(toStr(d.dest_id)) + ' · demand ' + esc(fmt.kg(toNum(d.demand_kg))) + ' · ' + esc(fmt.inrPrice(toNum(d.offering_price_per_kg))) + '/kg · min shelf ' + esc(fmt.hrs(toNum(d.min_shelf_life_hrs))) + '</span></div>' +
          tierBadge(toStr(d.tier)) + '</li>';
      }).join('');
    } else els.destList.innerHTML = '<li class="context-empty">Destination data unavailable.</li>';

    // Routes
    if (data && Array.isArray(data.routes)) {
      var hubs = Array.from(new Set(data.routes.map(function (r) { return toStr(r.origin_hub); }).filter(Boolean)));
      els.routeSummary.textContent = plural(stats && isObj(stats.routes) && isNum(toNum(stats.routes.count)) ? toNum(stats.routes.count) : data.routes.length, 'route') + (hubs.length ? ' from ' + hubs.join(', ') : '');
      els.routeList.innerHTML = data.routes.map(function (r) {
        var dn = destName(toStr(r.dest_id));
        return '<li class="route-item"><div><span class="route-name">' + esc(toStr(r.route_id)) + ' → ' + esc(dn || toStr(r.dest_id)) + '</span>' +
          '<span class="route-meta">' + esc(fmt.hrs(toNum(r.transit_time_hrs))) + ' · ' + esc(nf0.format(toNum(r.distance_km) || 0)) + ' km · ' + esc(fmt.inrPrice(toNum(r.transport_cost_per_kg))) + '/kg</span>' +
          '<span class="route-meta">' + esc(toStr(r.vehicle_type) || 'Vehicle not listed') + '</span></div>' +
          '<span class="route-status" data-status="' + esc(toStr(r.status)) + '">' + esc(toStr(r.status) || NA) + '</span></li>';
      }).join('');
    } else {
      els.routeSummary.textContent = 'Route summary unavailable';
      els.routeList.innerHTML = '<li class="context-empty">Route data unavailable.</li>';
    }
  }

  /* ---- Tier distribution ---- */
  function renderTierFlow() {
    var r = state.result;
    if (!r) {
      els.tierTotal.textContent = '—';
      els.tierBar.innerHTML = '';
      els.tierLegend.innerHTML = '<li><div class="tier-legend-val">No result yet.</div></li>';
      return;
    }
    var groups = TIER_ORDER.map(function (t) { return { tier: t, kg: 0, count: 0 }; });
    var other = { tier: null, kg: 0, count: 0 }, spoiledCount = 0;
    r.rows.forEach(function (row) {
      if (row.spoiled) { spoiledCount++; return; }
      var g = groups.filter(function (x) { return x.tier === row.tier; })[0] || other;
      g.count++;
      if (isNum(row.allocated_kg)) g.kg += row.allocated_kg;
    });
    var list = other.count ? groups.concat([other]) : groups;
    var total = list.reduce(function (s, g) { return s + g.kg; }, 0);
    els.tierTotal.textContent = total > 0 ? fmt.kg(total) + ' allocated' : 'No allocated kg';
    els.tierBar.innerHTML = list.map(function (g) {
      var meta = g.tier ? tierMeta(g.tier) : { short: 'Unrecognised tier', tone: 'tone-t0' };
      return '<span class="tier-seg ' + meta.tone + '" data-w="' + (total > 0 ? (g.kg / total * 100).toFixed(3) : 0) + '" title="' + esc(meta.short + ': ' + fmt.kg(g.kg)) + '"></span>';
    }).join('');
    requestAnimationFrame(function () { Array.prototype.forEach.call(els.tierBar.children, function (s) { s.style.width = s.dataset.w + '%'; }); });
    els.tierBar.setAttribute('aria-label', 'Allocated kilograms by tier: ' + list.map(function (g) { return (g.tier ? tierMeta(g.tier).short : 'Unrecognised tier') + ' ' + fmt.kg(g.kg); }).join(', '));

    var items = list.map(function (g) {
      var meta = g.tier ? tierMeta(g.tier) : { short: 'Unrecognised tier', tone: 'tone-t0' };
      return '<li><span class="tier-swatch ' + meta.tone + '" aria-hidden="true"></span><div><div class="tier-legend-name">' + esc(meta.short) + '</div>' +
        '<div class="tier-legend-val">' + esc(fmt.kg(g.kg)) + ' · ' + esc(total > 0 ? fmt.pct(g.kg / total * 100) : NA) + ' · ' + plural(g.count, 'allocation') + '</div></div></li>';
    });
    var spoiledKg = r.metrics.optimized_spoilage_kg;
    if (spoiledCount || (isNum(spoiledKg) && spoiledKg > 0)) {
      items.push('<li><span class="tier-swatch tone-danger" aria-hidden="true"></span><div><div class="tier-legend-name">Not allocated / spoiled</div>' +
        '<div class="tier-legend-val">' + esc(fmt.kg(spoiledKg)) + ' modelled spoilage' + (spoiledCount ? ' · ' + plural(spoiledCount, 'batch') + ' with no feasible destination' : '') + '</div></div></li>');
    }
    els.tierLegend.innerHTML = items.join('');
  }

  /* ---- Allocation table ---- */
  var SORT_TYPES = {
    batch_id: 'text', commodity: 'text', dest_name: 'text', tier: 'tier', allocated_kg: 'num', action: 'text',
    discount_pct: 'num', effective_price_per_kg: 'num', transport_cost_per_kg: 'num', net_profit: 'num', margin_hrs: 'num', status: 'text'
  };

  function rebuildFilterOptions() {
    var rows = state.result ? state.result.rows : [];
    var tierOpts = TIER_ORDER.map(function (t) { return [t, tierMeta(t).short]; });
    if (rows.some(function (r) { return r.spoiled; })) tierOpts.push(['__spoiled', 'Unallocated / spoiled']);
    els.tierFilter.innerHTML = '<option value="">All tiers</option>' + tierOpts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('');
    var statuses = Array.from(new Set(rows.map(function (r) { return r.status; }).filter(Boolean))).sort();
    els.statusFilter.innerHTML = '<option value="">All statuses</option>' + statuses.map(function (s) { return '<option value="' + esc(s) + '">' + esc(fmt.status(s)) + '</option>'; }).join('');
    if (tierOpts.every(function (o) { return o[0] !== state.filters.tier; })) state.filters.tier = '';
    if (statuses.indexOf(state.filters.status) === -1) state.filters.status = '';
    els.tierFilter.value = state.filters.tier;
    els.statusFilter.value = state.filters.status;
  }

  function visibleRows() {
    var rows = state.result ? state.result.rows.slice() : [];
    var q = state.filters.search.trim().toLowerCase(), tf = state.filters.tier, sf = state.filters.status;
    rows = rows.filter(function (r) {
      if (q && ![r.batch_id, r.commodity, r.dest_name, r.dest_id].some(function (f) { return f.toLowerCase().indexOf(q) !== -1; })) return false;
      // Spoiled rows carry a Tier 3 string from the engine but were not delivered anywhere,
      // so they only match the dedicated "Unallocated / spoiled" filter.
      if (tf === '__spoiled' && !r.spoiled) return false;
      if (tf && tf !== '__spoiled' && (r.spoiled || r.tier !== tf)) return false;
      if (sf && r.status !== sf) return false;
      return true;
    });
    var key = state.sort.key;
    if (key) {
      var type = SORT_TYPES[key], dir = state.sort.dir === 'asc' ? 1 : -1;
      rows.sort(function (a, b) {
        var va = a[key], vb = b[key];
        if (type === 'tier') { va = a.spoiled ? 10 : (a.tier ? tierMeta(a.tier).rank : null); vb = b.spoiled ? 10 : (b.tier ? tierMeta(b.tier).rank : null); }
        var na = va === null || va === '', nb = vb === null || vb === '';
        if (na && nb) return a.idx - b.idx;
        if (na) return 1;
        if (nb) return -1;
        var c = type === 'text' ? String(va).localeCompare(String(vb), 'en-IN', { numeric: true, sensitivity: 'base' }) : va - vb;
        return c !== 0 ? c * dir : a.idx - b.idx;
      });
    }
    return rows;
  }

  function cell(v) { return v ? esc(v) : '<span class="cell-muted">' + NA + '</span>'; }
  function numCell(v, f) { return isNum(v) ? esc(f(v)) : '<span class="cell-muted">' + NA + '</span>'; }
  function tierBadge(t) {
    if (!t) return '<span class="badge no-dot">' + NA + '</span>';
    var m = tierMeta(t);
    return '<span class="badge ' + m.tone + '" title="' + esc(t) + '">' + esc(m.short) + '</span>';
  }
  function rowTierBadge(r) { return r.spoiled ? '<span class="badge tone-danger" title="Contract tier value: ' + esc(r.tier || NA) + '">Unallocated</span>' : tierBadge(r.tier); }
  function statusBadge(s) { return s ? '<span class="badge ' + (STATUS_TONE[s] || '') + '">' + esc(fmt.status(s)) + '</span>' : '<span class="badge no-dot">' + NA + '</span>'; }
  function actionChip(r) { return r.action ? '<span class="chip' + (r.spoiled ? ' cell-danger' : '') + '">' + esc(fmt.action(r.action)) + '</span>' : '<span class="cell-muted">' + NA + '</span>'; }

  function rowHTML(r, i, fresh, shortfall) {
    var res = state.result;
    var ch = res.changes && res.changes.get(r.batch_id);
    var sf = !r.spoiled && shortfall && shortfall.get(r.batch_id);
    var profitCls = isNum(r.net_profit) && !r.spoiled ? (r.net_profit < 0 ? 'profit-neg' : 'profit-pos') : 'cell-muted';
    var marginCls = r.spoiled ? 'cell-muted' : (isNum(r.margin_hrs) && r.margin_hrs <= CONFIG.UI_LOW_MARGIN_HRS ? 'margin-low' : '');
    var label = 'Why this allocation? ' + (r.batch_id || 'Row ' + (r.idx + 1)) + (r.dest_name ? ' to ' + r.dest_name : '');
    var dest = r.spoiled
      ? '<span class="cell-danger">No feasible destination</span><span class="cell-sub">' + esc(r.dest_name || '') + (r.dest_id ? ' · ' + esc(r.dest_id) : '') + '</span>'
      : cell(r.dest_name) + (r.dest_id ? '<span class="cell-sub mono">' + esc(r.dest_id) + '</span>' : '');
    return '<tr data-idx="' + r.idx + '" class="' + (fresh ? 'row-enter ' : '') + (r.spoiled ? 'is-spoiled ' : '') + (state.drawerIdx === r.idx ? 'is-selected' : '') + '" style="--r:' + Math.min(i, 14) + '">' +
      '<td class="col-sticky"><span class="cell-id">' + cell(r.batch_id) + '</span>' +
        (ch && ch.rerouted ? '<span class="chip chip-flag" title="Destination differs from the previous plan">REROUTED</span>' : '') +
        (ch && ch.becameSpoiled ? '<span class="chip chip-flag is-danger" title="Allocated in the previous plan, spoiled now">NEW SPOILAGE</span>' : '') +
        (sf ? '<span class="chip-shortfall" title="Derived: batch quantity_kg minus allocated_kg; counted as spoilage in the metrics" style="display:block">' + esc(fmt.kg(sf.gap)) + ' not allocated</span>' : '') + '</td>' +
      '<td class="cell-wrap">' + cell(r.commodity) + '</td>' +
      '<td class="cell-wrap">' + dest + '</td>' +
      '<td>' + rowTierBadge(r) + '</td>' +
      '<td class="num-col">' + numCell(r.allocated_kg, fmt.kg) + '</td>' +
      '<td>' + actionChip(r) + '</td>' +
      '<td class="num-col col-secondary' + (r.discount_pct === 0 ? ' cell-muted' : '') + '">' + numCell(r.discount_pct, fmt.pctLoose) + '</td>' +
      '<td class="num-col col-secondary' + (r.spoiled ? ' cell-muted' : '') + '">' + numCell(r.effective_price_per_kg, fmt.inrPrice) + '</td>' +
      '<td class="num-col col-secondary' + (r.spoiled ? ' cell-muted' : '') + '">' + numCell(r.transport_cost_per_kg, fmt.inrPrice) + '</td>' +
      '<td class="num-col"><span class="' + profitCls + '">' + numCell(r.net_profit, fmt.inr) + '</span></td>' +
      '<td class="num-col"><span class="' + marginCls + '">' + (r.spoiled ? '—' : numCell(r.margin_hrs, fmt.hrs)) + '</span>' +
        (ch && ch.marginDelta !== null ? '<span class="delta' + (ch.marginDelta > 0 ? ' is-good' : '') + '" title="Change vs previous plan">' + esc(fmt.signedHrs(ch.marginDelta)) + '</span>' : '') + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td class="col-why"><button type="button" class="why-btn" data-why="' + r.idx + '" aria-label="' + esc(label) + '">Why?</button></td>' +
      '</tr>';
  }

  function renderTable(fresh) {
    var r = state.result;
    var all = r ? r.rows : [];
    var rows = visibleRows();
    var hasFilters = !!(state.filters.search.trim() || state.filters.tier || state.filters.status);

    els.tableEmpty.hidden = all.length !== 0;
    els.tableNoResults.hidden = !(all.length && !rows.length);
    if (!r) {
      els.tableEmptyTitle.textContent = 'No plan yet';
      els.tableEmptyText.textContent = state.api.reach === 'ok'
        ? 'Backend connected. Press “Run Cascade Optimization” to fetch a plan from ' + endpointLabel('optimize') + '.'
        : 'Press “Run Cascade Optimization” — the live API is used when reachable, otherwise the labelled local demo.';
    } else if (!all.length) {
      els.tableEmptyTitle.textContent = 'No allocations returned';
      els.tableEmptyText.textContent = 'The response contained an empty allocations array.';
    }
    var sf = r ? shortfallMap(r) : null;
    els.allocBody.innerHTML = rows.map(function (row, i) { return rowHTML(row, i, fresh, sf); }).join('');
    els.allocTable.hidden = rows.length === 0;

    var spoiledN = all.filter(function (x) { return x.spoiled; }).length;
    var changed = r && r.changes ? Array.from(r.changes.values()).filter(function (c) { return c.rerouted || c.becameSpoiled; }).length : 0;
    els.resultCount.textContent = !r ? 'No result yet'
      : (hasFilters ? 'Showing ' + rows.length + ' of ' : '') + plural(all.length, 'allocation') +
        (spoiledN ? ' · ' + spoiledN + ' spoiled' : '') + (changed ? ' · ' + changed + ' changed vs previous plan' : '');

    Array.prototype.forEach.call(els.allocTable.querySelectorAll('thead th[data-key]'), function (th) {
      if (th.dataset.key === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  function onSortClick(key) {
    if (state.sort.key !== key) state.sort = { key: key, dir: 'asc' };
    else if (state.sort.dir === 'asc') state.sort = { key: key, dir: 'desc' };
    else state.sort = { key: null, dir: 'asc' };
    renderTable(false);
  }

  /* ===================================================================
     10. Charts (Chart.js with accessible table fallback)
     =================================================================== */
  function chartsAvailable() { return typeof window.Chart === 'function' && !state.chartsFailed; }

  function fallbackTable(caption, labels, values, f) {
    return '<table class="mini-table"><caption>' + esc(caption) + '</caption><thead><tr><th scope="col">Scenario</th><th scope="col">Value</th></tr></thead><tbody>' +
      labels.map(function (l, i) { return '<tr><th scope="row">' + esc(l) + '</th><td>' + esc(f(values[i])) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function barConfig(labels, data, colors, tickFmt, tipFmt) {
    var text2 = cssVar('--text-2', '#a7b4ae');
    return {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: labels.join(' vs '), data: data, backgroundColor: colors.map(function (c) { return c.fill; }), borderColor: colors.map(function (c) { return c.line; }), borderWidth: 1, borderRadius: 10, borderSkipped: false, maxBarThickness: 84 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 700, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            position: 'bottom', onClick: function () {},
            labels: {
              color: text2, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 16,
              generateLabels: function (chart) {
                var ds = chart.data.datasets[0];
                return chart.data.labels.map(function (l, i) { return { text: l + ': ' + tipFmt(ds.data[i]), fillStyle: ds.backgroundColor[i], strokeStyle: ds.borderColor[i], lineWidth: 1, hidden: false, index: i, fontColor: text2, pointStyle: 'rectRounded' }; });
              }
            }
          },
          tooltip: { backgroundColor: '#0f1412', borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, padding: 10, displayColors: false, callbacks: { label: function (ctx) { return tipFmt(ctx.raw); } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: text2 }, border: { color: 'rgba(255,255,255,0.08)' } },
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false }, ticks: { color: cssVar('--text-3', '#808d87'), maxTicksLimit: 6, callback: function (v) { return tickFmt(v); } } }
        }
      }
    };
  }

  function renderOneChart(key, canvas, fallbackEl, noteEl, cfg) {
    var labels = ['Conventional baseline', 'CASCADE SALVAGE'];
    fallbackEl.innerHTML = fallbackTable(cfg.caption, labels, cfg.values, cfg.tipFmt);
    var missing = state.result && cfg.values.some(function (v) { return !isNum(v); });
    noteEl.textContent = missing ? 'One or more values were not returned and are shown as N/A.' : '';
    canvas.setAttribute('aria-label', cfg.caption + ': ' + labels.map(function (l, i) { return l + ' ' + cfg.tipFmt(cfg.values[i]); }).join(', '));
    if (!chartsAvailable()) {
      canvas.parentElement.classList.add('is-hidden');
      fallbackEl.classList.toggle('is-visible', !!state.result);
      return;
    }
    var data = cfg.values.map(function (v) { return isNum(v) ? v : null; });
    try {
      var chart = state.charts[key];
      if (!chart) state.charts[key] = new window.Chart(canvas, barConfig(labels, data, cfg.colors, cfg.tickFmt, cfg.tipFmt));
      else {
        chart.data.datasets[0].data = data;
        chart.options.animation = cfg.fresh && !reducedMotion() ? { duration: 700, easing: 'easeOutQuart' } : false;
        chart.update();
      }
      canvas.parentElement.classList.remove('is-hidden');
      fallbackEl.classList.remove('is-visible');
    } catch (e) {
      console.warn('Chart rendering failed; showing table fallback.', e);
      state.chartsFailed = true;
      canvas.parentElement.classList.add('is-hidden');
      fallbackEl.classList.add('is-visible');
    }
  }

  function renderCharts(fresh) {
    var m = state.result ? state.result.metrics : readMetrics(null);
    var muted = { fill: 'rgba(124,138,132,0.55)', line: 'rgba(124,138,132,0.9)' };
    var green = { fill: 'rgba(52,211,153,0.78)', line: 'rgba(52,211,153,1)' };
    if (chartsAvailable()) { window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; window.Chart.defaults.font.size = 12; }

    renderOneChart('spoilage', els.spoilageChart, els.spoilageFallback, els.spoilageNote, {
      caption: 'Modelled spoilage (kg), baseline vs CASCADE SALVAGE', values: [m.baseline_spoilage_kg, m.optimized_spoilage_kg],
      colors: [muted, green], tickFmt: function (v) { return nf0.format(v) + ' kg'; }, tipFmt: fmt.kg, fresh: fresh
    });
    renderOneChart('revenue', els.revenueChart, els.revenueFallback, els.revenueNote, {
      caption: 'Modelled net revenue (INR), baseline vs CASCADE SALVAGE', values: [m.baseline_net_revenue, m.optimized_net_revenue],
      colors: [muted, green], tickFmt: fmt.inrCompact, tipFmt: fmt.inr, fresh: fresh
    });

    var a = checkPct(m.spoilage_reduction_pct, m.baseline_spoilage_kg, m.optimized_spoilage_kg, false).value;
    var b = checkPct(m.revenue_gain_pct, m.baseline_net_revenue, m.optimized_net_revenue, true).value;
    setDelta(els.spoilageDelta, a, function (v) { return v > 0 ? fmt.pct(v) + ' less' : v < 0 ? fmt.pct(-v) + ' more' : 'No change'; });
    setDelta(els.revenueDelta, b, function (v) { return (v > 0 ? '+' : '') + fmt.pct(v); });
  }

  function setDelta(el, v, f) {
    if (!state.result) { el.dataset.tone = 'neutral'; el.textContent = '—'; return; }
    el.dataset.tone = !isNum(v) ? 'neutral' : v > 0 ? 'good' : v < 0 ? 'bad' : 'neutral';
    el.textContent = isNum(v) ? f(v) : 'Change: N/A';
  }

  /* ===================================================================
     11. Drawer — "Why this allocation?"
     =================================================================== */
  function kv(label, value, wide) {
    var na = value === NA || value === '' || value == null;
    return '<div class="kv' + (wide ? ' kv-wide' : '') + '"><dt>' + esc(label) + '</dt><dd class="' + (na ? 'is-na' : '') + '">' + esc(na ? NA : value) + '</dd></div>';
  }

  function findIn(list, key, val) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i][key] === val) return list[i];
    return null;
  }

  function drawerHTML(r) {
    var res = state.result;
    var ch = res.changes && res.changes.get(r.batch_id);
    var sf = shortfallMap(res);
    var gap = !r.spoiled && sf && sf.get(r.batch_id);
    var h = '';

    h += '<div class="route-card' + (r.spoiled ? ' is-spoiled' : '') + '">' +
      '<div class="route-node"><span class="route-label">Batch</span><strong class="mono">' + cell(r.batch_id) + '</strong><span class="cell-sub">' + cell(r.commodity) + '</span></div>' +
      '<div class="route-arrow" aria-hidden="true">' + esc(fmt.kg(r.allocated_kg)) + '</div>' +
      '<div class="route-node"><span class="route-label">Destination</span><strong>' + (r.spoiled ? 'No feasible destination' : cell(r.dest_name)) + '</strong><span class="cell-sub mono">' + cell(r.dest_id) + '</span></div></div>';

    h += '<div class="drawer-badges">' + rowTierBadge(r) + statusBadge(r.status) + actionChip(r) +
      (ch && ch.rerouted ? '<span class="chip chip-flag">REROUTED</span>' : '') + (ch && ch.becameSpoiled ? '<span class="chip chip-flag is-danger">NEW SPOILAGE</span>' : '') + '</div>';

    if (r.malformed) h += '<div class="warn-note">This allocation entry was not a valid object in the response. Fields are shown as N/A.</div>';
    if (r.spoiled) h += '<div class="warn-note">The engine found no destination that this batch could reach within its shelf-life requirements. It is recorded as spoilage, not as a saved allocation.</div>';

    h += '<dl class="kv-grid">' +
      kv('Quantity allocated', fmt.kg(r.allocated_kg)) +
      kv('Action', r.action ? fmt.action(r.action) + ' (' + r.action + ')' : NA) +
      kv('Discount', isNum(r.discount_pct) ? (r.discount_pct === 0 ? 'None (0%)' : fmt.pctLoose(r.discount_pct)) : NA) +
      kv('Effective price / kg', fmt.inrPrice(r.effective_price_per_kg)) +
      kv('Transport cost / kg', fmt.inrPrice(r.transport_cost_per_kg)) +
      kv('Net profit (as returned)', fmt.inr(r.net_profit)) +
      kv('Shelf-life margin', fmt.hrs(r.margin_hrs)) +
      kv('Status', r.status || NA) +
      kv('Tier (contract value)', r.tier || NA, true) +
      '</dl>';

    if (gap) h += '<div class="change-note"><strong>' + esc(fmt.kg(gap.gap)) + ' of this ' + esc(fmt.kg(gap.qty)) + ' batch was not allocated.</strong> Derived from batch <code>quantity_kg</code> minus <code>allocated_kg</code>; the engine counts it in <code>optimized_spoilage_kg</code>.</div>';
    if (ch && (ch.rerouted || ch.becameSpoiled)) h += '<div class="change-note"><strong>Changed in this scenario.</strong> In the previous plan this batch went to ' + esc(ch.prevDests.join(', ') || NA) + '.</div>';
    if (ch && ch.marginDelta !== null) h += '<div class="change-note">Shelf-life margin changed by <strong>' + esc(fmt.signedHrs(ch.marginDelta)) + '</strong> versus the previous plan.</div>';

    // Supporting facts from the dataset (only when it is the same dataset as the result)
    var ctxOk = (res.source === 'mock') || (res.source === 'optimizer' && state.context && state.context.source === 'api');
    var data = res.source === 'mock' ? DEMO.data : (state.context && state.context.data);
    if (ctxOk && data) {
      var b = findIn(data.batches, 'batch_id', r.batch_id);
      var d = r.spoiled ? null : findIn(data.destinations, 'dest_id', r.dest_id);
      var rt = r.spoiled ? null : findIn(data.routes, 'dest_id', r.dest_id);
      if (b || d || rt) {
        h += '<section aria-labelledby="factsTitle"><h3 id="factsTitle" class="drawer-section-title">Inputs from ' + (res.source === 'mock' ? 'demo copy of data/*.json' : esc(endpointLabel('data'))) + '</h3><dl class="kv-grid" style="margin-top:10px">' +
          (b ? kv('Batch shelf life', fmt.hrs(toNum(b.shelf_life_hrs))) + kv('Quality grade', toStr(b.quality_grade)) + kv('Batch quantity', fmt.kg(toNum(b.quantity_kg))) + kv('Base cost / kg', fmt.inrPrice(toNum(b.base_cost_per_kg))) : '') +
          (d ? kv('Destination min shelf life', fmt.hrs(toNum(d.min_shelf_life_hrs))) + kv('Destination demand', fmt.kg(toNum(d.demand_kg))) : '') +
          (rt ? kv('Route transit (server now)', fmt.hrs(toNum(rt.transit_time_hrs))) + kv('Vehicle', toStr(rt.vehicle_type)) : '') +
          '</dl></section>';
      }
    }

    var srcText = res.source === 'mock' ? 'Local demo snapshot — illustrative, not a live API response'
      : res.source === 'api_fallback' ? 'Backend built-in fallback text — not optimizer output'
      : 'Returned verbatim by ' + endpointLabel(res.endpointKey);
    h += '<section aria-labelledby="reasoningTitle"><h3 id="reasoningTitle" class="drawer-section-title">Engine reasoning</h3><p class="reasoning-source">' + esc(srcText) + '</p>' +
      (r.reasoning.trim()
        ? '<p class="reasoning-text' + (res.source === 'mock' ? ' is-mock' : res.source === 'api_fallback' ? ' is-fallback' : '') + '">' + esc(r.reasoning) + '</p>'
        : '<p class="reasoning-empty">No reasoning supplied by the API.</p>') + '</section>';
    h += '<p class="drawer-foot">Net profit is shown as returned: <code>allocated_kg × (effective_price_per_kg − transport_cost_per_kg)</code>. It does not deduct the batch’s base cost.</p>';
    return h;
  }

  function openDrawer(idx, trigger) {
    var row = state.result && state.result.rows[idx];
    if (!row) return;
    state.drawerIdx = idx;
    state.lastFocus = trigger || document.activeElement;
    els.drawerSubtitle.textContent = (row.batch_id || 'Row ' + (idx + 1)) + ' · ' + (row.commodity || NA) + ' → ' + (row.spoiled ? 'no feasible destination' : (row.dest_name || NA));
    els.drawerBody.innerHTML = drawerHTML(row);
    els.drawerBody.scrollTop = 0;
    Array.prototype.forEach.call(els.allocBody.querySelectorAll('tr.is-selected'), function (tr) { tr.classList.remove('is-selected'); });
    var tr = els.allocBody.querySelector('tr[data-idx="' + idx + '"]');
    if (tr) tr.classList.add('is-selected');
    if (els.drawer.hidden) {
      els.drawer.hidden = false;
      els.backdrop.hidden = false;
      document.body.classList.add('drawer-open');
      void els.drawer.offsetWidth;
      els.drawer.classList.add('is-open');
      els.backdrop.classList.add('is-open');
    }
    els.drawerClose.focus({ preventScroll: true });
  }

  function closeDrawer(opts) {
    if (els.drawer.hidden) { state.drawerIdx = null; return; }
    var restore = !opts || opts.restoreFocus !== false;
    state.drawerIdx = null;
    els.drawer.classList.remove('is-open');
    els.backdrop.classList.remove('is-open');
    document.body.classList.remove('drawer-open');
    Array.prototype.forEach.call(els.allocBody.querySelectorAll('tr.is-selected'), function (tr) { tr.classList.remove('is-selected'); });
    setTimeout(function () {
      if (els.drawer.classList.contains('is-open')) return;
      els.drawer.hidden = true;
      els.backdrop.hidden = true;
    }, reducedMotion() ? 0 : 400);
    if (restore && state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus({ preventScroll: true });
    state.lastFocus = null;
  }

  function trapFocus(e) {
    if (e.key !== 'Tab' || els.drawer.hidden) return;
    var f = els.drawer.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ===================================================================
     12. Toasts (textContent only — backend strings are never HTML)
     =================================================================== */
  function toast(o) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.dataset.tone = o.tone || 'info';
    t.setAttribute('role', o.tone === 'error' ? 'alert' : 'status');
    var dot = document.createElement('span'); dot.className = 'toast-dot'; dot.setAttribute('aria-hidden', 'true');
    var body = document.createElement('div');
    var title = document.createElement('div'); title.className = 'toast-title'; title.textContent = o.title || '';
    body.appendChild(title);
    if (o.message) { var msg = document.createElement('div'); msg.className = 'toast-msg'; msg.textContent = o.message; body.appendChild(msg); }
    var dismiss = function () {
      if (t._gone) return;
      t._gone = true; clearTimeout(t._timer); t.classList.add('is-leaving');
      setTimeout(function () { t.remove(); }, reducedMotion() ? 0 : 220);
    };
    if (o.actions && o.actions.length) {
      var acts = document.createElement('div'); acts.className = 'toast-actions';
      o.actions.forEach(function (a) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'toast-action'; b.textContent = a.label;
        b.addEventListener('click', function () { dismiss(); a.run(); });
        acts.appendChild(b);
      });
      body.appendChild(acts);
    }
    var close = document.createElement('button');
    close.type = 'button'; close.className = 'toast-close'; close.setAttribute('aria-label', 'Dismiss notification'); close.textContent = '×';
    close.addEventListener('click', dismiss);
    t.appendChild(dot); t.appendChild(body); t.appendChild(close);
    els.toastRegion.appendChild(t);
    while (els.toastRegion.children.length > 3) els.toastRegion.firstElementChild.remove();
    var ms = o.timeout || 5000;
    var arm = function () { t._timer = setTimeout(dismiss, ms); };
    t.addEventListener('mouseenter', function () { clearTimeout(t._timer); });
    t.addEventListener('mouseleave', arm);
    t.addEventListener('focusin', function () { clearTimeout(t._timer); });
    arm();
  }

  /* ===================================================================
     13. Busy state, boot & events
     =================================================================== */
  function setActionsDisabled(disabled) { [els.runBtn, els.jamBtn, els.demoBtn].forEach(function (b) { b.disabled = disabled; }); }

  function setBusy(kind, busy) {
    var btn = kind === 'disruption' ? els.jamBtn : els.runBtn;
    setActionsDisabled(busy);
    els.reconnectBtn.disabled = busy;
    btn.classList.toggle('is-loading', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    var label = btn.querySelector('.btn-label');
    if (!label.dataset.idle) label.dataset.idle = label.textContent;
    label.textContent = busy ? btn.dataset.busyLabel : label.dataset.idle;
    clearTimeout(state.slowTimer);
    els.statusLine.textContent = busy ? (kind === 'disruption' ? 'Running disruption scenario…' : 'Running cascade optimization…') : '';
    if (busy) {
      state.slowTimer = setTimeout(function () {
        if (state.pending) els.statusLine.textContent = 'Still waiting on the backend… press Reset to cancel.';
      }, CONFIG.SLOW_NOTICE_MS);
    }
  }

  function cacheElements() {
    var ids = {
      apiStatus: 'apiStatus', apiStatusLabel: 'apiStatusLabel', lastUpdated: 'lastUpdated', reconnectBtn: 'reconnectBtn',
      sourceBanner: 'sourceBanner', runBtn: 'runOptimizeBtn', jamBtn: 'simulateJamBtn', jamLabel: 'simulateJamLabel', resetBtn: 'resetBtn', demoBtn: 'demoBtn',
      runMeta: 'runMeta', statusLine: 'statusLine', disruptionPanel: 'disruptionPanel', resultSourceTag: 'resultSourceTag',
      kpiSpoilagePct: 'kpiSpoilagePct', kpiSpoilageTrend: 'kpiSpoilageTrend', kpiSpoilageSaved: 'kpiSpoilageSaved',
      kpiSpoilageBaseline: 'kpiSpoilageBaseline', kpiSpoilageOptimized: 'kpiSpoilageOptimized',
      kpiSpoilageBaselineBar: 'kpiSpoilageBaselineBar', kpiSpoilageOptimizedBar: 'kpiSpoilageOptimizedBar', kpiSpoilageWarn: 'kpiSpoilageWarn',
      kpiRevenuePct: 'kpiRevenuePct', kpiRevenueTrend: 'kpiRevenueTrend', kpiRevenueGain: 'kpiRevenueGain',
      kpiRevenueBaseline: 'kpiRevenueBaseline', kpiRevenueOptimized: 'kpiRevenueOptimized',
      kpiRevenueBaselineBar: 'kpiRevenueBaselineBar', kpiRevenueOptimizedBar: 'kpiRevenueOptimizedBar', kpiRevenueWarn: 'kpiRevenueWarn',
      kpiDemandPct: 'kpiDemandPct', kpiDemandTrend: 'kpiDemandTrend', kpiDemandNote: 'kpiDemandNote', kpiDemandProgress: 'kpiDemandProgress', kpiDemandBar: 'kpiDemandBar',
      contextSourceTag: 'contextSourceTag', invSummary: 'invSummary', batchList: 'batchList', destSummary: 'destSummary', destList: 'destList', routeSummary: 'routeSummary', routeList: 'routeList',
      spoilageChart: 'spoilageChart', spoilageFallback: 'spoilageFallback', spoilageNote: 'spoilageNote', spoilageDelta: 'spoilageDelta',
      revenueChart: 'revenueChart', revenueFallback: 'revenueFallback', revenueNote: 'revenueNote', revenueDelta: 'revenueDelta',
      tierBar: 'tierBar', tierLegend: 'tierLegend', tierTotal: 'tierTotal',
      searchInput: 'searchInput', tierFilter: 'tierFilter', statusFilter: 'statusFilter', resultCount: 'resultCount',
      allocTable: 'allocTable', allocBody: 'allocBody', tableEmpty: 'tableEmpty', tableEmptyTitle: 'tableEmptyTitle', tableEmptyText: 'tableEmptyText',
      tableNoResults: 'tableNoResults', clearFiltersBtn: 'clearFiltersBtn',
      drawer: 'drawer', backdrop: 'drawerBackdrop', drawerClose: 'drawerClose', drawerBody: 'drawerBody', drawerSubtitle: 'drawerSubtitle',
      toastRegion: 'toastRegion'
    };
    Object.keys(ids).forEach(function (k) {
      els[k] = document.getElementById(ids[k]);
      if (!els[k]) throw new Error('Missing element #' + ids[k]);
    });
  }

  function wireEvents() {
    els.runBtn.addEventListener('click', function () { runScenario('optimize'); });
    els.jamBtn.addEventListener('click', function () { runScenario('disruption'); });
    els.resetBtn.addEventListener('click', resetView);
    els.demoBtn.addEventListener('click', function () { showDemo('optimize', 'user'); });
    els.reconnectBtn.addEventListener('click', function () { connect(); });

    els.sourceBanner.addEventListener('click', function (e) {
      var b = e.target.closest('[data-banner-action]');
      if (!b) return;
      var a = b.dataset.bannerAction;
      if (a === 'retry') runScenario(state.runError ? state.runError.kind : 'optimize');
      else if (a === 'demo') showDemo(state.runError ? state.runError.kind : 'optimize', 'user');
      else if (a === 'reconnect') connect();
    });

    var searchTimer = null;
    els.searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.filters.search = els.searchInput.value; renderTable(false); }, 120);
    });
    els.tierFilter.addEventListener('change', function () { state.filters.tier = els.tierFilter.value; renderTable(false); });
    els.statusFilter.addEventListener('change', function () { state.filters.status = els.statusFilter.value; renderTable(false); });
    els.clearFiltersBtn.addEventListener('click', function () {
      state.filters = { search: '', tier: '', status: '' };
      els.searchInput.value = ''; els.tierFilter.value = ''; els.statusFilter.value = '';
      renderTable(false);
      els.searchInput.focus();
    });

    els.allocTable.querySelector('thead').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sort]');
      if (b && state.result) onSortClick(b.dataset.sort);
    });
    els.allocBody.addEventListener('click', function (e) {
      var why = e.target.closest('[data-why]');
      if (why) { openDrawer(Number(why.dataset.why), why); return; }
      var tr = e.target.closest('tr[data-idx]');
      if (tr) openDrawer(Number(tr.dataset.idx), tr.querySelector('[data-why]'));
    });

    els.drawerClose.addEventListener('click', function () { closeDrawer(); });
    els.backdrop.addEventListener('click', function () { closeDrawer(); });
    els.drawer.addEventListener('keydown', trapFocus);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.drawer.hidden) { e.preventDefault(); closeDrawer(); return; }
      var tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !e.metaKey && !e.ctrlKey && els.drawer.hidden) {
        e.preventDefault(); els.searchInput.focus();
      }
    });

    window.addEventListener('offline', function () {
      if (RUNTIME.forceMock) return;
      state.api.reach = 'down';
      renderApiStatus();
      toast({ tone: 'warning', title: 'You are offline', message: 'API requests will fail until the connection returns.' });
    });
  }

  function boot() {
    try { cacheElements(); }
    catch (e) { console.error('[CASCADE SALVAGE] ' + e.message); return; }
    els.jamLabel.textContent = RUNTIME.disruptionLabel;
    wireEvents();
    rebuildFilterOptions();

    if (!DEMO) { console.error('[CASCADE SALVAGE] Demo bundle missing.'); }
    if (RUNTIME.forceMock) {
      state.api.reach = 'down';
      state.api.forced = true;
      useDemoContext();
      applyResult(makeDemoResult('optimize', 'forced'));
      return;
    }
    renderAll({ fresh: false });
    connect({ boot: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
