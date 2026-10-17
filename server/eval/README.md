# RideAhead evaluation — lane D

The engine is integrated with Agent A's canonical contract at bootstrap `5b43e3f`
and merged integration `b550ebb`. Public entry points remain `hazards.build_engine(config)`
and `scoring.score_routes(routes, rider, hazards, config, now_s)`. The runtime already
uses them; no wiring, dependency, API schema or WebSocket changes are required.

Run these commands from `server/`:

```sh
uv run python -m eval.demo --output eval/fixtures/engine-demo.synthetic.json
uv run python -m eval.run --output eval/reports/local.json
uv run python -m eval.run --synthetic --output eval/reports/synthetic.json
uv run python -m eval.run --labels eval/fixtures/clip_labels.reviewed.csv --predictions eval/predictions.jsonl --publish-weave
uv run pytest tests/test_hazard_engine.py tests/test_route_scoring.py tests/test_hazard_contract.py tests/test_hazard_runtime.py tests/test_rideahead_eval.py -q
uv run ruff format --check .
uv run ruff check .
uv run pyright app eval tests
```

The demo uses **Agent A's shared synthetic observations and routes**, a stationary
simulated rider, a **180-second assumed delay**, and compressed freshness. It shows
observed → stale → cleared using canonical models. Everything is labelled synthetic;
there is no recorded footage or genuine inference in this demonstration.

## Actual footage labelling

`fixtures/clip_labels.pending.csv` contains **10 sourced clips, zero reviewed labels**.
These replace the original empty selection slots with C's published GX010001 shortlist
from `rishik/rideahead-notes` at `c0922c221424b639b0153f3d50a80b08fda61dc2`.
Sanitized captions and Cosmos caches are preserved under `fixtures/c_inputs/`, with
source provenance. The caches contain no footage or playable authenticated media.
Fill a reviewed copy after watching the supplied clips; do not turn captions or model
verification answers into ground-truth labels.

1. Get playable footage or independently reviewed labels for the ten sourced segment
   IDs from C. The shortlist includes negated, ordinary and ambiguous captions.
   Do not download internet footage.
2. Watch each clip independently of its model answer. Enter source/ride IDs, clip start
   and end, source caption, reviewer and review date; use `status=reviewed` only then.
3. Label `expected` as `present`, `absent` or `uncertain`. Set `negated_caption` and
   `development_overlap` to the literal CSV values `true` or `false`. Record overlap
   with development/prompt-tuning clips; no held-out accuracy claim is made here.
4. Keep `provenance=recorded`. A clear lane is a visual absence label; it does **not**
   automatically become a lifecycle clearance observation.
5. Obtain saved extraction and verification predictions from C. The runner calls no
   models and never generates answers from the expected labels.

C's source cache has eight actual Cosmos checks (three overlap the ten shortlisted
clips), but C explicitly reports W&B `chat_json` extraction has not run. Its AI frame
reviews are marked `ground_truth=false`. No three-way extraction accuracy can be
reported until independent labels and structured extraction predictions exist.

`fixtures/synthetic_captions.csv` has 12 authored **text fixtures**, not video labels.
They exercise negation and abstention handling. The naive keyword baseline is deliberately
susceptible to negation. The structured and verified methods stay `unavailable` until
actual predictions are supplied; fixture predictions cannot be counted as real inference.

## Prediction input

JSONL contains one row per `(sample_id, method)`; duplicates and mismatched sources fail.
`method` is `structured` or `verified`. Use genuine model/prompt versions, `assertion`
(`present`, `clear`, `unclear`), `support` (`supported`, `uncertain`, `contradicted`),
and `provenance` (`recorded`, `cached_recorded`, `synthetic`). All rows also require
`source_segment_id`, nonnegative `model_call_count` and finite nonnegative `latency_ms`.

Example **synthetic** row (format only; not an integration result):

```json
{"sample_id":"synthetic-01","source_segment_id":"synthetic-segment-01","method":"structured","assertion":"present","support":"supported","model_id":"fixture-no-model","prompt_version":"format-example-v1","model_call_count":0,"latency_ms":0,"provenance":"synthetic"}
```

For a measured run, `model_call_count` and `latency_ms` describe the work used to produce
that method's answer. Verified rows include the full extraction + verification pipeline;
do not add structured and verified totals together. For cached replay, distinguish original
run measurements from replay measurements in the associated experiment notes. Do not invent
missing timing or call measurements to complete a row.

Reports contain precision/recall for `present`, three-label accuracy, negation false
positives, sample/coverage counts, model calls and supplied latency. Missing predictions
are abstentions and count as false negatives for positive labels; they never count as
correct uncertain predictions. Undefined precision/recall is JSON null. Partial results
and missing predictions remain visible.

## Lifecycle truth and route scoring

`fixtures/lifecycle_scenarios.json` contains 21 explicit simulated expectations covering
duplicates, adjacent chunks, independent/continued sightings, stale versus clear,
opposite/parallel roads, hidden future clearance, occlusion, provider failure, route
changes and passed reports. Every scenario also checks deterministic reset/replay.
These are authored scenario labels, **not outputs of the persistence heuristic**.
Six additional cases check opposite-direction and conflicting-bearing clearance,
parallel roads at the same synthetic anchor, independent corroboration followed by
staleness, shared source groups, and duplicated evidence under another observer.
Cases can assert `expected_strengths` independently of lifecycle state and action.

Additional unit and canonical/runtime integration tests check immutable inputs, ID
reuse, conflicting evidence, source chronology, future evidence, route costs, ETA,
uncertainty at arrival, disconnected alternatives and genuine evidence IDs.

The internal policy can consume explicit directed-road passages. A's frozen provider
model currently contains geometry only. The canonical adapter therefore uses a labelled
geometry/bearing/uncertainty proxy, with uniform speed over provider duration. It cannot
prove street identity for nearby parallel roads; missing bearing/location is uncertain.
Provider edge IDs and segment durations should be added by A as optional fields for
stronger matching. Alternatives more than 5 m from the rider's position are rejected;
the engine cannot manufacture a connector. The shared current route is measured along
its geometry, matching A's rider-progress convention.

`Hazard` has observation IDs but no evidence list. Call `engine.score_routes` in the
runtime to resolve real evidence IDs. The standalone frozen scorer returns an honest
empty evidence list for detached hazards; it never substitutes observation IDs.

## Weave

`--publish-weave` uses existing `Settings` (`WANDB_API_KEY`, W&B team/project and tracing
enabled). It publishes actual Weave `Evaluation`s for supplied predictions and lifecycle
results plus an aggregate metrics operation. Publication rows contain hashed source/sample
IDs, labels, provenance and saved answers; captions, human reviewer names, media URLs and
credentials are not passed to traced operations. Code capture and automatic integrations
are disabled for this command.

Local reports are saved **before** publication. Missing configuration is
`local_only_not_configured`; errors are `local_only_publication_failed` without exception
text. A completed SDK upload is `submitted_unverified`, because it supplies no durable
remote read-back receipt. This is not represented as confirmed publication. There are no
configured W&B credentials here, so the recorded run remains local.

## Integration and verification

A resolved the earlier fixture assertion mismatch in `b550ebb`, preserving the cost policy
and adding an offline API test with recorded genuine ORS routes. A also added sanitized
hazard-transition tracing. D's cyclist-facing wording now gives distance, action and time
cost, with technical explanations in assumptions; actions and numeric outputs are unchanged.

Run `make verify` from the repository root. On this Windows machine, its server stage passes
but frontend installation is blocked by the local pnpm minimum-release-age policy for six
existing locked dependencies. No policy or dependency versions are changed to bypass it.
