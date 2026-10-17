# Handoff D — hazard engine, scoring and evaluation

## Current branch and commit

- Lane: **D**. Local branch `agent-d/hazard-engine-eval`.
- Based on A's frozen bootstrap `5b43e3ff7fadea685d3362da516ddd790fac2351`,
  including handoff commit `d0a2330e8f76ca66d0794a2a4ea6342d0d6b03a6`.
- D delivery is committed on this branch. The inherited scenario assertion and frontend
  dependency policy need reconciliation before claiming a fully green repository.
- The pre-existing untracked `MASTERPROMPT.md` is untouched.

## Working entry points

- `server/app/agent/hazards.py`: `build_engine(config)` returns `RuleHazardEngine`;
  `ingest(Observation) -> Hazard | None`, `snapshot(as_of_s) -> list[Hazard]`,
  `reset()` and `engine.score_routes(...)` satisfy A's runtime protocol.
- `server/app/agent/scoring.py`: frozen standalone `score_routes(...) -> Decision`;
  `hazard_on_route(...)` retained. Runtime owns revision, changed and session time.
- `hazard_adapter.py` explicitly converts canonical models; `hazard_engine.py`,
  `route_scoring.py` and `hazard_types.py` are private, network-free policy modules.
  Initial placeholders have now been integrated with A's models; no public DTO changes.
- A's services/runtime already select these entry points. No shared-file wiring edits,
  schema regeneration, dependency change, new protocol or deployment was needed.

Implementation details:

- Immutable copied inputs; deterministic event-prefix snapshots and reset/replay.
  Earlier snapshots never reuse future state. ID reuse with changed payload fails.
- Deduplication checks observation IDs, evidence IDs, exact source spans and overlapping
  ride/camera spans. Adjacent same-group chunks do not refresh the clock. A qualifying
  sustained sighting after 30 s can refresh it and confirm persistence, explicitly
  distinguished from independent observer + independent source group corroboration.
- Directed-road identity is required for lifecycle matching. Opposite bearings, distant
  anchors, ambiguous multi-hazard matches and missing geography cannot clear reports.
  Supported real clearance requires a matched verification with clear obstruction and
  visible affected road space. Explicitly labelled synthetic scenario clearance remains
  synthetic. Original aware recording timestamps are respected when both are available.
- Unknown/failed observations do not clear or refresh; conflicting supported evidence
  is disputed. Staleness never clears. Old footage retrieved later cannot reopen a
  cleared hazard. Impact remains separate from evidence strength.
- Configurable type priors, expected delay, matching radius and versioned persistence.
  Half-life output is a heuristic weight; it is never a clearance signal or probability.
- Routes compare remaining provider duration plus arrival-adjusted delay assumptions.
  Nearby/planning radii, ahead/behind and local route direction matter. Missing routes
  explicitly yield unavailable; stale/uncertain serious reports remain warnings even
  when decay is small. Ties retain the current route. Disconnected alternatives cannot
  teleport the rider onto another route.

## Checks run and results

- All lane D tests and the new cost-consistent full-runtime replay story pass.
- Full backend suite: **123 passed, 1 inherited test failed** at
  `tests/test_rideahead_api.py::test_full_story_observed_reroute_stale_cleared`:
  it expects `reroute`; the correct cost/radius decision is `heads_up` at t=60.
  See requested change below.
- `ruff format --check .`, `ruff check .`, `pyright app eval tests`: clean.
- Offline lifecycle evaluation: **15/15 simulated scenarios pass**.
- Canonical shared-fixture demo regenerated at
  `server/eval/fixtures/engine-demo.synthetic.json`; observed/stale/cleared and
  rider decisions work with canonical models and an explicit 180 s delay assumption.
- Original A runtime API tests for capability honesty, unchanged polling, rewind,
  config update and missing sessions pass.
- Windows tests require loopback socket access outside the restricted sandbox.
  A writable workspace `--basetemp` avoids restricted system temp directories.
- Full `make verify` cannot be claimed: make is absent here; locked frontend dependency
  installation is rejected by pnpm's minimum-release-age policy for six existing entries
  (`@shadcn/registry`, `cn`, `electron-to-chromium`, `eslint`, `lucide-react`, `shadcn`).
  No lockfile, package versions or package policy were changed to bypass it.
- Installed Weave SDK emits existing Pydantic deprecation warnings during its local
  evaluation test; evaluation/scorer semantics themselves pass.

## Real integrations versus fixtures

- Engine/scoring: real deterministic implementation, network-independent.
- Canonical API/runtime integration: exercised against A's **synthetic** shared fixtures.
- `eval/fixtures/clip_labels.pending.csv`: **12 planned footage slots, zero reviewed clips**.
  No footage access or human labelling has been fabricated.
- `eval/fixtures/synthetic_captions.csv`: **12 authored text fixtures**, not video evaluation.
  Structured/verified model metrics are unavailable until genuine C predictions arrive.
- `eval/fixtures/lifecycle_scenarios.json`: 15 explicit simulator truth cases, separate
  from extraction labels and not derived from persistence weights.
- `eval/reports/local.json` and `synthetic.json` contain reproducible local results.
  Real extraction precision/recall remains undefined with zero reviewed real clips.
- Weave publisher is implemented and actual SDK Evaluation semantics are tested locally.
  Current publication status is `local_only_not_configured`. No remote publication or
  sponsor inference is claimed. Trace rows exclude captions, media URLs and credentials.

## Known limitations

- A's route model has geometry but no directed road-edge IDs or segment ETAs. The canonical
  adapter labels geometry/bearing/uncertainty matching and uniform provider-speed ETA as
  approximations; nearby parallel roads may remain ambiguous. The internal policy can use
  explicit directed-road passages once those are available.
- Cross-ride chronology without original aware timestamps relies on C/A's correctly
  normalized replay/session times. Naive timestamps are not assigned the machine's timezone.
- A's `Hazard` includes observation IDs but not evidence IDs. `engine.score_routes` resolves
  them from stored observations. The standalone scorer with detached hazards returns an
  empty evidence list with an assumption, rather than mislabelling observation IDs.
- Pure engine operations do no network tracing. A's runtime already traces sessions and
  decisions; a sanitized hazard-transition trace point is still an A-owned wiring request.
- No real archive labels, live routing check, held-out accuracy, TTC, collision estimates
  or legal guarantees are introduced by lane D.

## Requested changes outside ownership

1. **A — reconcile the default demo fixture and old runtime assertion.** The default
   assumed delay is 45 s; the detour adds about 86.5 s. The first hazard is about 520 m
   ahead, outside the 200 m nearby radius. Default behavior is therefore `heads_up`,
   not an unconditional reroute. Either update the old assertion/story, or explicitly
   use a larger, labelled scenario-specific delay (D's demo/runtime test uses **180 s**).
   Do not alter the policy just to force a more expensive detour. Shared fixture/test
   ownership is respected: D has not edited either.
2. **A — optional contract extensions:** route directed-road passages + segment/provider
   arrival estimates, direct hazard evidence references, and versioned continuation-gap
   settings would remove remaining adapter assumptions. Preserve existing field names.
3. **C — supply the actual clip shortlist, reviewed footage labels and saved structured/
   verification predictions.** Include normal, negated and uncertain scenes; disclose
   overlap with prompt tuning, source IDs, model/prompt versions, calls and latency.
   Real clearance needs matching `Verification(road_space_visible=True,
   obstruction_visible=False, verdict='supported')`; missing detections are insufficient.
4. **A — sanitize and trace hazard transitions** with stable observation/hazard IDs and
   outcome only; keep authenticated media and video payloads out of trace arguments.
5. **B/A — resolve the existing frontend package-age installation policy** according to
   team policy before running and claiming the full repository verification.

Evaluation commands and input formats: [`server/eval/README.md`](../../server/eval/README.md).
