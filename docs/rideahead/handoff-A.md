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

## NYC demo (default): C's real perception + labelled synthetic hazard

Merged C `70e8212` (ArchivePerceptionProvider, traced W&B + Cosmos cache) and D `2f9c706`
(cyclist wording, Weave-published lifecycle eval). Defaults now: `RIDEAHEAD_PERCEPTION=archive`,
`RIDEAHEAD_SCENARIO=scenario_nyc.json` (`nyc-6th-ave-v2`).

- Clock: session t=0 = ride offset 340 s of GX010001 (C's convention). Bike A track = C's anchors
  W 29 → W 39 St (±60–150 m, "manually reconstructed route").
- Real data: C's 5 reviewed observations appear at t=85–135 (2 uncertain, 3 contradicted by
  verification). **None creates a hazard** — this is the trust layer, shown in the evidence panel.
- Demo hazard = **synthetic scenario event** at t=160, 6th Ave & W 31st St (map-matched onto ORS
  geometry, ±30 m, `manhattan-6th-ave:nb`, 29°), observer `scenario`, labelled. Synthetic
  clearance at t=480. Not placed at C's suggested W 38–39 St spot because (a) the recorded clips
  there show the lane clear, (b) ±80 m fails D's relevance rule (offset + uncertainty ≤ 40 m),
  (c) the real ORS detour there is poor (+151 s around-the-block, 32 m clear; +215 s via 8th Ave
  with a 50 m area) vs +39 s via Broadway at W 31st (61 m clear).
- Real ORS: endpoints snapped onto the 6th Ave line (40.744753,-73.991456 near W 26th →
  40.752944,-73.985484 near W 39th) so turn-by-turn is clean: primary 1041 m / 208 s
  (depart on 6th Avenue → arrive); detour 1212 m / 247 s (right W 30th → sharp left Broadway →
  left W 32nd → right 6th Ave), 74 m clear of the hazard, ≈ +39 s. Recorded with steps.
- Bike B departs t=320. Decisions (D's engine): t=160 heads_up "Blockage 400 m ahead…" → t=390
  slow "Possible blockage 100 m ahead…" → t=400 stale, still slow (stale ≠ clear) → t=420 past it →
  t=480 cleared/continue.
  No reroute: brief obstruction vs +39 s detour; not forced.
- Runtime hardening: an observation the engine rejects (ValueError) is logged as an event and
  skipped instead of failing `advance` with a 500.
- Integration edits in other lanes' tests (data moved under them): `tests/test_api.py`
  `make_settings` defaults to fixture perception; `test_hazard_runtime.py` pinned to
  `scenario.json`; B's `rideahead.test.ts` (clearance at t=480) and `rideahead-connection.test.ts`
  (t160 frame; synthetic evidence has no media path, recorded evidence gets the proxy path).
- `snapshots.json` / B's `canonical-snapshots.json`: archive perception + recorded ORS, frames
  t0, 60, 140, 160, 300, 400, 450, 480, 660.
- Deploy is run by lane C per `docs/rideahead/deploy-runbook.md`; A picks the SHA.

## Second scenario: real recorded work zone (Broadway & Walker St)

- `scenario_broadway.json` → `nyc-broadway-work-zone-v1`, ride `nyc_streets_cam-1:walker-st`.
  Select with `POST /sessions {"scenario_id": "nyc-broadway-work-zone-v1"}` or that `ride_id`.
  `GET /capabilities` lists `scenarios` (first = default 6th Ave). Extra scenarios come from
  `RIDEAHEAD_EXTRA_SCENARIOS` (default `["scenario_broadway.json"]`).
- Evidence: lane C's two recorded clips (`walker_work_zone_v1.json`), Cosmos `supported`
  (prompt `c-verify-work-zone-1`, now `WORK_ZONE_VERIFICATION_PROMPT` in prompts.py), frame review
  agrees. Bundled as `Scenario.cached_observations` (source `cached_model`, evidence
  `cached_recorded`, proxy `media_ref`); used only when the perception provider returns nothing
  for this ride, so C's provider takes over if it emits them.
- Location: intersection geocoded (ORS) and map-matched onto Broadway, ±30 m, `manhattan-broadway:sb`,
  213°. C's hand pin was ~45 m off. Timing nominal from filenames: clips at session t=60 and t=1489
  (~24 min apart, same camera → persistence, not independent). No clearance (no later footage).
- Real ORS: 40.719895,-74.001462 → 40.717412,-74.003564 (Broadway, near Canal → south of White).
  Primary 328 m / 66 s through the work zone; provider alternative = avoid-area detour 601 m / 120 s
  (Canal → Lafayette → White → Broadway). ORS prefers Lafayette from further north, so the trip is short.
- Story (D's engine): see "Mid-journey rerouting" (B departs t=40, reroute from its position at
  t=60) → t=1489 confirmed (persistence). Observer is a fixed street camera, labelled.

## Mid-journey rerouting

- Detours were only requested origin → destination, so after Bike B passed the original turn-off
  the engine (correctly) refused to "teleport" it onto them. The runtime now also requests a
  detour **from Bike B's exact position** when: B is riding, a non-cleared hazard is still ahead on
  B's active route, and no candidate B can join (≤ 5 m, the engine's rule) avoids it. Throttled to
  one request per 15 s of session time unless the hazards ahead change. Ticks are whole seconds,
  so replay is deterministic and hits the same recorded keys (VM has no ORS key).
- Broadway: Bike B departs t=40; at t=60 (work zone observed) B is 84 m down Broadway, past the
  Canal St turn-off → detour from B's position (around the block to Canal → Lafayette → White →
  Broadway, includes two short unnamed provider connectors) → **reroute** "Blockage 60 m ahead.
  Take the detour; about 1 min 40 sec extra." Real recorded evidence, no forced numbers.
- 6th Ave: current-position detours are fetched at 328 m and 391 m (past W 30th St); D's engine
  keeps `slow` (brief obstruction). Offline replay matches live exactly.
- Test: `tests/test_rideahead_midroute.py` (hazard appears after departure, reroute from current
  position, continuous movement, deterministic rewind).

## Integration round (main `a32f559`)

- C `f31cc00`: deployed `ea6fd79` to https://cysense.elio.ltd, both scenarios smoke-tested, Walker
  clips 206 video/mp4, Weave connected. **Evaluation published to `vastdata/team-46`**
  (https://wandb.ai/vastdata/team-46/r/call/01a14a2b-0087-750e-906e-1f38257e5652): lifecycle 21/21
  (synthetic ground truth); video interpretation not scored (0 reviewed labels, 10 pending).
- D `61184e0`: test that the recorded Broadway evidence has no future leakage / no duplicate clock
  refresh; **plus a scenario picker in B's web files** (`RideAheadApp.tsx`, `connection.ts`, B's test)
  — outside D's lane, merged because it is small, typed and backward compatible. B owns it now:
  keep or replace, don't duplicate.
- Live site still on `ea6fd79`; `a32f559` adds D's picker (web) — redeploy to get it.

## Navigation contract additions (for B's map, optional fields, backward compatible)

- `RouteCandidate.steps: RouteStep[]` — `instruction`, `street_name?`, `maneuver_type`
  (depart/arrive/straight/left/right/slight_*/sharp_*/keep_*/u_turn/roundabout_*/unknown),
  `distance_m`, `duration_s`, `start_index`/`end_index` into `geometry.coordinates`. From ORS
  `instructions=true`; recorded in `routes_ors_cache.json`; `[]` for fixture routes.
- `Rider.distance_remaining_m`, `duration_remaining_s` (provider duration scaled by remaining
  distance), `next_step_index`, `distance_to_next_step_m` — set by the runtime for Bike B on its
  active route each tick; null when unknown. The browser must not estimate these.
- No CSP is set anywhere (server, Astro, tunnel), so the OpenFreeMap basemap can load.

## Deploy status

- C deployed `6cd6329` to the lab VM (quick tunnel; smoke test identical to local; Weave
  `connected`, routing `cached`, VSS/Cosmos/YOLO/W&B upstreams ok). Report in `handoff-C.md`.
- Merged C `113de70`: media proxy maps S3 `binary/octet-stream` to `video/mp4` by extension
  (iOS Safari playback). Fixed deploy scripts: `VM_DIR` defaults to `hack` (relative to the
  remote home; `~/hack` was expanded on the laptop); `vm-run.sh` health check retries for 60 s.
- **Next deploy SHA: see `git log -1` on main after this commit** — redeploy together with the
  switch to the named tunnel `hack.elio.ltd`.

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
