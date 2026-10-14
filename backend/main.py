"""
Cascade Salvage Backend API
FastAPI server exposing optimization and disruption simulation endpoints
"""

import json
import sys
from pathlib import Path
from typing import Optional, List, Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Try to import the optimizer, with mock fallback
try:
    from engine.optimizer import CascadeOptimizer
    OPTIMIZER_AVAILABLE = True
except ImportError:
    OPTIMIZER_AVAILABLE = False
    print("WARNING: Could not import CascadeOptimizer. Using mock fallback.")

app = FastAPI(
    title="Cascade Salvage API",
    description="AI-Powered Perishable Resource Recovery and Distribution",
    version="1.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load data files
DATA_DIR = Path(__file__).parent.parent / "data"

def load_json(filename: str):
    """Load JSON data file"""
    filepath = DATA_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=500, detail=f"Data file not found: {filename}")
    with open(filepath, 'r') as f:
        return json.load(f)

# Load initial data
try:
    batches_data = load_json("sample_batches.json")
    destinations_data = load_json("sample_destinations.json")
    routes_data = load_json("sample_routes.json")
except Exception as e:
    print(f"ERROR loading data files: {e}")
    batches_data = []
    destinations_data = []
    routes_data = []

# Request models
class OptimizeRequest(BaseModel):
    delay_hrs: Optional[float] = 0.0

class DisruptionRequest(BaseModel):
    delay_hrs: float
    disruption_type: str = "HIGHWAY_JAM"
    affected_dest_id: Optional[str] = None

# Mock fallback response
def get_mock_response():
    """Mock response matching the contract for when optimizer is unavailable"""
    return {
        "allocations": [
            {
                "batch_id": "B001",
                "commodity": "Tomato (Hybrid)",
                "dest_id": "D7",
                "dest_name": "Kissan Food Processing Hub",
                "tier": "Tier 3 - Processing Plant",
                "allocated_kg": 2500,
                "action": "SALVAGE_RECOVERY",
                "discount_pct": 0.0,
                "effective_price_per_kg": 18.0,
                "transport_cost_per_kg": 1.2,
                "net_profit": 4500.0,
                "margin_hrs": 10.0,
                "status": "SAVED",
                "reasoning": "Shelf life (18h) too short for retail. Salvaged to processing plant to prevent ₹37,500 total spoilage."
            },
            {
                "batch_id": "B002",
                "commodity": "Mango (Alphonso)",
                "dest_id": "D3",
                "dest_name": "Bangalore Reliance Fresh",
                "tier": "Tier 1 - Premium Retail",
                "allocated_kg": 1800,
                "action": "PREMIUM_SALE",
                "discount_pct": 0.0,
                "effective_price_per_kg": 45.0,
                "transport_cost_per_kg": 5.0,
                "net_profit": 9000.0,
                "margin_hrs": 24.0,
                "status": "SAVED",
                "reasoning": "Optimal premium allocation. Fresh arrival with 24h margin. Net profit: ₹9,000"
            }
        ],
        "metrics": {
            "baseline_spoilage_kg": 3200.0,
            "baseline_spoilage_pct": 24.6,
            "baseline_net_revenue": 142000.0,
            "optimized_spoilage_kg": 450.0,
            "optimized_spoilage_pct": 3.5,
            "optimized_net_revenue": 194500.0,
            "spoilage_reduction_pct": 85.8,
            "revenue_gain_pct": 37.0,
            "demand_fulfillment_pct": 92.4
        }
    }

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Cascade Salvage API",
        "version": "1.0.0",
        "status": "running",
        "optimizer_available": OPTIMIZER_AVAILABLE
    }

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Cascade Salvage API",
        "optimizer_available": OPTIMIZER_AVAILABLE,
        "data_loaded": len(batches_data) > 0 and len(destinations_data) > 0
    }

@app.get("/api/data")
async def get_data():
    """Get all current data (batches, destinations, routes)"""
    return {
        "batches": batches_data,
        "destinations": destinations_data,
        "routes": routes_data
    }

@app.post("/api/optimize")
async def optimize(request: OptimizeRequest = None):
    """
    Run optimization on current data

    Optional payload:
    - delay_hrs: Additional delay to apply to all routes (for testing)
    """
    try:
        if not OPTIMIZER_AVAILABLE:
            # Return mock response
            return get_mock_response()

        # Apply delay if requested (modify routes temporarily)
        working_routes = routes_data.copy()
        if request and request.delay_hrs > 0:
            working_routes = [
                {**route, "transit_time_hrs": route["transit_time_hrs"] + request.delay_hrs}
                for route in routes_data
            ]

        # Run optimization
        optimizer = CascadeOptimizer()
        result = optimizer.optimize(batches_data, destinations_data, working_routes)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {str(e)}")

@app.post("/api/simulate-disruption")
async def simulate_disruption(request: DisruptionRequest):
    """
    Simulate a disruption and show re-optimization

    Payload:
    - delay_hrs: Hours of delay to apply
    - disruption_type: Type of disruption (HIGHWAY_JAM, etc.)
    - affected_dest_id: Which destination is affected (optional, applies to all if not specified)
    """
    try:
        if not OPTIMIZER_AVAILABLE:
            # Return mock disruption response
            mock_result = get_mock_response()
            mock_result["disruption"] = {
                "type": request.disruption_type,
                "delay_hrs": request.delay_hrs,
                "affected_dest_id": request.affected_dest_id or "ALL"
            }
            return mock_result

        # First, get baseline allocation
        optimizer = CascadeOptimizer()
        baseline_result = optimizer.optimize(batches_data, destinations_data, routes_data)

        # Apply disruption to routes
        disrupted_routes = routes_data.copy()
        for route in disrupted_routes:
            if request.affected_dest_id is None or route["dest_id"] == request.affected_dest_id:
                route["transit_time_hrs"] += request.delay_hrs

        # Re-optimize with disrupted routes
        disrupted_result = optimizer.optimize(batches_data, destinations_data, disrupted_routes)

        # Add disruption metadata
        disrupted_result["disruption"] = {
            "type": request.disruption_type,
            "delay_hrs": request.delay_hrs,
            "affected_dest_id": request.affected_dest_id or "ALL",
            "baseline_metrics": baseline_result["metrics"]
        }

        return disrupted_result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Disruption simulation failed: {str(e)}")

@app.get("/api/stats")
async def get_stats():
    """Get summary statistics of current data"""
    total_inventory_kg = sum(b["quantity_kg"] for b in batches_data)
    total_demand_kg = sum(d["demand_kg"] for d in destinations_data)

    tier_counts = {}
    for dest in destinations_data:
        tier = dest["tier"]
        tier_counts[tier] = tier_counts.get(tier, 0) + 1

    shelf_life_stats = {
        "min": min((b["shelf_life_hrs"] for b in batches_data), default=0),
        "max": max((b["shelf_life_hrs"] for b in batches_data), default=0),
        "avg": sum(b["shelf_life_hrs"] for b in batches_data) / len(batches_data) if batches_data else 0
    }

    return {
        "batches": {
            "count": len(batches_data),
            "total_kg": total_inventory_kg,
            "shelf_life_hrs": shelf_life_stats
        },
        "destinations": {
            "count": len(destinations_data),
            "total_demand_kg": total_demand_kg,
            "by_tier": tier_counts
        },
        "routes": {
            "count": len(routes_data)
        }
    }

if __name__ == "__main__":
    import uvicorn
    import sys
    # Force UTF-8 output on Windows to handle any unicode characters
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("=" * 80)
    print("CASCADE SALVAGE API")
    print("=" * 80)
    print(f"Optimizer Available: {OPTIMIZER_AVAILABLE}")
    print(f"Batches Loaded: {len(batches_data)}")
    print(f"Destinations Loaded: {len(destinations_data)}")
    print(f"Routes Loaded: {len(routes_data)}")
    print("=" * 80)
    print("Starting server on http://localhost:8000")
    print("API Docs: http://localhost:8000/docs")
    print("=" * 80)

    uvicorn.run(app, host="0.0.0.0", port=8000)
