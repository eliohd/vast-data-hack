# Handoff A — integrator + runtime

## Current branch and commit

- Branch `main`. **Bootstrap contract SHA: `5b43e3f`** — B, C, D: `git pull` and build against it.

## Bootstrap contract (frozen)

| What | Where |
|---|---|
| Canonical models (`schema_version = "1"`) | `server/app/agent/models.py` |
| Provider protocols | `server/app/agent/interfaces.py` |
| Geometry helpers (haversine, projection, bearings) | `server/app/agent/geo.py` |
| Runtime (only owner of session state) | `server/app/agent/runtime.py` |
| Routing: openrouteservice + fixture + cache | `server/app/agent/routing.py` |
| Fixture perception provider | `server/app/agent/perception_fixture.py` |
| Archive perception skeleton → **lane C** | `server/app/agent/perception.py` |
| Bootstrap hazard engine → **lane D** | `server/app/agent/hazards.py` (`build_engine(config)`), `server/app/agent/scoring.py` (`score_routes`) |
| Prompts (versioned) | `server/app/agent/prompts.py` (`OBSERVATION_EXTRACTION_PROMPT`, `EVIDENCE_VERIFICATION_PROMPT`, `DECISION_EXPLANATION_PROMPT`) |
| API routes | `server/app/api/rideahead.py` |
| Generated TS types | `web/src/lib/api/schema.d.ts` (`Schemas['SessionSnapshot']` etc. via `@/lib/api/client`) |

Frozen signatures:

```
PerceptionProvider (C):  name; async list_rides() -> list[RideManifest]
                         async inspect_ride(ride_id) -> list[Observation]
                         async verify_evidence(evidence_id, question) -> Verification
                         optional: statuses() -> list[IntegrationStatus]  (overrides A's guess)
HazardEngine (D):        name; ingest(observation) -> Hazard | None   (idempotent)
                         snapshot(as_of_s) -> list[Hazard]; reset() -> None
                         score_routes(routes, rider, hazards, config, now_s) -> Decision
                         entry point: hazards.build_engine(config: SessionConfig)
RoutingProvider (A):     name; async candidate_routes(origin, destination, exclusions)
                         -> list[RouteCandidate]; raises RoutingUnavailable
```

The runtime sets `Decision.changed`, `Decision.revision` and `session_time_s`; the engine
should leave them at defaults.

## API (all under `/api/rideahead`, demo-key guard applies like the rest of `/api`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/capabilities` | – | `Capabilities` (integration status, hazard types, default config) |
| GET | `/rides` | – | `RideManifest[]` |
| POST | `/sessions` | `CreateSessionRequest {ride_id?, scenario_id?}` | `SessionSnapshot` (revision 1, t=0) |
| GET | `/sessions/{id}` | – | `SessionSnapshot` (never advances time) |
| POST | `/sessions/{id}/advance` | `AdvanceRequest {to_s}` | `SessionSnapshot`; earlier `to_s` = reset + deterministic replay; reset = `to_s: 0` |
| PATCH | `/sessions/{id}/config` | `SessionConfigUpdate {share_radius_m?, planning_radius_m?, explain_with_llm?}` | `SessionSnapshot` |

Play/pause is a browser timer calling `advance` (e.g. +5 s every 500 ms). Replay runs in 1 s
ticks server-side; `to_s` is rounded to whole seconds.

## Fixtures (all labelled synthetic)

`server/fixtures/rideahead/`
- `scenario.json` — Southwark (London) fixture story: Bike A observes `lane_blocked` at t=60,
  adjacent-chunk duplicate at t=70, Bike B (simulated) departs t=200, report stale at t=300
  (time-compressed prior, labelled), synthetic clearance at t=450, duration 600 s.
- `observations.json` — fixture rides + observations (provenance `synthetic`, source `fixture`).
- `routes.json` — two hand-drawn routes (`provenance: fixture`).
- `snapshots.json` — generated `SessionSnapshot`s at t = 0, 60, 200, 330, 450, 600
  (`make gen-api` regenerates it). **B: build the UI against these.**

## Run the stub flow

```
make dev                                    # API :8000 + web :4321
curl -s -XPOST localhost:8000/api/rideahead/sessions -H 'content-type: application/json' -d '{}'
curl -s -XPOST localhost:8000/api/rideahead/sessions/<id>/advance -H 'content-type: application/json' -d '{"to_s":60}'
```

Config (env or `server/.env`): `ORS_API_KEY` (empty → fixture routes), `RIDEAHEAD_ROUTING=auto|fixture|ors`,
`RIDEAHEAD_PERCEPTION=fixture|archive`, `RIDEAHEAD_SCENARIO=scenario.json`, `RIDEAHEAD_SNAPSHOTS=false`.

## Checks run

- `make verify`: green (ruff, pyright, 33 pytest incl. `test_rideahead_api.py`, `test_rideahead_core.py`; web prettier/eslint/astro/vitest/build).

## Real integrations vs fixtures

- Perception: **fixture** (lane C replaces via `RIDEAHEAD_PERCEPTION=archive`).
- Routing: openrouteservice adapter implemented + unit-tested with a mocked response; **no real
  ORS call made yet** (no key on this machine). Fixture routes in use and labelled.
- Hazard engine: bootstrap rule engine (lane D replaces).
- Weave: `@weave.op` on `create_session`, `advance`, `record_decision`, ORS calls; status shows
  `connected` only when `weave.init` succeeded.

## Known limitations

- Fixture geography is synthetic (Southwark, London). If the corpus is not London, lane C's
  anchor manifest will replace `scenario.json` coordinates — do not relabel footage.
- Bike B reroute switches route by projecting its position onto the new route.
- In-memory sessions (max 32), optional JSON snapshot per session; no database.

## Requested changes outside ownership

- C: implement `ArchivePerceptionProvider` (keep constructor); send prompt edits via handoff-C.
- D: replace `hazards.py` / `scoring.py` internals; keep `build_engine` + `score_routes` names.
