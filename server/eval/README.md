# RideAhead evaluation — lane D

The engine is integrated with Agent A's canonical contract at bootstrap `5b43e3f`
and merged integration `b550ebb`. Public entry points remain `hazards.build_engine(config)`
and `scoring.score_routes(routes, rider, hazards, config, now_s)`. The runtime already
uses them; no wiring, dependency, API schema or WebSocket changes are required.

Run these commands from `server/`:

```sh
uv run python -m eval.demo --output eval/fixtures/engine-demo.synthetic.json
uv run python -m eval.run --output eval/reports/local.json
uv run python -m eval.run --model-cache fixtures/rideahead/cache/model_outputs_v2.json --output eval/reports/c-cache-comparison.json
uv run python -m eval.run --labels eval/fixtures/clip_labels.ai.csv --model-cache fixtures/rideahead/cache/model_outputs_v2.json --output eval/reports/ai-visual-reference.json
uv run python -m eval.run --synthetic --output eval/reports/synthetic.json
uv run python -m eval.run --publish-weave --output eval/reports/local.json
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

C's current `fixtures/rideahead/cache/model_outputs_v2.json` contains **11 W&B extraction
and 11 Cosmos calls, traced in `vastdata/team-46`, for ten unique clips**. Use `--model-cache`
to read it directly. This option and `--predictions` are mutually exclusive. The cache
adapter checks the CSV source IDs/captions, takes the first run per source, and records the
extra attempt and its cost without counting it as a second sample.

The keyword method searches the original caption. Structured uses the saved W&B assertion
and support. Verified requires that extraction and Cosmos agree, with road space visible:
`present + supported verdict + obstruction_visible=true`, or
`clear + contradicted verdict + obstruction_visible=false`. Other combinations abstain.
C's frame reviews and manifest support are excluded from these prediction methods.
This policy evaluates clip-level extraction; an absent clip does not clear a hazard.

The checked-in comparison records prediction coverage/distributions for all ten clips.
Only rows marked reviewed in the label CSV contribute to accuracy. Pending clips retain
null accuracy/precision/recall; outputs are never converted into expected labels. A visual
review by an AI agent must be identified as such and cannot be claimed as independent human
review. Use independently human-reviewed labels for human-ground-truth accuracy.

`fixtures/synthetic_captions.csv` has 12 authored **text fixtures**, not video labels.
They exercise negation and abstention handling. The naive keyword baseline is deliberately
susceptible to negation. The structured and verified methods stay `unavailable` until
actual predictions are supplied; fixture predictions cannot be counted as real inference.

## Sampled AI visual references (separate from human labels)

The ten clips are playable through `https://cysense.elio.ltd/api/archive/media?source=...`
with the privately configured demo key. Provide another clip's segment ID or filename
and relevant seconds; signed VAST stream URLs and downloaded videos are unnecessary.

`fixtures/clip_labels.ai.csv` contains ten **AI sampled-frame reference labels**, based
on browser-decoded frames at 0.1, 2.5 and 4.8 s per clip: seven absent, three uncertain,
zero positive controls. Method, notes, reviewer kind and timestamps are explicit;
`clip_reviews.ai.provenance.json` records limitations and the source cache checksum.
This is not full-motion review, independent human ground truth or a held-out dataset.

Run the AI-reference command above to reproduce local agreement: keyword 3/10,
structured 6/10, structured + Cosmos 6/10. Ordinary accuracy/precision/recall fields are
null; comparison values appear only under `ai_visual_reference`, with `label_agreement`.
No positive examples means recall is undefined. Human/AI references cannot be mixed.
The human-review sheet remains pending; new human CSVs may omit `reviewer_kind` (human
is the backward-compatible default). AI rows must explicitly identify kind, method and notes.

The review page hid captions/answers, but the reviewer had prior development context.
Vehicles beside a green lane are not evidence of occupying it; generic caption language
such as “No clear violations” does not negate a lane-obstruction claim. Absence at another
location is not clearance. No media bytes or credentials are committed.

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
remote read-back receipt. This is not represented as confirmed publication by the command.

The current checked-in report has a separately verified remote receipt:
[21/21 lifecycle scenarios in Weave](https://wandb.ai/eliohd-ucl/cysense/r/call/01a149cf-d231-742c-bb0b-9cdfea9f93a7).
Authenticated SDK `get_call` read-back confirmed a completed `Evaluation.evaluate`, no
exception, and `scenario_correct.correct` values `true_count=21`, `true_fraction=1.0`.
The report therefore records `published_verified` with that call ID and URL. A fresh
command run replaces this receipt until its new upload is independently verified.
These are synthetic lifecycle results; zero recorded clips have reviewed labels.
Weave model latency here measures deterministic replay, not video inference.

To target the shared project without using the personal default (POSIX shell):

```sh
WANDB_TEAM=vastdata WANDB_PROJECT=team-46 uv run python -m eval.run --model-cache fixtures/rideahead/cache/model_outputs_v2.json --publish-weave --output eval/reports/team.json
```

On PowerShell, set `$env:WANDB_TEAM='vastdata'` and `$env:WANDB_PROJECT='team-46'` before
running the same Python command. Keep API keys in the ignored local `.env`.
The current attempt is `local_only_publication_failed`: W&B denied the configured key
access to `vastdata/team-46`. Team membership/key access must be fixed before retrying;
the verified personal receipt above is retained, not relabelled as a team upload.

## Integration and verification

A resolved the earlier fixture assertion mismatch in `b550ebb`, preserving the cost policy
and adding an offline API test with recorded genuine ORS routes. A also added sanitized
hazard-transition tracing. D's cyclist-facing wording now gives distance, action and time
cost, with technical explanations in assumptions; actions and numeric outputs are unchanged.

Run `make verify` from the repository root. For isolated tests, use `DEMO_KEY=` and
`TRACING=false` in the child process; use `PYTHONUTF8=1` on Windows because C's shared
cache readers currently rely on the platform default encoding. Do not change the deployed
key in `.env` to run tests.

Current server result: **169 passed, 1 skipped**, clean ruff and pyright. Main's locked web
dependencies now install successfully. Exact `make verify` stops on Windows CRLF formatting;
the read-only override `pnpm exec prettier --check . --end-of-line auto` passes. Unchanged
frontend lint, Astro diagnostics, **27 tests** and the production build all pass. No frontend
source, dependency policy, lockfile or generated shared artifact was edited by D.
