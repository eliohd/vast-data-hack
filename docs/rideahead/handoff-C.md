# Handoff C: archive and perception

Owner: Rishik (Claude Code). Lane: ride discovery, segment normalisation, location anchors,
candidate extraction, model verification, VSS/GPU client changes.

## Current branch and commit

- Branch `rishik/rideahead-notes`, based on `main` @ `0f564a7` (pre-bootstrap: Agent A's contract
  was not on `main` when this was written). Commit SHA: see `git log` for this file.

## Working entry points

| Path | What it is | Status |
|---|---|---|
| `server/app/perception/assertions.py` | Clause-level lane-obstruction reading of captions: `caption_assertion(caption)` returns `present / denied / hedged / adjacent / unclear / none` plus `bike_lane / lane / roadway / unknown` and the clause | Real, pure, tested |
| `server/app/perception/manifests/ride_gx010001.json` | Ride manifest: timing rules, reconstructed route, demo-section anchors, 10-segment shortlist with roles | Real corpus data; coordinates hand-placed |
| `server/tests/fixtures/gx010001_shortlist.json` | Sanitised cached captions + YOLO11 counts for the 10 shortlisted segments (no media URLs) | Cached recorded |
| `server/tests/test_perception_assertions.py` | 5 required trust cases (master prompt section 9) + all 10 real captions | 12 tests pass |

Not yet built (waiting for A's frozen models): `list_rides()`, `inspect_ride(ride_id)`,
`verify_evidence(evidence_id, question)` provider; Cosmos `ask_video` verification; W&B
`chat_json` extraction; observation/evidence objects in A's schema.

## Corpus findings (measured 2026-10-17 via VSS explore API, team-46 session)

- `nyc_bike_gopro-1`: 3 rides (streams), 78 chunks × 30 s. Ride chosen: **GX010001**, stream
  `68c66490-7e43-428d-b7af-b477ae296369`, 24 chunks (about 12 min).
- **No GPS or recording time** in segment metadata (`/api/v1/videos/metadata`). Filename and
  `upload_timestamp` are upload times. `ride_offset_s = chunk_index * 30 + segment_start_sec`
  (nominal).
- Route reconstructed from caption sign text: E 11th St (Amsterdam Billiards) → Union Square →
  W 14th St → 6th Ave north (W 29 → W 38) → Times Square area. Labelled "manually reconstructed
  route".
- **Demo section: 6th Ave northbound, W 29th → W 38th St** (chunks 11–15), protected green bike
  lane on the left. 5 anchors with 80–150 m uncertainty. Caveat: segment 13.2 says the camera
  "turns right" at W 34th (Herald Square), so north of 34th it may be Broadway.
- ~~Primary observation candidate~~ **Rejected after verification: `gx010001-c15-s1`** (ride offset ≈ 450 s, near W 38 St):
  *"A large black delivery truck is in the left lane, partially blocking the bike lane."* YOLO11
  max-per-frame counts: truck 1, car 7, bicycle 2.
- `gx010001-c15-s5` (≈ 470 s), SUV partially blocking the bike lane, is the **same ride ~20 s
  later**: continued observation, not independent corroboration.
- `gx010001-c16-s2` shows a clear bike lane but further north: it must **not** clear the c15
  hazard (different location).
- Detections endpoint returns full per-frame YOLO11 boxes (30 fps, 150 frames per segment). Its
  `segment_source` points at a `team-14-…` bucket for our segment, so the corpus is shared
  across teams; treat the detections as organiser-provided.
- Caption caveat: in this ride all "accident/collision/near-miss" mentions are negated. Real
  accident footage was not found.

## First real Cosmos verification (2026-10-17)

Cache: `server/app/perception/cache/verify_v1.json` (prompt `c-verify-lane-blocked-v1`, model
discovered from `/v1/models`, temperature 0, one call at a time, video SHA-256 recorded; no media
URLs, tokens or video bytes stored). Media fetched server-side through `VSSClient.stream_url`.

| Segment | Caption claim | Cosmos v1 | Latency | Frame review (Agent C, 3 frames) |
|---|---|---|---|---|
| `gx010001-c15-s1` | truck "partially blocking the bike lane" | **contradicted**: bike lane clearly visible and unobstructed | 4.0 s | Agrees: truck is in the adjacent traffic lane, green lane clear |
| `gx010001-c15-s5` | SUV "partially blocking the lane" | **contradicted** | 6.5 s | Agrees: SUV is in the hatched buffer, green lane clear |
| `gx010001-c16-s2` | none (control) | **contradicted** (clear lane) | 4.2 s | not reviewed |

**Result:** both caption-claimed bike-lane obstructions in the demo section are **false positives**
(vehicles beside the lane described as blocking it). This is the trust layer working, but it means
**there is no verified real obstruction yet**. Frame review is not ground truth.

Open question: three "contradicted" answers in a row could also mean the prompt is biased toward
"contradicted". A **positive control** (a clip with a vehicle actually in the bike lane) is needed
before trusting the verifier. Next step: rank `present` + `bike_lane` caption claims across all
three bike rides and verify the top few.

Weave was **not** initialised for this run (the client warned "Traces will not be logged"), so
these calls are not traced yet.

## Checks run and results

- `uv run pytest -q` (whole server): **34 passed**.
- `uv run ruff check` / `ruff format --check` / `pyright` on new files: clean.
- `make verify` (full, incl. web) not run yet.

## Real integrations versus fixtures

| Integration | Status |
|---|---|
| VSS explore / metadata / detections / stream | **Real**. Server-side `VSSClient` works from a laptop when `VSS_URL` is the public team URL (`https://team-46-vss.thecosmoslabs.com`) with the team login. `INGRESS_URL` from the team config is private (ConnectError off-VM). |
| Cosmos `ask_video` verification | **Real**: 3 calls on recorded segments, cached with provenance (see above) |
| YOLO11 endpoint | Not called; stored detections used |
| W&B Inference `chat_json` extraction | Not run yet |
| Weave | Not connected from this lane yet |

## Known limitations

- Anchor coordinates are approximate and should be checked on a map.
- The caption classifier is rules-based; it is the trust filter, not the extractor. W&B
  extraction plus Cosmos verification still has to run on top of it.
- Ride offsets are nominal. If chunks overlap, offsets drift by a few seconds.

## Requested changes outside ownership

- **A (models):** Evidence needs `segment_file` / segment ID that the server proxy can map to
  media. Keep authenticated stream URLs out of it. Observation `assertion` should allow
  `present / clear / unclear` as in the master prompt. The caption reading here also produces
  `denied / hedged / adjacent`, which map to `unclear` or "no observation" and never to `clear`.
- **A (prompts):** Add a Cosmos verification prompt: "Is a vehicle stopped in or partially in the
  green bike lane ahead? Is the bike-lane area visible? Answer JSON: {visible, obstruction:
  supported|contradicted|unclear, evidence_seconds, reason}."
- **A (config/ops):** the team config has no GPU URLs. They follow
  `http://<GPU_HOST>:8001` (Cosmos Reason), `:8002` (YOLO11), `:8003` (Embed), `:8004` (Canary).
  W&B keys are in the VM shell environment, not the config file. Laptop probe: VSS(public),
  Cosmos Reason, Embed, YOLO and W&B Inference all HTTP 200.
