# Handoff D — hazard engine, scoring and evaluation

## Branch and integration base

- Lane **D**, branch `agent-d/hazard-engine-eval`.
- Previous D delivery: `714e4e8`, merged by A. This follow-up pulls **main `b550ebb`**.
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

## 2. C shortlist, reviewed labels and extraction comparison — partial, inputs needed

**C source located:** branch `rishik/rideahead-notes`, commit
`c0922c221424b639b0153f3d50a80b08fda61dc2`, `docs/rideahead/handoff-C.md`.

- Obtained C's ten GX010001 segment references, full cached captions, source filenames,
  nominal offsets and stored YOLO counts. `eval/fixtures/clip_labels.pending.csv` now
  has those **10 real source rows**, replacing the old empty template slots.
- The CSV preserves `expected`, reviewer and review-date blanks with `status=pending`.
  **Zero footage labels are represented as reviewed.** Negated-caption flags are text
  metadata; they do not establish that a lane is physically clear.
- Copied the sanitized C caches to D-owned `eval/fixtures/c_inputs/`, alongside a
  provenance record pinning source paths and commit. No footage, tokens or authenticated
  media URLs were copied; no C-owned files were edited or merged.
- C has eight real cached Cosmos checks, three on the ten shortlist clips. C's AI
  frame reviews explicitly say `ground_truth=false`; they are not independent human
  labels. Several caption claims and Cosmos votes conflict. No clean positive control
  is established, and an uncertain parked-car candidate is outside the anchored ride.
- C's handoff explicitly says **W&B `chat_json` extraction has not run**. The Cosmos cache
  is a verifier result, not a substitute for W&B structured extraction predictions.
- Therefore the real extraction comparison remains **unavailable**, not successful:
  no actual clip pixels/playable media or reviewed ground truth are available here,
  and the structured predictions are missing. No labels or accuracy are fabricated.
- C/A request: provide the ten playable clips through the authorized media route (or
  independently reviewed labels), plus saved structured and verified pipeline outputs
  with source IDs/model/prompt versions/call counts/latency. See `server/eval/README.md`
  for the accepted JSONL schema. Keep future clear-lane footage at another location
  separate from clearance of an earlier obstruction.

## 3. Lifecycle evaluation publication — complete, remote read-back verified

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
  this independent local test work. Publication is now verified; clip inputs remain open.

## Verification

- Actual **`make verify`** invoked through the installed MSYS make/bash toolchain.
- Server stage: ruff formatting/lint and pyright clean; **138 pytest passed, 1 live ORS
  test skipped**. Installed Weave emits existing Pydantic deprecation warnings.
- Publication follow-up verification: server formatting/lint/type checks still pass,
  with **138 tests passed, 1 skipped**. The frontend stage reaches `pnpm verify`
  through a temporary Windows shell adapter but stops because `prettier` is absent.
- Earlier frontend dependency installation was blocked locally by
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` for six unchanged locked packages:
  `@shadcn/registry`, `cn`, `electron-to-chromium`, `eslint`, `lucide-react`, `shadcn`.
  No supply-chain policy override or lockfile/package change was made. A reports its
  own full verification green; this local frontend limitation is still distinct.
- D-owned reports and the synthetic demo fixture are regenerated; A-owned generated
  OpenAPI/types/shared snapshots are untouched. Evaluation commands and formats are in
  `server/eval/README.md`.

## Remaining requests outside ownership

1. **C/A:** actual playable shortlist footage or independently reviewed labels, and W&B
   structured/cached pipeline predictions, as described in step 2.
2. **A (optional contract extensions):** directed-road passages, segment ETAs, direct
   hazard evidence references and versioned continuation-gap settings. Existing
   geometry/bearing/anchor-uncertainty and uniform-speed approximations remain labelled.
3. **A/B:** run full frontend verification in the approved team environment or resolve
   this machine's package-age restriction under team policy. D has not changed it.
