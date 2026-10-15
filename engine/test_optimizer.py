"""
Unit and Integration Tests for Member 1: Cascade Salvage Optimizer & Data Contracts
Verifies strict compliance with the shared team specifications.
"""

import json
import sys
import unittest
from pathlib import Path

# Ensure repository root is on path for direct execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.optimizer import CascadeOptimizer, run_optimization, simulate_disruption


class TestCascadeSalvageEngine(unittest.TestCase):

    def setUp(self):
        self.optimizer = CascadeOptimizer()
        self.batches, self.destinations, self.routes = self.optimizer.load_default_data()

    def test_01_batch_contract_keys(self):
        """Batch JSON objects must have exact locked keys."""
        required_keys = {
            "batch_id",
            "commodity",
            "quantity_kg",
            "shelf_life_hrs",
            "quality_grade",
            "base_cost_per_kg",
        }
        for batch in self.batches:
            self.assertTrue(
                required_keys.issubset(batch.keys()),
                f"Batch {batch.get('batch_id')} missing keys: {required_keys - set(batch.keys())}",
            )

    def test_02_destination_contract_keys_and_tiers(self):
        """Destination JSON objects must have exact keys and valid strict tiers."""
        required_keys = {
            "dest_id",
            "name",
            "tier",
            "demand_kg",
            "offering_price_per_kg",
            "min_shelf_life_hrs",
            "distance_km",
            "transit_time_hrs",
            "transport_cost_per_kg",
        }
        valid_tiers = {
            "Tier 1 - Premium Retail",
            "Tier 2 - Rapid Mandi",
            "Tier 3 - Processing Plant",
        }
        for dest in self.destinations:
            self.assertTrue(
                required_keys.issubset(dest.keys()),
                f"Destination {dest.get('dest_id')} missing keys: {required_keys - set(dest.keys())}",
            )
            self.assertIn(
                dest["tier"],
                valid_tiers,
                f"Destination {dest.get('dest_id')} has invalid tier: {dest['tier']}",
            )

    def test_03_route_contract_keys(self):
        """Routes must have valid fields matching approved schema."""
        required_keys = {
            "route_id",
            "origin_hub",
            "dest_id",
            "distance_km",
            "transit_time_hrs",
            "transport_cost_per_kg",
            "vehicle_type",
            "status",
        }
        for route in self.routes:
            self.assertTrue(
                required_keys.issubset(route.keys()),
                f"Route {route.get('route_id')} missing keys: {required_keys - set(route.keys())}",
            )

    def test_04_optimization_response_contract(self):
        """Response from run_optimization must contain exact allocations and metrics schemas."""
        res = run_optimization()
        self.assertIn("allocations", res)
        self.assertIn("metrics", res)

        alloc_keys = {
            "batch_id",
            "commodity",
            "dest_id",
            "dest_name",
            "tier",
            "allocated_kg",
            "action",
            "discount_pct",
            "effective_price_per_kg",
            "transport_cost_per_kg",
            "net_profit",
            "margin_hrs",
            "status",
            "reasoning",
        }
        for alloc in res["allocations"]:
            self.assertTrue(
                alloc_keys.issubset(alloc.keys()),
                f"Allocation {alloc.get('batch_id')} missing keys: {alloc_keys - set(alloc.keys())}",
            )

        metric_keys = {
            "baseline_spoilage_kg",
            "baseline_spoilage_pct",
            "baseline_net_revenue",
            "optimized_spoilage_kg",
            "optimized_spoilage_pct",
            "optimized_net_revenue",
            "spoilage_reduction_pct",
            "revenue_gain_pct",
            "demand_fulfillment_pct",
        }
        self.assertTrue(
            metric_keys.issubset(res["metrics"].keys()),
            f"Metrics missing keys: {metric_keys - set(res['metrics'].keys())}",
        )

    def test_05_b001_exact_target_match(self):
        """Verifies that B001 produces the exact contract example from problem specification."""
        res = run_optimization()
        b001_alloc = next((a for a in res["allocations"] if a["batch_id"] == "B001"), None)
        self.assertIsNotNone(b001_alloc)
        self.assertEqual(b001_alloc["dest_id"], "D4")
        self.assertEqual(b001_alloc["tier"], "Tier 3 - Processing Plant")
        self.assertEqual(b001_alloc["allocated_kg"], 2500.0)
        self.assertEqual(b001_alloc["action"], "SALVAGE_RECOVERY")
        self.assertEqual(b001_alloc["net_profit"], 42000.0)
        self.assertEqual(b001_alloc["margin_hrs"], 16.5)
        self.assertEqual(b001_alloc["status"], "SAVED")

    def test_06_simulate_disruption(self):
        """Simulate disruption must return complete valid contract with congestion accounted for."""
        res = simulate_disruption(scenario_type="HIGHWAY_CONGESTION", delay_hrs=6.5, affected_dest_ids=["D1"])
        self.assertIn("allocations", res)
        self.assertIn("metrics", res)
        self.assertGreater(len(res["allocations"]), 0)


if __name__ == "__main__":
    unittest.main()
