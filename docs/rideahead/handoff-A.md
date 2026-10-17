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
- `scenario.json` — Southwark (London) fixture story, hazard anchor moved onto the real ORS
  primary (Southwark St east end): Bike A observes `lane_blocked` at t=60,
  adjacent-chunk duplicate at t=70, Bike B (simulated) departs t=200, report stale at t=300
  (time-compressed prior, labelled), synthetic clearance at t=450, duration 600 s.
- `observations.json` — fixture rides + observations (provenance `synthetic`, source `fixture`).
- `routes.json` — two hand-drawn routes (`provenance: fixture`).
- `snapshots.json` — generated `SessionSnapshot`s at t = 0, 60, 200, 330, 450, 600 with D's
  engine and recorded genuine ORS routes (`cached_provider`): continue → heads_up (pre-trip,
  1.3 km away) → reroute (B departs; detour +8 s) → heads_up (stale, keep alternative) →
  continue (synthetic clearance). `make gen-api` regenerates it. **B: build the UI against these.**

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
- Routing: **real openrouteservice verified** (`cycling-regular`). Tested O/D: origin
  51.5058,-0.1050 (Blackfriars Rd) → destination 51.5050,-0.0880 (Borough High St).
  Primary 1638 m / 399 s via The Cut, Redcross Way, Southwark St; provider alternative 1842 m /
  446 s; avoid-polygon detour around the hazard anchor (51.504695,-0.091513, Southwark St eb)
  1676 m / 407 s, 73 m clear of it (≈ +8 s). Opt-in check:
  `RIDEAHEAD_LIVE_ORS=1 uv run pytest -q -k live`. Genuine responses are saved to
  `server/fixtures/rideahead/routes_ors_cache.json` and replayed as `cached_provider` (status
  `cached`) when ORS is unreachable **or no key is set** (`RIDEAHEAD_ROUTING=auto`). Hand-drawn
  fixture routes only with `RIDEAHEAD_ROUTING=fixture` (tests, `snapshots.json`).
- Deploy: `make deploy` excludes `server/.env`, so the VM needs `ORS_API_KEY` in
  `~/hack/server/.env` for live routing; otherwise it replays the recorded responses (labelled).
- Hazard engine: bootstrap rule engine (lane D replaces).
- Weave: `@weave.op` on `create_session`, `advance`, `record_decision`, ORS calls; status shows
  `connected` only when `weave.init` succeeded.

## Latest commits

- `5b43e3f` bootstrap contract · `5a8b35e` live ORS + detour, recorded-response fallback ·
  `d8d97b0` no-key replay, `docs/rideahead/extensions.md`. No B/C/D commits on main yet.

## Lane D integration (merged from `agent-d/hazard-engine-eval` @ `714e4e8`)

- D's engine/scoring/eval merged unchanged; protocol entry points unchanged.
- Resolved D request 1: old runtime test expected an unconditional reroute on hand-drawn
  fixture routes (86 s detour vs 45 s assumed delay). D's cost policy is correct → test now
  expects `heads_up` there; a new offline test on recorded ORS routes asserts the reroute.
  No delay inflation.
- Resolved D request 4: `record_hazard_transition` Weave op (IDs + states only).
- Route cache keys are now geometry-only (engine hazard IDs changed to `hazard-<hash>`);
  `avoids_hazard_ids` is recomputed on every cache hit.
- Open (optional, D request 2): directed-road passages / segment ETAs / hazard evidence IDs.
- D's frontend pnpm min-release-age issue is local to D's machine; `make verify` is green here.

## Lane B + C integration (merged `agent-b/rideahead-interface` @ `77b8f8c`, `rishik/rideahead-notes` @ `c0922c2`)

- Both merged unchanged; `make verify` green (138 server, 27 web tests). B's pinned frontend
  versions accepted (B owns web deps).
- Full stack checked in the browser at phone size against the live server + live ORS:
  session creation, polling, replay, detour route, decision card, provenance strip.
- `make gen-api` now also refreshes B's offline copy `web/src/lib/rideahead/canonical-snapshots.json`
  (it was stale: hand-drawn routes, bootstrap engine).
- Prompt: `EVIDENCE_VERIFICATION_PROMPT` v2 (`rideahead-verify-2`) from C's proposal; use
  `prompts.verification_prompt(question)` (JSON braces make `.format` unsafe).
- **Corpus is NYC** (C): demo scenario must move from the Southwark fixture to an anchored
  Manhattan section once C delivers a real observation + anchor. No verified real obstruction yet.
- Evidence media: set `Evidence.segment_id` to the VSS `source` (segment file) and
  `media_ref` to `/api/archive/media?source=<segment_file>`; no contract change needed.

## Known limitations

- Fixture geography is synthetic (Southwark, London). If the corpus is not London, lane C's
  anchor manifest will replace `scenario.json` coordinates — do not relabel footage.
- Bike B reroute switches route by projecting its position onto the new route; its active
  route is always kept in `routes` (detours are requested for every non-cleared hazard).
- ORS returns a harmless warning ("Extra info requested but not available:
  roadaccessrestrictions") in `RouteCandidate.warnings`; B may tuck warnings into the evidence panel.
- Route data attribution: © openrouteservice.org | © OpenStreetMap contributors.
- In-memory sessions (max 32), optional JSON snapshot per session; no database.

## Requested changes outside ownership

- C: implement `ArchivePerceptionProvider` (keep constructor); send prompt edits via handoff-C.
- D: replace `hazards.py` / `scoring.py` internals; keep `build_engine` + `score_routes` names.
