# Handoff D — hazard engine, scoring and evaluation

## Branch and integration base

- Lane **D**, branch `agent-d/hazard-engine-eval`.
- Previous D delivery `2f9c706` is merged by A. This follow-up pulls **main `6cd6329`**.
- Accepted A's `test_hazard_runtime.py` integration edit: its London cost-policy cases
  explicitly select `scenario.json` while the app default is now NYC. No runtime,
  scenario, models, generated files, or policy changes in this follow-up.
- Read A's “Lane D integration” notes. A resolved the fixture/test mismatch without
  changing D's policy, added the recorded-ORS runtime test, and added sanitized
  `record_hazard_transition` tracing. Those requests are closed.
- Entry points and canonical models remain frozen. No D edits to runtime, scenario,
  models, generated API types, shared snapshots, dependencies, or frontend files.
- The user's pre-existing untracked `MASTERPROMPT.md` is untouched.

## 1. Cyclist-facing decision wording — complete

- `server/app/agent/decision_text.py` formats short reasons. Example:
  **“Blockage 1.3 km ahead. Take the detour; about 8 sec extra.”**
- Reasons give distance/action/time where known, express uncertain delay without
  presenting a decay heuristic as a known wait, and never invent missing distances.
- Technical explanations remain in `Decision.assumptions` (including future-support
  rejection and keeping an alternative). No action, route selection, cost, lifecycle,
  confidence, or timing-policy branch changed.
- A before/after comparison of canonical demo snapshots found every non-text decision
  field unchanged. Existing policy tests plus new display-format checks pass.
- Public entry points: `hazards.build_engine(config)`, `engine.score_routes(...)`, and
  `scoring.score_routes(...)`; A's runtime still sets changed/revision/session time.

## 2. C cached three-way comparison — inputs integrated, visual labels pending

- C's genuine cache is now on main: `server/fixtures/rideahead/cache/model_outputs_v2.json`,
  built 2026-10-17 and marked traced in `vastdata/team-46`. It contains **11 W&B extraction
  calls and 11 Cosmos verification calls on 10 unique shortlist clips**. `c14-s3` occurs twice.
- `server/eval/cached_predictions.py` adapts the saved output into D's evaluation schema.
  It uses the **first cached run per source** (same as C's provider), verifies source/caption
  alignment, rejects source identity conflicts, and accounts for all attempts separately.
  No models, media downloads or runtime operations are called by this adapter.
- Three methods: naive keyword baseline; W&B structured extraction; structured extraction
  gated by the Cosmos answer to the positive-obstruction question. Verification requires
  visible road space and agreement between extraction/verdict/obstruction visibility.
  Disagreement or an uncertain extraction abstains. An absence result is only a clip-level
  extraction answer, never a lifecycle clearance event.
- C's manifest/frame-review support values are **not inputs** to the methods being scored.
  In particular, the three c15 positive model agreements remain positive predictions even
  though C's AI frame review disagrees. This avoids improving scores using review answers.
- Ran the comparison via `--model-cache`; see `server/eval/reports/c-cache-comparison.json`.
  Prediction counts across the ten clips:

  | Method | Present | Absent | Uncertain |
  |---|---:|---:|---:|
  | Keyword | 5 | 5 | 0 |
  | Structured | 4 | 4 | 2 |
  | Structured + Cosmos | 3 | 3 | 4 |

- **These counts are not accuracy.** The ten CSV rows remain `status=pending`, with expected,
  reviewer and review-date fields blank. The user supplied a demo key privately, but the
  documented public URL `https://hack.elio.ltd` is unreachable from this machine; no
  alternate deployment URL or independently human-reviewed labels are available yet. All accuracy/precision/recall values
  therefore remain null, with zero reviewed clips explicitly recorded.
- Cached timings describe the original model calls (11.539 s total extraction; 48.490 s
  total verification), not replay latency. Verified-pipeline cost includes extraction;
  do not add structured and verified totals together. The duplicate is excluded from
  sample scoring but retained in the executed-call totals.
- `DEMO_KEY` is now configured privately; app health and media-proxy connection checks
  both returned `ConnectError` at the documented URL. Await C's reachable deployment URL.
  Agent visual review, if performed, must be identified as AI review;
  it must not be represented as independently human-labelled ground truth.
- Existing pinned C caption/v1 caches under D's `eval/fixtures/c_inputs/` remain as historical
  provenance; the new adapter reads C's current shared v2 cache directly without editing it.

## 3. Lifecycle publication — personal receipt verified; team access denied

- The user configured this machine's own ignored `server/.env`. Corrected the team
  settings-page URL to the authenticated account's default team, preserving the key
  and project. No credentials were printed, committed or borrowed from another lane.
- Published with `python -m eval.run --publish-weave --output eval/reports/local.json`.
- [Saved Weave evaluation](https://wandb.ai/eliohd-ucl/cysense/r/call/01a149cf-d231-742c-bb0b-9cdfea9f93a7):
  **21/21 synthetic lifecycle scenarios pass**. Authenticated SDK read-back confirmed
  the completed `Evaluation.evaluate` call, no exception, `true_count=21`, and
  `true_fraction=1.0`. The saved aggregate operation independently reports 21/21.
- `server/eval/reports/local.json` records `published_verified` with the durable call
  reference. The command itself still returns `submitted_unverified` until a separate
  remote read-back is performed; this receipt was verified after upload.
- Requested team migration to `vastdata/team-46`: attempted with this machine's own key.
  W&B rejected it: **the provided API key cannot access this resource**. No shared-team
  publication or success is claimed. `eval/reports/team.json` preserves local results and
  records `local_only_publication_failed`; the earlier personal receipt is unchanged.
- Local ignored `.env` now targets `WANDB_TEAM=vastdata`, `WANDB_PROJECT=team-46`, with
  existing API key preserved. The user does not have a team-authorized replacement key.
  **A/team:** grant account `eliohd` access or run the documented publication command
  using your own already configured team environment. Do not copy keys into chat/handoffs.
  Retry/read-back after access is resolved.
- These are deterministic scenario results, not real-video extraction accuracy.
  Recorded clip labels remain pending. Weave's model latency measures replay harness
  execution here, not video-model inference.
- Publication includes hashed IDs, labels, provenance, saved answers and metrics;
  captions, reviewer names, credentials and media URLs are excluded. Code capture
  and automatic integrations are disabled.

## 4. Extra lifecycle cases — complete locally

- Expanded independent scenario truth from **15 to 21 cases**. New cases cover:
  opposite-direction clearance, conflicting bearing on the same directed ID, a parallel
  road at the same synthetic coordinates, independent corroboration becoming stale,
  different observers sharing a source group, and renamed observers sharing evidence.
- The evaluator now also checks authored `expected_strengths` where supplied, so source
  independence is assessed separately from state/action.
- **21/21 synthetic scenarios pass**, including deterministic reset/replay. No model
  estimates serve as ground-truth labels. These are scenario tests, not real-video accuracy.
- Real clip input and publication blockers from steps 2–3 were recorded before doing
  this independent local test work. Personal publication is verified; team access and clip inputs remain open.

## Verification

- Ran actual `make verify` through installed MSYS make/bash. First pass exposed local
  auth settings and Windows cp1252 decoding in C-owned cache readers. Retried with
  child-process `DEMO_KEY=` / `TRACING=false` and `PYTHONUTF8=1`; no product code changes.
- Server: ruff format/lint and pyright clean; **164 pytest passed, 1 live ORS test skipped**.
  This includes six new cache-evaluation tests: source dedup/call accounting, disagreement,
  no frame-review leakage, no fabricated pending-label accuracy, source/caption rejection,
  and reviewed-subset selection. Existing Weave Pydantic deprecation warnings remain.
- Main's updated locked frontend dependencies now install successfully; the earlier
  package-age/missing-prettier blockers are closed. No dependency or lockfile edits by D.
- Exact `make verify` stops at frontend Prettier because the Windows checkout has CRLF
  in 54 tracked frontend files. **No files were reformatted.** Supplemental read-only
  `prettier --check . --end-of-line auto` passes, followed by unchanged eslint, Astro
  diagnostics (zero), **27/27 web tests**, and a successful production build. Existing
  dependency annotation warnings are non-failing. This is distinct from claiming an
  unmodified `make verify` pass on Windows; A's Linux verification remains authoritative.
- D-owned comparison/team-attempt reports are saved; A-owned generated API/types/shared
  snapshots are untouched. The untracked user `MASTERPROMPT.md` and ignored `.env`
  remain outside the commit. Reproducible evaluation commands are in `server/eval/README.md`.

## Remaining requests outside ownership

1. **C/user:** reachable deployed public app URL (`DEMO_KEY` is now supplied privately),
   or independently reviewed labels for the ten shortlist clips. Saved model outputs
   are now integrated; the old structured-output request is closed.
2. **User/team:** grant the configured W&B account access to `vastdata/team-46`, or supply
   an authorized key privately in `.env`, so the lifecycle evaluation can be republished.
3. **A:** optional road passages, segment arrival times and hazard evidence-ID contract
   extensions stay **deferred**, as instructed. No request to change the frozen models.
