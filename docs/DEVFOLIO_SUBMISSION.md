# Cascade Salvage
## Where Every Harvest Outruns Its Expiry.

**Problem Statement:** PS 03 — Intelligent Decision Support for Perishable Produce Distribution  
**Project:** AI-Powered Perishable Resource Recovery and Distribution  
**Team:** Cascade Salvage | **Hackathon:** Wild Bugs Devfolio Hackathon

## Problem Statement

India's fruit and vegetable supply chain faces a time-sensitive coordination problem: produce can lose market value while waiting for the right buyer, transport, or distribution decision. Demand changes, limited shelf life, uneven cold-chain access, and transport delays can leave otherwise usable produce unsold or spoiled. Traditional distribution often prioritizes familiar retail channels and late discounting, while overlooking alternative destinations that may still recover value.

India's Ministry of Food Processing Industries (MoFPI) has supported research into post-harvest losses across commodities and agro-climatic regions. A study commonly cited in this context assessed **54 commodities across 15 agro-climatic zones**. Post-harvest loss estimates vary by commodity, region, study period, and methodology; therefore, Cascade Salvage does not treat one percentage as universal. The study's broad lesson is that loss prevention requires decisions grounded in commodity characteristics and local conditions.

The challenge is to decide, for each batch, **where it can still be accepted, delivered in time, and sold or processed for the best recoverable value**—rather than allowing a missed retail opportunity to become waste.

## Our Solution: A Three-Tier Cascade

Cascade Salvage is a shelf-life-aware decision-support system that evaluates feasible destinations and cascades inventory through three tiers. It considers batch quantity, quality grade, remaining shelf life, destination demand, minimum shelf-life requirements, transit time, offering price, and transport cost.

### Tier 1 — Premium Retail
Route high-quality produce with sufficient remaining shelf life to supermarkets and premium retailers. This tier aims to protect quality expectations and recover the highest suitable selling value.

### Tier 2 — Rapid Mandi
Redirect eligible produce to mandis, local markets, and quick-commerce distribution hubs when conventional premium channels are unsuitable or too slow. The system can apply a transparent discount strategy to encourage faster sell-through.

### Tier 3 — Processing & Salvage
When produce is unsuitable for conventional retail but still meets a processor's acceptance and food-safety requirements, route it to food-processing destinations for uses such as pulp, puree, and sauces. Processing is not a way to bypass safety checks: unsafe or ineligible produce must not be allocated.

The cascade is a decision policy, not a guarantee that every batch can be saved. If no destination is feasible, the system should report the quantity as unallocated and explain why.

## How It Works

1. **Ingest structured data:** Read batch, destination, and route records using the team's shared JSON data contract.
2. **Check feasibility:** Compare shelf life against transit time and destination minimum requirements; enforce demand and other configured constraints.
3. **Rank feasible options:** Evaluate tier suitability and economic value using offering price and transport cost.
4. **Allocate iteratively:** Allocate available quantity without exceeding batch inventory or destination demand, then consider other feasible destinations for any remainder.
5. **Re-plan after disruption:** Apply a temporary disruption scenario, recalculate feasibility, and produce a revised allocation plan without changing the original baseline data.
6. **Evaluate performance:** Compare the cascade with a clearly defined baseline using spoilage, fulfillment, transport cost, and economic-value metrics.

## Core Capabilities

- **Intelligent allocation:** Match batches to feasible destinations based on freshness, quality, demand, price, and transport.
- **Route-aware decisions:** Use transit time and transport cost to evaluate delivery feasibility and economics.
- **Dynamic re-planning:** Recalculate decisions when travel is delayed or a destination becomes unavailable.
- **Discount support:** Recommend discounts for at-risk inventory when the configured pricing model supports it.
- **Explainable decisions:** Provide reasons for assignments, rejection of infeasible options, and salvage recommendations.
- **Performance scorecard:** Compare baseline and optimized outcomes using consistent metric definitions.

## Challenges We Ran Into

- **Conflicting constraints:** A destination may offer a high price but lack sufficient demand or require more remaining shelf life than a batch can provide. We model destination feasibility before treating price as the only objective.
- **Partial allocations:** A destination may accept only part of a batch. The allocation flow must track remaining batch quantity and destination demand, then try other feasible destinations before counting inventory as unallocated.
- **Disruption isolation:** Simulations must not mutate the original route data. Each scenario should work on an independent copy so the baseline remains reproducible.
- **Metric clarity:** Revenue after transport cost is not the same as accounting profit. We document each metric's formula and avoid calling it net profit unless acquisition and other relevant costs are included.
- **Consistent integration:** The frontend, backend, optimizer, and sample data must use the same locked JSON field names and tier labels. Contract tests help prevent integration drift.
- **Honest evaluation:** Baseline and optimized plans must use comparable inventory, constraints, and financial definitions. We distinguish model outputs from illustrative or fallback data.

## Technologies Used

- **Python** — allocation logic, constraint checks, and performance calculations.
- **FastAPI** — REST API for data, optimization, health checks, and disruption simulation.
- **HTML, CSS, JavaScript** — interactive dashboard and visualization layer.
- **JSON** — shared batch, destination, and route data contract.
- **Pytest** — automated checks for schemas, allocation behavior, and API responses.
- **Git / GitHub** — version control and team collaboration.
- **Mermaid** — architecture documentation.

*Only list a technology as part of the final implementation if it is present in the submitted repository.*

## Expected Impact

Cascade Salvage aims to reduce avoidable spoilage, improve destination-demand fulfillment, make transport disruptions easier to respond to, and recover economic value from produce that may otherwise be discarded. Its value lies in turning a single-destination delivery decision into a transparent, re-plannable recovery network.

## Success Metrics

The dashboard should report, using consistent and documented formulas:

- Baseline and optimized unallocated/spoilage quantity (kg and %).
- Demand fulfillment (%).
- Quantity routed to each tier.
- Transportation cost.
- Revenue and contribution after explicitly stated costs.
- Change in allocation after a disruption.

Results are dependent on input data and model assumptions; projected improvements should be presented as scenario results, not universal guarantees.

## Core Principle

**Every batch should reach the most valuable feasible destination before its usable shelf life expires.**
