# Cascade Salvage — Official Hackathon Demo Script & Voiceover
## Where Every Harvest Outruns Its Expiry.

**Devfolio Hackathon: Wild Bugs | Problem Statement 03 — FreshRoute**  
**Format:** 2.5 to 3-Minute Hackathon Demo Pitch Video  
**Voice Engine:** ElevenLabs (Recommended voice: *Adam*, *Antony*, or *Rachel* — Warm, Confident, Professional)

---

## 🎬 Section 1: Video Storyboard & Screen Actions

| Timecode | Visual / Screen Action | Spoken Script |
|---|---|---|
| **0:00–0:25** | **The Problem & MoFPI Context**<br>• Title on screen: **CASCADE SALVAGE**.<br>• Graphic overlay: *"India loses over 25% of fresh produce post-harvest (MoFPI 2020–22 Study)"*.<br>• Footage or images of produce discarded at mandis. | “India's Ministry of Food Processing Industries reports that up to thirty percent of fresh produce is lost post-harvest. The root cause is not just cold storage—it is rigid, blind logistics. Produce distributors dispatch batches using traditional first-in, first-out rules, ignoring granular shelf life. When delays occur or produce ripens too fast, it is simply discarded at mandis.” |
| **0:25–0:55** | **The Solution & 3-Tier Cascade Model**<br>• Pan across the dark-mode dashboard.<br>• Highlight the Three Tiers diagram:<br>  *Tier 1: Premium Retail*<br>  *Tier 2: Rapid Mandi*<br>  *Tier 3: Processing Plant*. | “Meet Cascade Salvage—an AI-powered decision support platform that ensures every batch of produce reaches its most valuable feasible destination before its usable shelf life expires. We operate on a three-tier cascade model: Tier One, Premium Supermarkets; Tier Two, Rapid Mandis and Quick Commerce with dynamic velocity discounting; and Tier Three, Food Processing Plants that convert near-expiry stock into high-value puree, pulp, and sauces.” |
| **0:55–1:30** | **Live Optimization & Impact Cards**<br>• Switch to live dashboard connected to `localhost:8000`.<br>• Zoom into the **Impact Scorecard**.<br>• Highlight **88.9% Spoilage Reduction** and **40.3% Revenue Gain**. | “Here is our live decision engine. Our algorithm ingests thirteen thousand kilograms of fresh inventory across Nashik and Mumbai corridors. Look at the immediate impact: conventional dispatch resulted in nearly thirty-five percent spoilage. Cascade Salvage cuts that down to just three point eight percent—an eighty-eight point nine percent reduction in food waste, while generating a forty percent surge in net revenue.” |
| **1:30–2:05** | **Batch Deep-Dive & Processing Salvage**<br>• Click Row `B001` (Tomato Hybrid, 18h shelf life).<br>• Open Drawer: show ₹37,500 saved badge.<br>• Point to `B004` (Banana) with a 10% velocity discount. | “Notice batch B-zero-zero-one: twenty-five hundred kilograms of tomatoes with only eighteen hours of shelf life. In a traditional supply chain, this batch would be rejected at Mumbai retail and dumped as waste. Our optimizer instantly identifies the constraint and diverts it to the Kissan Food Processing Hub only forty-five kilometers away, salvaging forty-two thousand rupees in net value and preventing thirty-seven thousand five hundred rupees in total loss. For batches nearing rapid-turnover thresholds, our dynamic discounting engine automatically discounts prices by ten to fifteen percent, guaranteeing instant clearance.” |
| **2:05–2:30** | **Live Disruption Simulation (Highway Jam)**<br>• Click the red button: *"🚨 Simulate 6h Highway Jam — D1 corridor"*. • Show instant recalculation banner and rerouted batches. | “Supply chains are volatile. Watch what happens when a six-hour highway delay hits the primary Mumbai corridor. With one click, our engine detects the corridor shock, recalculates shelf-life viability across all active transit routes, and reroutes at-risk batches into local quick-commerce hubs and nearby processing plants in real time. Zero transit spoilage.” |
| **2:30–2:50** | **Closing & Architecture**<br>• Show project architecture diagram, team members, and GitHub QR code. | “Cascade Salvage turns avoidable agricultural waste into economic resilience and food security. Built with a modular Python optimization engine, high-performance FastAPI backend, and an explainable decision dashboard. Cascade Salvage—where every harvest outruns its expiry. Thank you.” |

---

## 🎙️ Section 2: Pure ElevenLabs Voiceover Script (Ready to Copy-Paste)

> **Instructions for ElevenLabs:**
> 1. Copy the text block below.
> 2. Paste into the ElevenLabs text box.
> 3. Voice setting recommendation: **Stability: 55%, Clarity: 75%**.

India's Ministry of Food Processing Industries reports that up to thirty percent of fresh produce is lost post-harvest. The root cause is not just a lack of cold storage, but rigid, blind distribution. Traditional supply chains dispatch batches without granular shelf-life awareness. When produce ripens in transit or faces delays, it is simply discarded at mandis.

Meet Cascade Salvage. An AI-powered decision support system that guarantees every batch reaches its most valuable feasible destination before its usable shelf life expires.

We achieve this through an intelligent three-tier cascade model. Tier One directs premium, long-life produce to supermarkets for maximum margin. Tier Two channels moderate shelf-life produce to rapid mandis and quick-commerce dark stores, applying dynamic velocity discounts to clear inventory fast. And Tier Three redirects produce approaching its retail expiration to industrial food processors, transforming at-risk inventory into pulp, puree, and sauces before biological decay.

In our live demonstration across thirteen thousand kilograms of produce, traditional dispatch suffered thirty-five percent spoilage. Cascade Salvage crushes that down to just three point eight percent—delivering an eighty-eight point nine percent reduction in food waste and a forty percent boost in net revenue.

Take batch B-zero-zero-one. Twenty-five hundred kilograms of tomatoes with only eighteen hours of shelf life. In a conventional system, this batch is rejected at retail and dumped. Cascade Salvage instantly rescues it to the Kissan Processing Hub, recovering forty-two thousand rupees in value and preventing thirty-seven thousand five hundred rupees in total loss.

And when real-world disruptions strike—like a six-hour highway blockage—our dynamic replanning engine recalculates viable routes in real time, shifting stranded volume into rapid recovery hubs with zero transit loss.

Cascade Salvage transforms perishable distribution into a shelf-life-aware recovery network—protecting farmer livelihoods, distributor profits, and our food supply. Cascade Salvage: where every harvest outruns its expiry. Thank you.

---

## 📋 Pre-Recording Checklist for the Demo Video

- [ ] Confirm the backend is running at `http://localhost:8000` (`python backend/main.py`).
- [ ] Confirm the frontend dashboard shows the green **API CONNECTED** badge.
- [ ] Open the dashboard at full screen (1920×1080 resolution) in Chrome or Edge.
- [ ] Practice the click on *"🚨 Simulate 6h Highway Jam — D1 corridor"* at around the 2:05 timestamp.
- [ ] Render the ElevenLabs audio and sync with your screen recording in CapCut, Premiere, or OBS.
- [ ] Keep final video length between **2:30 and 2:50** minutes for maximum judge engagement.
