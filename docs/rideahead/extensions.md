# Extending RideAhead

Small replaceable boundaries, wired by constructor injection in `server/app/services.py`
(`Services.build_rideahead`). Contracts: `server/app/agent/models.py` (`schema_version = "1"`)
and `server/app/agent/interfaces.py`.

## New hazard type (e.g. `work_zone`)

1. Add it to `HazardType` and `DEFAULT_HAZARD_TYPES` in `models.py` (display name, persistence
   prior with a version, default impact, expected delay, match radius). Priors are labelled
   demonstration assumptions.
2. Update `OBSERVATION_EXTRACTION_PROMPT` in `prompts.py` and bump its `*_VERSION`.
3. Add any type-specific validation in the perception provider (lane C).
4. Add fixtures + engine/eval tests (lane D).
5. Optional: specialised presentation in the web island (lane B). Cards should work unchanged.

## New routing provider

Implement `RoutingProvider.candidate_routes(origin, destination, exclusions)` returning
normalised `RouteCandidate`s (primary first, `provenance` honest, `profile` set) and raising
`RoutingUnavailable` when unreachable. Select it in `build_rideahead`. `CachedRouting` wraps any
provider (in-memory cache, brief failure cache, optional recorded-response store).

## New perception provider

Implement `PerceptionProvider` (`list_rides`, `inspect_ride`, `verify_evidence`, optional
`statuses()`). Observations need ride-relative timing and `session_time_s`; the runtime reveals
them only when replay reaches them. Keep upstream access inside the provider.

## New storage

Sessions are in memory; deterministic replay rebuilds state from observations, so persistence
only needs the observation list plus config. `RIDEAHEAD_SNAPSHOTS=true` writes JSON snapshots to
`server/data/rideahead/`. A SQLite or application-owned VastDB repository can replace this
without touching perception or lifecycle logic. Never write to organiser-owned tables.

## New scenario

Add a JSON file next to `server/fixtures/rideahead/scenario.json` (origin/destination, observer
track, simulated rider, labelled synthetic events, persistence overrides, labels) and select it
with `RIDEAHEAD_SCENARIO=<file>`.
