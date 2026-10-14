# Cascade Salvage — 3-Minute Demo Script
## Where Every Harvest Outruns Its Expiry.

**Format:** 3-minute hackathon pitch video  
**Target runtime:** 3:00 exactly  
**Style:** Fast, visual, evidence-led  
**Important production note:** The MoFPI study reference and all dashboard numbers must be verified before recording. Use the live system's actual outputs; do not present illustrative sample metrics as measured results.

---

## 0:00–0:45 — The Problem & MoFPI Context

| Time | Visual / action | Spoken script |
|---|---|---|
| **0:00–0:06** | Start with close-up footage or images of fresh produce at a market. Cut to produce being discarded. On-screen title: **CASCADE SALVAGE**. | “A tomato does not become worthless the moment one supermarket says no. But in a time-sensitive supply chain, that missed sale can be the beginning of food waste.” |
| **0:06–0:16** | Show a simple route: farm → hub → retailer. Add warning icons for demand mismatch, short shelf life, and traffic. | “Perishable produce loses value when demand is uncertain, shelf life is short, or transport is delayed. Traditional distribution can miss the next-best buyer while time keeps running out.” |
| **0:16–0:29** | Show the words **54 commodities · 15 agro-climatic zones** over an India map or produce collage. Add a small source label: **MoFPI-related post-harvest loss study**. | “India's Ministry of Food Processing Industries has supported post-harvest loss research covering 54 commodities across 15 agro-climatic zones. The lesson is clear: losses vary by crop and region, so one-size-fits-all decisions are not enough.” |
| **0:29–0:45** | Reveal the three tiers as three connected cards: Premium Retail → Rapid Mandi → Processing & Salvage. | “We built Cascade Salvage: a shelf-life-aware decision-support system that finds the most valuable feasible destination for each batch—premium retail first when it fits, rapid distribution when time is tight, and eligible processing when retail is no longer the right option.” |

**On-screen text:** “Don't stop at the first rejection. Find the next feasible destination.”

---

## 0:45–1:45 — Live Dashboard & Three-Tier Allocation

| Time | Visual / action | Spoken script |
|---|---|---|
| **0:45–0:52** | Switch to the live dashboard. Keep the cursor steady. Show inventory, destinations, and current status. | “Here is the live Cascade Salvage dashboard. It starts with batch quantity, quality grade, remaining shelf life, destination demand, price, and transport information.” |
| **0:52–1:02** | Select a batch with limited shelf life. Zoom in on its shelf-life field and destination options. | “A high price is not enough. A destination must have demand, and the batch must be able to arrive within its usable shelf life and meet the destination's acceptance rules.” |
| **1:02–1:15** | Click **Optimize**. Show the allocation table filling in. Highlight the tier, quantity, margin, and reasoning fields if available. | “The engine checks feasibility, ranks suitable destinations, and allocates inventory while respecting batch quantities and destination demand. If one destination cannot take the full batch, the remaining quantity should be considered for other feasible destinations.” |
| **1:15–1:30** | Highlight examples from each tier. Use labels: **Tier 1 — Premium Retail**, **Tier 2 — Rapid Mandi**, **Tier 3 — Processing Plant**. | “Grade-eligible, sufficiently fresh produce can go to premium retail. Time-sensitive stock can move to rapid markets, potentially with a discount. Produce unsuitable for conventional retail can be considered for processing—only when it meets the processor's requirements and food-safety criteria.” |
| **1:30–1:45** | Show the scorecard: baseline versus optimized. Pause on spoilage/unallocated quantity, demand fulfillment, transport cost, and economic value. | “The scorecard compares the baseline with the optimized plan. We report the actual scenario results for unallocated quantity, fulfillment, and economic value, using the same inventory and clearly defined metric formulas.” |

**Recording cue:** Before filming, confirm the live API is connected and the dashboard is not showing mock/fallback data. Use only values produced by the recorded run.

---

## 1:45–2:30 — Live Highway Jam & Instant Re-Routing

| Time | Visual / action | Spoken script |
|---|---|---|
| **1:45–1:52** | Return to the route view. Add a red banner: **SIMULATED HIGHWAY JAM — +6 HOURS**. | “But supply chains do not stay still. Let's introduce a six-hour highway jam on an affected route.” |
| **1:52–2:02** | Open the disruption controls. Select the affected destination or route and enter the delay. Click **Simulate**. | “Cascade applies the disruption to a separate scenario, so our original baseline remains intact. It then recalculates arrival feasibility and runs the allocation process again.” |
| **2:02–2:15** | Show the changed route time and revised allocation. Use a before/after split screen. | “A route that was feasible before may now leave too little usable shelf life. Instead of blindly keeping the original plan, the system looks for other destinations that remain feasible.” |
| **2:15–2:30** | Highlight one actual changed allocation and its explanation. Show the updated scorecard. | “Here is the revised plan. The important result is not simply that a delay was detected—it is that the system explains what changed, which inventory is affected, and what recovery options remain. If no safe, feasible option exists, it must report that honestly.” |

**Recording cue:** Run the disruption test immediately before recording. Verify the route data returns to its original state when the scenario ends. Do not claim “instant” response unless the measured demo supports it.

---

## 2:30–3:00 — Economic Proof Scorecard & Closing

| Time | Visual / action | Spoken script |
|---|---|---|
| **2:30–2:39** | Full-screen scorecard. Show baseline and optimized results from the same run. Keep labels and units visible. | “Our proof is the comparison: how much inventory found a feasible destination, how much demand was fulfilled, what transport cost was incurred, and what economic value was recovered.” |
| **2:39–2:48** | Animate a batch moving through the three tiers. On-screen words: **Feasibility · Recovery · Re-planning**. | “Cascade Salvage brings those decisions into one transparent workflow: match the batch, test the route, cascade to the next feasible buyer, and re-plan when conditions change.” |
| **2:48–3:00** | Team/project logo, project name, tagline, and hackathon label. Finish on a clean dashboard screenshot. | “We cannot stop every loss with a dashboard. But we can make the next best decision before the clock runs out. Cascade Salvage—where every harvest outruns its expiry. Thank you.” |

---

## Pre-Recording Checklist

- [ ] Confirm the API and frontend run without errors.
- [ ] Confirm the displayed results are from the live optimizer, not mock data.
- [ ] Verify the MoFPI source wording and study details against the original publication; add a source link or citation in the video description.
- [ ] Use actual baseline and optimized metrics from one reproducible run.
- [ ] Confirm the metric labels match their formulas; do not call revenue after transport “net profit” if acquisition cost is excluded.
- [ ] Test a highway-jam simulation and verify the original route data is not mutated.
- [ ] Prepare a known batch and destination for a clear three-tier explanation.
- [ ] Record at 1920×1080 if possible; zoom in on the dashboard and keep text readable.
- [ ] Keep narration energetic but clear; use captions for key terms.
- [ ] Finish at **3:00**, leaving no unintentional silence or extra outro.

## Suggested Video Description

**Cascade Salvage** is a shelf-life-aware decision-support prototype for perishable produce distribution. It evaluates destination feasibility, demand, transit time, and economic value across premium retail, rapid distribution, and eligible processing recovery—and demonstrates how allocations can be reconsidered during a simulated transport disruption.

Built for the Wild Bugs Devfolio Hackathon, Problem Statement PS 03.
