"""
Test Suite for Scenario-Based Data Ingestion (Rain Delay, Harvest Glut, Custom JSON)
Verifies that Cascade Salvage can dynamically adapt to any new situation.
"""

import json
import sys
import unittest
from pathlib import Path

# Ensure repository root is on path for direct execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.optimizer import CascadeOptimizer, run_optimization, simulate_disruption


class TestScenarioIngestion(unittest.TestCase):

    def setUp(self):
        self.optimizer = CascadeOptimizer()

    def test_01_load_rain_delay_scenario(self):
        """Verify rain delay scenario datasets load and adhere to schema."""
        batches, dests, routes = self.optimizer.load_scenario_data("rain_delay")
        self.assertEqual(len(batches), 7)
        self.assertTrue(any(r["status"].startswith("WATERLOGGED") for r in routes))

    def test_02_rain_delay_optimization(self):
        """Rain delay optimization must drastically outperform baseline during weather crisis."""
        batches, dests, routes = self.optimizer.load_scenario_data("rain_delay")
        result = self.optimizer.optimize(batches, dests, routes)

        self.assertIn("allocations", result)
        self.assertIn("metrics", result)
        # In rain delay, baseline suffers ~69% loss; cascade salvage recovers massive value
        self.assertGreater(result["metrics"]["revenue_gain_pct"], 100.0)

    def test_03_custom_json_injection(self):
        """Verify arbitrary custom JSON situation can be passed directly into optimizer."""
        custom_batches = [
            {
                "batch_id": "CUSTOM_RAIN_01",
                "commodity": "Monsoon Tomato",
                "quantity_kg": 1500,
                "shelf_life_hrs": 12.0,
                "quality_grade": "B",
                "base_cost_per_kg": 14.0,
            }
        ]
        result = self.optimizer.optimize(custom_batches, None, None)
        self.assertEqual(len(result["allocations"]), 1)
        self.assertEqual(result["allocations"][0]["batch_id"], "CUSTOM_RAIN_01")
        self.assertEqual(result["allocations"][0]["status"], "SAVED")

    def test_04_simulate_rain_delay_disruption(self):
        """Verify native simulation of RAIN_DELAY disruption."""
        result = simulate_disruption(scenario_type="RAIN_DELAY", delay_hrs=8.0)
        self.assertIn("allocations", result)
        self.assertGreater(result["metrics"]["spoilage_reduction_pct"], 50.0)


if __name__ == "__main__":
    unittest.main()
