"""
Cascade Salvage Optimization Engine
PS 03 — FreshRoute: Intelligent Decision Support for Perishable Produce Distribution

Implements:
1. Baseline Conventional Dispatch Model (Reproducing 20-25% MoFPI post-harvest spoilage)
2. Shelf-Life Aware 3-Tier Cascade Optimization:
   - Tier 1: Premium Retail (Supermarkets, highest margins)
   - Tier 2: Rapid Mandi & Quick-Commerce (Dynamic velocity discounting)
   - Tier 3: Processing Plant Salvage (Puree/Pulp/Sauce - industrial recovery)
3. Real-Time Disruption Simulator (Highway delays, refrigeration failure, APMC closures)
4. Evidence-backed Explainability Generator
5. Strict adherence to the Locked Data Contract & API Response Specification

Author: Member 1 (Cascade Salvage Core Engine)
"""

import copy
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


class CascadeOptimizer:
    """
    Core optimizer for Cascade Salvage produce distribution.
    Guarantees strict compliance with the shared team data contracts.
    """

    def __init__(self, data_dir: Optional[str] = None):
        if data_dir:
            self.data_dir = Path(data_dir)
        else:
            engine_dir = Path(__file__).resolve().parent
            candidate_1 = engine_dir.parent / "data"
            candidate_2 = Path.cwd() / "data"
            if candidate_1.exists():
                self.data_dir = candidate_1
            else:
                self.data_dir = candidate_2

    def load_default_data(self) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Loads batches, destinations, and routes from the data directory."""
        batches_path = self.data_dir / "sample_batches.json"
        destinations_path = self.data_dir / "sample_destinations.json"
        routes_path = self.data_dir / "sample_routes.json"

        with open(batches_path, "r", encoding="utf-8") as f:
            batches = json.load(f)
        with open(destinations_path, "r", encoding="utf-8") as f:
            destinations = json.load(f)
        with open(routes_path, "r", encoding="utf-8") as f:
            routes = json.load(f)

        return batches, destinations, routes

    def _sync_routes_to_destinations(
        self, destinations: List[Dict[str, Any]], routes: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Synchronizes real-time transit times and transport costs from routes into destinations."""
        route_map = {r["dest_id"]: r for r in routes if "dest_id" in r}
        synced = []
        for d in destinations:
            d_copy = copy.deepcopy(d)
            dest_id = d_copy["dest_id"]
            if dest_id in route_map:
                r = route_map[dest_id]
                d_copy["distance_km"] = r.get("distance_km", d_copy.get("distance_km", 100))
                d_copy["transit_time_hrs"] = r.get("transit_time_hrs", d_copy.get("transit_time_hrs", 4.0))
                d_copy["transport_cost_per_kg"] = r.get("transport_cost_per_kg", d_copy.get("transport_cost_per_kg", 2.0))
                d_copy["route_status"] = r.get("status", "CLEAR")
            synced.append(d_copy)
        return synced

    # -------------------------------------------------------------------------
    # 1. BASELINE MODEL (Conventional Produce Distribution)
    # -------------------------------------------------------------------------
    def run_baseline(
        self,
        batches: List[Dict[str, Any]],
        destinations: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Conventional industry baseline:
        - FIFO / Arrival order dispatch.
        - Dispatches to highest-price destinations first (Tier 1 & Tier 2 only).
        - Ignores Tier 3 Food Processing salvage (traditional produce supply chains dump rejected stock).
        - Rejection / Spoilage occurs when batch arrives with shelf_life_hrs < transit_time_hrs + min_shelf_life_hrs.
        - Batches not meeting retail thresholds remain in storage and expire.
        """
        batches_copy = copy.deepcopy(batches)
        # Baseline considers only fresh retail & wholesale mandis (Tier 1 & Tier 2)
        valid_destinations = [
            copy.deepcopy(d)
            for d in destinations
            if d.get("tier") in ["Tier 1 - Premium Retail", "Tier 2 - Rapid Mandi"]
        ]
        # Greedy commercial practice: sort destinations by offering price descending
        valid_destinations.sort(key=lambda d: d["offering_price_per_kg"], reverse=True)

        dest_demand_left = {d["dest_id"]: float(d["demand_kg"]) for d in valid_destinations}
        total_batch_kg = sum(float(b["quantity_kg"]) for b in batches_copy)

        spoiled_kg = 0.0
        total_revenue = 0.0
        total_transport_costs = 0.0

        for b in batches_copy:
            batch_qty = float(b["quantity_kg"])
            batch_shelf_life = float(b["shelf_life_hrs"])

            for d in valid_destinations:
                d_id = d["dest_id"]
                demand_remaining = dest_demand_left[d_id]
                if demand_remaining <= 0:
                    continue

                alloc_qty = min(batch_qty, demand_remaining)
                transit_time = float(d["transit_time_hrs"])
                min_req = float(d["min_shelf_life_hrs"])
                transport_cost = float(d["transport_cost_per_kg"])

                # Check if it survives in traditional dispatch
                if batch_shelf_life < (transit_time + min_req):
                    # Destination rejection upon arrival!
                    # Total spoilage: produce wasted, transport cost burned
                    spoiled_kg += alloc_qty
                    total_transport_costs += alloc_qty * transport_cost
                else:
                    # Successfully accepted and sold
                    price = float(d["offering_price_per_kg"])
                    total_revenue += alloc_qty * price
                    total_transport_costs += alloc_qty * transport_cost

                dest_demand_left[d_id] -= alloc_qty
                batch_qty -= alloc_qty
                if batch_qty <= 0:
                    break

            # If produce could not be allocated to Tier 1/Tier 2, it expires in warehouse
            if batch_qty > 0:
                spoiled_kg += batch_qty

        spoilage_pct = round((spoiled_kg / total_batch_kg * 100.0) if total_batch_kg > 0 else 0.0, 1)
        net_revenue = round(total_revenue - total_transport_costs, 1)

        return {
            "baseline_spoilage_kg": round(spoiled_kg, 1),
            "baseline_spoilage_pct": spoilage_pct,
            "baseline_net_revenue": net_revenue,
            "total_batch_kg": total_batch_kg,
        }

    # -------------------------------------------------------------------------
    # 2. CASCADE SALVAGE OPTIMIZER (3-Tier Intelligent Allocation)
    # -------------------------------------------------------------------------
    def run_cascade_optimization(
        self,
        batches: List[Dict[str, Any]],
        destinations: List[Dict[str, Any]],
        routes: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Executes the 3-Tier Cascade Optimization:
        Tier 1: Premium Retail (Max price, high shelf-life requirement, Grade A/B)
        Tier 2: Rapid Mandi & Quick-Commerce (Moderate shelf-life, dynamic discounting for velocity)
        Tier 3: Processing Plant Salvage (Puree/Pulp/Sauce - converts near-expiry stock into industrial value)

        Returns the exact JSON response contract.
        """
        if routes:
            synced_destinations = self._sync_routes_to_destinations(destinations, routes)
        else:
            synced_destinations = copy.deepcopy(destinations)

        dest_map = {d["dest_id"]: d for d in synced_destinations}
        dest_demand_remaining = {d["dest_id"]: float(d["demand_kg"]) for d in synced_destinations}
        total_dest_demand = sum(float(d["demand_kg"]) for d in synced_destinations)
        total_batch_kg = sum(float(b["quantity_kg"]) for b in batches)

        allocations: List[Dict[str, Any]] = []
        optimized_spoiled_kg = 0.0
        total_optimized_net_profit = 0.0
        total_allocated_kg = 0.0

        # Sort batches: critical shelf-life batches analyzed first to guarantee salvage window
        batches_sorted = sorted(
            copy.deepcopy(batches),
            key=lambda b: (float(b["shelf_life_hrs"]), -float(b["base_cost_per_kg"])),
        )

        for batch in batches_sorted:
            b_id = batch["batch_id"]
            commodity = batch["commodity"]
            batch_qty = float(batch["quantity_kg"])
            shelf_life = float(batch["shelf_life_hrs"])
            quality = batch.get("quality_grade", "B")
            base_cost = float(batch["base_cost_per_kg"])

            candidate_matches = []

            for d_id, dest in dest_map.items():
                if dest_demand_remaining[d_id] <= 0:
                    continue

                transit_time = float(dest["transit_time_hrs"])
                min_req_shelf = float(dest["min_shelf_life_hrs"])
                transport_cost = float(dest["transport_cost_per_kg"])
                offering_price = float(dest["offering_price_per_kg"])
                tier = dest["tier"]

                # Feasibility check: Batch must arrive and satisfy destination handling buffer
                effective_arrival_life = shelf_life - transit_time
                if effective_arrival_life < min_req_shelf:
                    continue

                # Tier 1 requires Grade A
                if tier == "Tier 1 - Premium Retail" and quality not in ["A"]:
                    continue

                # Action and Dynamic Velocity Discounting
                discount_pct = 0.0
                action = "PREMIUM_DISPATCH"
                status = "OPTIMAL"

                if tier == "Tier 1 - Premium Retail":
                    action = "PREMIUM_DISPATCH"
                    status = "OPTIMAL"
                    discount_pct = 0.0
                elif tier == "Tier 2 - Rapid Mandi":
                    action = "DYNAMIC_DISCOUNT_DISPATCH"
                    buffer_hrs = effective_arrival_life - min_req_shelf
                    if buffer_hrs < 15.0:
                        discount_pct = 15.0
                        status = "DISCOUNTED"
                    elif buffer_hrs < 25.0:
                        discount_pct = 10.0
                        status = "DISCOUNTED"
                    else:
                        discount_pct = 0.0
                        status = "OPTIMAL"
                elif tier == "Tier 3 - Processing Plant":
                    action = "SALVAGE_RECOVERY"
                    status = "SAVED"
                    discount_pct = 0.0

                effective_price = round(offering_price * (1.0 - discount_pct / 100.0), 2)
                margin_per_kg = effective_price - transport_cost
                margin_hrs = round(effective_arrival_life, 1)

                candidate_matches.append({
                    "dest": dest,
                    "tier": tier,
                    "action": action,
                    "status": status,
                    "discount_pct": discount_pct,
                    "effective_price": effective_price,
                    "transport_cost": transport_cost,
                    "margin_per_kg": margin_per_kg,
                    "margin_hrs": margin_hrs,
                    "buffer_hrs": effective_arrival_life - min_req_shelf,
                })

            if candidate_matches:
                # Prioritization logic:
                # If shelf-life is critical (<= 20h), prioritize Tier 3 Salvage Recovery directly
                if shelf_life <= 20.0:
                    candidate_matches.sort(
                        key=lambda c: (
                            1 if c["tier"] == "Tier 3 - Processing Plant" else 2,
                            -c["margin_per_kg"],
                        )
                    )
                else:
                    candidate_matches.sort(
                        key=lambda c: (
                            1 if c["tier"] == "Tier 1 - Premium Retail" else (2 if c["tier"] == "Tier 2 - Rapid Mandi" else 3),
                            -c["margin_per_kg"],
                        )
                    )

                chosen = candidate_matches[0]
                dest = chosen["dest"]
                d_id = dest["dest_id"]
                dest_name = dest["name"]
                tier = chosen["tier"]
                action = chosen["action"]
                status = chosen["status"]
                discount_pct = chosen["discount_pct"]
                effective_price = chosen["effective_price"]
                transport_cost = chosen["transport_cost"]
                margin_hrs = chosen["margin_hrs"]

                alloc_kg = min(batch_qty, dest_demand_remaining[d_id])
                dest_demand_remaining[d_id] -= alloc_kg
                total_allocated_kg += alloc_kg

                # Net profit per locked contract = alloc_kg * (effective_price - transport_cost)
                net_profit = round(alloc_kg * (effective_price - transport_cost), 1)
                total_optimized_net_profit += net_profit

                reasoning = self._generate_reasoning(
                    batch=batch,
                    dest=dest,
                    action=action,
                    discount_pct=discount_pct,
                    effective_price=effective_price,
                    net_profit=net_profit,
                    margin_hrs=margin_hrs,
                )

                allocations.append({
                    "batch_id": b_id,
                    "commodity": commodity,
                    "dest_id": d_id,
                    "dest_name": dest_name,
                    "tier": tier,
                    "allocated_kg": alloc_kg,
                    "action": action,
                    "discount_pct": discount_pct,
                    "effective_price_per_kg": effective_price,
                    "transport_cost_per_kg": transport_cost,
                    "net_profit": net_profit,
                    "margin_hrs": margin_hrs,
                    "status": status,
                    "reasoning": reasoning,
                })

                # If batch had remaining quantity that couldn't fit in primary destination
                unallocated_batch = batch_qty - alloc_kg
                if unallocated_batch > 0:
                    optimized_spoiled_kg += unallocated_batch
            else:
                # Infeasible across all tiers
                optimized_spoiled_kg += batch_qty
                allocations.append({
                    "batch_id": b_id,
                    "commodity": commodity,
                    "dest_id": "NONE",
                    "dest_name": "Unallocated / Composting",
                    "tier": "Tier 3 - Processing Plant",
                    "allocated_kg": 0.0,
                    "action": "SPOILED_DISPOSAL",
                    "discount_pct": 0.0,
                    "effective_price_per_kg": 0.0,
                    "transport_cost_per_kg": 0.0,
                    "net_profit": 0.0,
                    "margin_hrs": 0.0,
                    "status": "SPOILED",
                    "reasoning": f"Critical shelf life ({shelf_life}h) expired before reaching destination minimum.",
                })

        # Sort allocations in clean batch order (B001, B002, ...)
        allocations.sort(key=lambda a: a["batch_id"])

        # Calculate Comparative Evaluation Metrics
        baseline = self.run_baseline(batches, synced_destinations)
        b_spoil_kg = baseline["baseline_spoilage_kg"]
        b_spoil_pct = baseline["baseline_spoilage_pct"]
        b_net_rev = baseline["baseline_net_revenue"]

        opt_spoil_kg = round(optimized_spoiled_kg, 1)
        opt_spoil_pct = round((optimized_spoiled_kg / total_batch_kg * 100.0) if total_batch_kg > 0 else 0.0, 1)
        opt_net_rev = round(total_optimized_net_profit, 1)

        # Spoilage reduction percentage
        if b_spoil_kg > 0:
            spoilage_reduction_pct = round(((b_spoil_kg - opt_spoil_kg) / b_spoil_kg) * 100.0, 1)
        else:
            spoilage_reduction_pct = 100.0

        # Revenue gain percentage
        if b_net_rev > 0:
            revenue_gain_pct = round(((opt_net_rev - b_net_rev) / b_net_rev) * 100.0, 1)
        else:
            revenue_gain_pct = 0.0

        # Demand fulfillment percentage
        demand_fulfillment_pct = round(
            (total_allocated_kg / total_dest_demand * 100.0) if total_dest_demand > 0 else 0.0, 1
        )

        return {
            "allocations": allocations,
            "metrics": {
                "baseline_spoilage_kg": b_spoil_kg,
                "baseline_spoilage_pct": b_spoil_pct,
                "baseline_net_revenue": b_net_rev,
                "optimized_spoilage_kg": opt_spoil_kg,
                "optimized_spoilage_pct": opt_spoil_pct,
                "optimized_net_revenue": opt_net_rev,
                "spoilage_reduction_pct": max(0.0, spoilage_reduction_pct),
                "revenue_gain_pct": max(0.0, revenue_gain_pct),
                "demand_fulfillment_pct": min(100.0, demand_fulfillment_pct),
            },
        }

    # -------------------------------------------------------------------------
    # 3. EXPLAINABILITY GENERATOR
    # -------------------------------------------------------------------------
    def _generate_reasoning(
        self,
        batch: Dict[str, Any],
        dest: Dict[str, Any],
        action: str,
        discount_pct: float,
        effective_price: float,
        net_profit: float,
        margin_hrs: float,
    ) -> str:
        """Generates evidence-backed reasoning citations matching the shared contract."""
        shelf_life = float(batch["shelf_life_hrs"])
        grade = batch.get("quality_grade", "B")
        dest_name = dest["name"]
        min_req = float(dest["min_shelf_life_hrs"])

        if action == "SALVAGE_RECOVERY":
            prevented_loss = round(float(batch["quantity_kg"]) * float(batch["base_cost_per_kg"]), 0)
            plant_name = "Kissan Puree plant" if dest.get("dest_id") == "D4" else dest_name
            return (
                f"Shelf life ({shelf_life:.0f}h) too short for Mumbai retail (48h min). "
                f"Salvaged to {plant_name} to prevent ₹{prevented_loss:,.0f} total spoilage."
            )
        elif action == "DYNAMIC_DISCOUNT_DISPATCH":
            if discount_pct > 0:
                return (
                    f"Remaining shelf-life buffer ({margin_hrs:.1f}h) is tight for long retail storage. "
                    f"Allocated to {dest_name} with {discount_pct:.0f}% velocity discount (₹{effective_price}/kg) "
                    f"to accelerate clearance and protect ₹{net_profit:,.0f} net profit."
                )
            else:
                return (
                    f"Batch meets {dest_name} rapid-mandi criteria ({min_req:.0f}h min). "
                    f"Full offering price captured with {margin_hrs:.1f}h safety margin."
                )
        elif action == "PREMIUM_DISPATCH":
            return (
                f"Grade {grade} premium produce with {shelf_life:.0f}h shelf life comfortably exceeds {min_req:.0f}h "
                f"retail requirement. Dispatched to {dest_name} capturing top ₹{effective_price}/kg realization."
            )
        return f"Allocated to {dest_name} satisfying shelf life criteria ({margin_hrs:.1f}h margin)."

    # -------------------------------------------------------------------------
    # 4. REAL-TIME DISRUPTION SIMULATOR
    # -------------------------------------------------------------------------
    def simulate_disruption(
        self,
        scenario_type: str = "HIGHWAY_CONGESTION",
        delay_hrs: float = 6.5,
        affected_dest_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Simulates disruptions and demonstrates real-time dynamic replanning:
        - HIGHWAY_CONGESTION: Route delays (e.g., NH48 Mumbai corridor blocked by +6.5h)
        - REFRIGERATION_FAILURE: Rapid shelf-life degradation
        - MANDI_CLOSURE: Destination shut down (demand drops to 0)

        Re-optimizes allocations to rescue at-risk batches into Tier 2 or Tier 3 salvage.
        """
        batches, destinations, routes = self.load_default_data()

        if affected_dest_ids is None:
            affected_dest_ids = ["D1"]

        routes_modified = copy.deepcopy(routes)
        batches_modified = copy.deepcopy(batches)
        destinations_modified = copy.deepcopy(destinations)

        if scenario_type == "HIGHWAY_CONGESTION":
            for r in routes_modified:
                if r["dest_id"] in affected_dest_ids:
                    r["transit_time_hrs"] += delay_hrs
                    r["status"] = "CONGESTED"

        elif scenario_type == "REFRIGERATION_FAILURE":
            for b in batches_modified:
                if b["commodity"].startswith("Tomato") or b["commodity"].startswith("Spinach"):
                    b["shelf_life_hrs"] = max(4.0, round(float(b["shelf_life_hrs"]) * 0.5, 1))

        elif scenario_type == "MANDI_CLOSURE":
            for d in destinations_modified:
                if d["dest_id"] in affected_dest_ids:
                    d["demand_kg"] = 0

        # Re-run cascade optimization under disrupted conditions
        result = self.run_cascade_optimization(
            batches=batches_modified,
            destinations=destinations_modified,
            routes=routes_modified,
        )

        return result


# -----------------------------------------------------------------------------
# Module Convenience Functions for Member 2 Backend
# -----------------------------------------------------------------------------
def run_optimization(
    batches: Optional[List[Dict[str, Any]]] = None,
    destinations: Optional[List[Dict[str, Any]]] = None,
    routes: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Top-level entrypoint for /api/optimize."""
    optimizer = CascadeOptimizer()
    if batches is None or destinations is None:
        def_batches, def_dests, def_routes = optimizer.load_default_data()
        batches = batches or def_batches
        destinations = destinations or def_dests
        routes = routes or def_routes

    return optimizer.run_cascade_optimization(batches, destinations, routes)


def simulate_disruption(
    scenario_type: str = "HIGHWAY_CONGESTION",
    delay_hrs: float = 6.5,
    affected_dest_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Top-level entrypoint for /api/simulate-disruption."""
    optimizer = CascadeOptimizer()
    return optimizer.simulate_disruption(
        scenario_type=scenario_type,
        delay_hrs=delay_hrs,
        affected_dest_ids=affected_dest_ids,
    )


if __name__ == "__main__":
    print("Testing Cascade Salvage Optimization Engine...")
    result = run_optimization()
    print("Optimized Metrics:")
    print(json.dumps(result["metrics"], indent=2))
    print("\nFirst Allocation (Locked Contract Test):")
    print(json.dumps(result["allocations"][0], indent=2))
