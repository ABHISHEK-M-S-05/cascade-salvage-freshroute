# CASCADE SALVAGE frontend

A static page, with no build step and no framework. It talks to the FastAPI backend in `backend/main.py`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page: hero, story, cold-chain curve, Rescue Lab, studio, network, explorer, ledger |
| `styles.css` | The whole design system |
| `app.js` | API calls, scenario logic, SVG charts, network, explorer, penguin |
| `demo-snapshots.js` | Saved runs of `engine/optimizer.py` on `data/*.json`. These are used only in demo mode. |
| `assets/*.svg` | Original artwork: the penguin, arctic scenes, produce crate, processing line and favicon |

There are no external scripts. Google Fonts is optional, and the page falls back to system fonts.

## Run it

From the repo root, use two terminals.

```powershell
# terminal 1: backend
.venv\Scripts\Activate.ps1
uvicorn backend.main:app --port 8000

# terminal 2: frontend
python -m http.server 5500
```

Then open http://localhost:5500/frontend/

Demo without the backend: http://localhost:5500/frontend/?mock=1, or double-click `index.html` and choose "Explore demo data".

Other options:
- `?api=http://127.0.0.1:8000` uses a different backend address.
- `?autorun=1` runs the plan on load.

## Honesty rules the page follows

- The mode pill always shows one of: Live API, Live API with mock fallback (`optimizer_available: false`), Demo snapshots, or API offline.
- A failed request never falls back to saved results. The error is shown, and the previous results stay on screen.
- `net_profit` is labelled "contribution after transport", because the engine excludes acquisition cost.
- The temperature curve is labelled illustrative. The data has no sensor telemetry.
- After every jam, the page re-reads `GET /api/data` and warns if the server's routes changed (see the backend note below).

## Known backend issue (not changed here)

`simulate_disruption` in `backend/main.py` uses `routes_data.copy()`, which is a shallow copy. It then edits the route objects in place, so every jam permanently slows those routes until the backend restarts. The Rescue Lab detects this and says so. Fix it with `import copy` and `disrupted_routes = copy.deepcopy(routes_data)`.
