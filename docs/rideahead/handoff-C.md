# Handoff C: archive and perception

Owner: Rishik (Claude Code). Lane: ride discovery, segment normalisation, location anchors,
candidate extraction, model verification, VSS/GPU client changes.

## Current branch and commit

- Branch `rishik/rideahead-notes`, rebased on `main` @ `5fd686f`. See `git log` for the head.

## Real anchored obstruction: Broadway & Walker St work zone (2026-10-17)

This is the only candidate in the corpus with a cross-street readable **inside the clip** and a model-supported
obstruction. It is a **work zone** (`hazard_type="work_zone"`), not a parked vehicle, and it comes from a
**fixed street camera** (`nyc_streets_cam-1`), not a bike.

- Clips: `20261008_065931_VID_20261006_174811_003_chunk_0004_segment_006_of_006.mp4` and
  `20261008_065146_VID_20261006_171812_002_chunk_0017_segment_002_of_006.mp4`. Filenames suggest
  recordings at 2026-10-06 17:18 and 17:48, about **30 min apart, same camera**. That is continued observation
  (persistence), **not** independent corroboration.
- Cosmos Reason (prompt `c-verify-work-zone-1`, a lane C proposal for `prompts.py`), Weave-traced: **supported
  on both** ("red plastic barriers and orange traffic barrels on the road surface… a cyclist would have to go
  around them"). Flagger seen in c04-s6. Readable signs reported by the model: **Walker St, 401, UNIFORM**.
- Frame review (Agent C, 2.5 s frames): agrees. Red Jersey-style barrier and orange barrels in the Broadway
  roadway/crosswalk; "Walker St" street sign and "401" building number readable; flagger with orange flag in c04-s6.
- **Anchor: Broadway at Walker St, Manhattan, approx. 40.7192, -74.0024, ± 30 m** (401 Broadway is at
  the Walker St corner; verify the pin on a map). Broadway is one-way southbound here: suggested
  `road_segment_id` `manhattan-broadway:sb`, bearing ≈ 209°.
- Cache: `server/fixtures/rideahead/cache/walker_work_zone_v1.json` (caption, YOLO counts, Cosmos output,
  model + prompt version, video SHA-256; no URLs).
- Not yet emitted by `ArchivePerceptionProvider` (that needs a scenario/ride on Broadway, A's call). If A wants
  it, C can add it as a second ride (`nyc_streets_cam-1`) with `work_zone` observations.

## Deploy report (current: ea6fd79, both scenarios, 2026-10-17 ~14:01 UTC)

- **Deployed SHA: `ea6fd79`** (`main`); `make verify` green (server 174 passed / 1 skipped, web 61 passed).
  `make deploy VM=bc-rishiksiripurapu`; named tunnel left running. **URL: https://cysense.elio.ltd**.
- Capabilities: scenarios `nyc-6th-ave-v2`, `nyc-broadway-work-zone-v1`; vast/cosmos/yolo/wandb_inference
  `cached`, **weave `connected`**, routing `configured` (no ORS key on the VM, so routes are `cached_provider`).

Smoke test against https://cysense.elio.ltd (demo key read on the VM, never printed):

```
--- 6th Ave (default)
140.0 [] ['continue'] {'cached_provider'}
160.0 [('lane_blocked', 'observed', None)] ['heads_up'] {'cached_provider'}
400.0 [('lane_blocked', 'stale', None)] ['slow'] {'cached_provider'}
480.0 [('lane_blocked', 'cleared', None)] ['continue'] {'cached_provider'}
--- Broadway (scenario_id nyc-broadway-work-zone-v1)
60.0 [('work_zone', 'observed', None)] ['reroute'] {'cached_provider'}
   event: "1 detour(s) from Bike B (simulated)'s position (84 m along)"
   event: "bike_b: reroute: Blockage 60 m ahead. Take the detour; about 1 min 40 sec extra."
1489.0 [('work_zone', 'confirmed', 'persistence')] ['heads_up'] {'cached_provider'}
```

Media (`Range: bytes=0-65535`): Walker clip `VID_20261006_174811_003 c04-s6` → **206 video/mp4**;
`VID_20261006_171812_002 c17-s2` → **206 video/mp4**.

### Weave evaluation

`WANDB_TEAM=vastdata WANDB_PROJECT=team-46 uv run python -m eval.run --model-cache
fixtures/rideahead/cache/model_outputs_v2.json --publish-weave --output eval/reports/team.json`

- **Link: https://wandb.ai/vastdata/team-46/r/call/01a14a2b-0087-750e-906e-1f38257e5652**
  (evaluation `rideahead-synthetic-lifecycle` + `evaluation_summary`). The report says
  `submitted_unverified` by design; lane C read the call back with the Weave client (finished, has output).
- Result: **lifecycle 21/21 scenarios passed** (synthetic ground truth). **Video interpretation: not scored**:
  0 human-reviewed / 0 AI-reviewed clips, **10 clip labels pending**, so keyword/structured/verified methods
  are `unavailable`. Cached predictions are reported as coverage only, not accuracy. Report committed:
  `server/eval/reports/team.json`.
- Suggestion: lane C's frame reviews (handoff above and `hazard-catalogue-c.md`) could fill those 10 labels
  as "AI-reviewed" if D's label format allows. Not done here without D's agreement.

## Deploy report (earlier: c448774, superseded)


- **Deployed SHA: `c448774`** (`main`); `make verify` green locally first (server 160 passed / 1 skipped,
  web 27 passed, build OK). `make deploy VM=bc-rishiksiripurapu` with no `VM_DIR` override (A's fix works).
- **URL: https://cysense.elio.ltd** (named Cloudflare tunnel, tmux `tunnel` on the VM via
  `~/.cysense-tunnel.sh`, mode 700). The token file `~/.cysense-tunnel-token` was written by the human
  teammate at a hidden prompt; checked only for presence (non-empty, mode 600), never read.
  cloudflared log: "Registered tunnel connection" ×2 (sjc07, sjc10), ingress `cysense.elio.ltd → http://localhost:8000`.
- **Quick tunnel stopped**: the old `tunnel` tmux session was killed. Only two cloudflared processes remain:
  ours (`tunnel run`) and the organisers' workshop tunnel (another user).
- `curl https://cysense.elio.ltd/api/health` → `{"status":"ok","team":"team-46","analyser":"cosmos","tracing":true}`.
  Without the demo key the API returns 401.

Smoke test against https://cysense.elio.ltd (demo key read on the VM, not printed):

```
perception: archive | routing: openrouteservice
vast cached / cosmos cached / yolo cached / wandb_inference cached / weave connected / routing configured
140.0 [] ['continue'] {'cached_provider'}
160.0 ['observed'] ['heads_up'] {'cached_provider'}
400.0 ['stale'] ['slow'] {'cached_provider'}
480.0 ['cleared'] ['continue'] {'cached_provider'}
```

**Media** (`/api/archive/media?source=…GX010001_chunk_0015_segment_001_of_006.mp4`, `Range: bytes=0-65535`):
**206 video/mp4**, 65536 bytes.

## Deploy report (earlier: 6cd6329 on a quick tunnel, superseded)


- **Deployed SHA: `6cd6329`** (`main`), `make verify` green locally first (server 158 passed / 1
  skipped, web 27 passed, build OK). VM: `bc-pool-218` (alias `bc-rishiksiripurapu`), `~/hack`,
  tmux `hack`, log `/tmp/hack-server.log`.
- Public URL then: a Cloudflare quick tunnel (now **stopped**; see the current report above),
  tmux `tunnel` on the VM; the URL changes if the tunnel restarts). Without the demo key the API
  returns 401. The key is in the VM `.env` and was shared privately, not here.
- VM `~/hack/server/.env` variable names: `DEMO_KEY RIDEAHEAD_SCENARIO RIDEAHEAD_PERCEPTION
  RIDEAHEAD_ROUTING GPU_BEARER_TOKEN COSMOS_REASON_URL YOLO_URL COSMOS_EMBED_URL WANDB_API_KEY
  WANDB_TEAM WANDB_PROJECT`. No `ORS_API_KEY`, so routes replay the recorded ORS responses (cached).

Smoke test (identical on `127.0.0.1:8000` and the public URL):

```
health: {"status":"ok","team":"team-46","analyser":"cosmos","tracing":true}
perception: archive | routing: openrouteservice
vast cached / cosmos cached / yolo cached / wandb_inference cached / weave connected / routing cached
140.0 [] ['continue'] {'cached_provider'}
160.0 ['observed'] ['heads_up'] {'cached_provider'}
400.0 ['stale'] ['slow'] {'cached_provider'}
480.0 ['cleared'] ['continue'] {'cached_provider'}
media c15-s1 (/api/archive/media, Range 0-65535): 206 binary/octet-stream 65536B
```

Upstreams (`/api/health/upstreams` on the VM): **vss ok, cosmos_reason ok, cosmos_embed ok, yolo ok,
wandb ok, canary FAILED** (no `CANARY_URL` in the VM `.env`; RideAhead does not use Canary).

Issues found, for A:
1. **`deploy.sh` / Makefile `VM_DIR ?= ~/hack`**: the `~` is expanded on the laptop, so rsync tried
   `/Users/<me>/hack` on the VM and failed. Worked around with
   `make deploy VM=bc-rishiksiripurapu VM_DIR=/home/rishiksiripurapu/hack`. Suggested fix: default
   `VM_DIR=hack` (relative to the remote home) or quote it so the remote shell expands it.
2. **Media content type**: the proxy passes through `binary/octet-stream` from the S3 store; iOS
   Safari can refuse to play that in `<video>`. Fixed in lane C on `rishik/rideahead-notes`
   (`app/api/archive.py` `media_type()` maps generic types to `video/mp4` by extension, plus
   `tests/test_archive_media.py`). **Not deployed**: needs A to verify and merge, then redeploy.
3. The first deploy's health check ran before `uv sync` finished on the fresh VM (curl exit 7); the
   server came up a few seconds later. Harmless.

## TL;DR for A (critical path)

- `ArchivePerceptionProvider` is implemented (`server/app/agent/perception.py`). It reads the cache only
  and makes no model calls at session creation. `RIDEAHEAD_PERCEPTION=archive` gives:
  `/capabilities` → vast/cosmos/yolo/wandb_inference = `cached`; `/rides` → 1 ride
  (`nyc_bike_gopro-1:68c66490-7e43-428d-b7af-b477ae296369`, 10 segments).
- `inspect_ride()` returns 5 reviewed claim observations (`source="cached_model"`, evidence
  `cached_recorded`, `media_ref=/api/archive/media?source=…`, cached Cosmos `Verification`,
  location `manual_anchor`/`interpolated` on `manhattan-6th-ave:nb`, bearing 29°).
- **Honest result: no clip reaches `present` + `supported`, so the real data creates no hazard.**
  3 caption claims are `contradicted` (the trust layer rejecting them: the vehicle sits beside the
  green lane, the lane is clear) and 2 are `uncertain`. Details and evidence are below. A demo
  hazard therefore needs a **labelled scenario event** (A's call), placed at the anchors below.
- Sponsor calls are real and traced: 11 × W&B `chat_json` (`OBSERVATION_EXTRACTION_PROMPT`,
  `rideahead-extract-1`) + 11 × Cosmos `ask_video` (`verification_prompt()`, `rideahead-verify-2`),
  Weave project `vastdata/team-46`. Cached in `server/fixtures/rideahead/cache/model_outputs_v2.json`.
  Rebuild: `cd server && uv run python -m app.agent.perception_build`.

## Anchors for the NYC scenario (6th Ave northbound, Manhattan)

Hand-placed at intersections named by street signs / storefronts. Not GPS. `road_segment_id`
`manhattan-6th-ave:nb`, travel bearing **29°** (Manhattan grid north). Section starts at ride
offset **340 s** (`session_time_s = ride_offset_s - 340`).

| Ride offset (s) | Session time (s) | Label (evidence) | lat | lon | ± m |
|---|---|---|---|---|---|
| 340 | 0 | W 29 St (caption sign) | 40.7466 | -73.9899 | 120 |
| 380 | 40 | 100 W 33rd St (storefront) | 40.7491 | -73.9881 | 100 |
| 395 | 55 | W 34th St / Herald Sq (Macy's, street sign) | 40.7498 | -73.9877 | 80 |
| 430 | 90 | W 36 St (street sign) | 40.7510 | -73.9867 | 150 |
| 460 | 120 | W 38 St (street sign) | 40.7522 | -73.9858 | 150 |
| 479.5 | 139.5 | **W 39 St (street sign in frame, c15-s6 4.5 s)** | 40.7528 | -73.9853 | 60 |

Suggested scenario hazard spot (where the recorded claims cluster, c15-s1…s6, W 38–39 St):
**40.7525, -73.9856, ± 80 m**, heading 29°. A detour around 6th Ave between W 38 and W 39 would
go via 5th Ave (southbound only) or Broadway/7th Ave. Check what ORS returns.
Caveat: c13-s2 says the camera "turns right" at W 34th, so the ride between W 34th and W 36th may
briefly leave 6th Ave. Uncertainties include this.

## Reviewed observations (what `inspect_ride` returns)

| Observation | Session t | Assertion | Support | Why |
|---|---|---|---|---|
| obs-gx010001-c14-s2 | 85 | present | uncertain | van "partially blocking the lane" at intersection; lane unidentified; Cosmos v2 unclear |
| obs-gx010001-c14-s3 | 90 | unclear | uncertain | Cosmos v2 (twice): van parked in bike lane; W&B extraction unclear; frame ambiguous (parked SUV + van in curbside lane before the green paint starts) |
| obs-gx010001-c15-s1 | 110 | present | **contradicted** | frames c15-s1 + c15-s2: UPS truck in traffic lane right of the buffer, rider passes without leaving the lane, green lane clear |
| obs-gx010001-c15-s5 | 130 | present | **contradicted** | SUV in hatched buffer, green lane clear |
| obs-gx010001-c15-s6 | 135 | present | **contradicted** | green lane clear up to W 39 St; sedan in buffer/traffic lane |

Support rule (deterministic, recorded in the manifest as `review_rule`): `supported` only if the
claim is present in caption/extraction AND Cosmos supports it AND frame review does not contradict
it. Frame review = Agent C viewing 3 frames per clip; not ground truth.

**Verifier reliability (important for eval, D):** Cosmos `rideahead-verify-2` said `supported` on
5/11 shortlist clips, including `c16-s2` (clear lane; W&B extraction said `clear`). v1
(`c-verify-lane-blocked-v1`) said `contradicted` on 3/3 of the same claims. Neither prompt is
reliable alone; v2 over-calls obstruction when vehicles are beside or near the lane.

Other rides: `gx050001-c05-s3` (red sedan at the curb in a wide curbside lane; rider passes on the
left half of the same lane) = uncertain, and **cannot be anchored** (no street names in chunks
2–8 of that ride). Not used.

## Env var names (laptop `server/.env`; VM has these in its shell env / team config)

`VSS_URL` `VSS_USERNAME` `VSS_PASSWORD` `GPU_BEARER_TOKEN` `COSMOS_REASON_URL` `COSMOS_EMBED_URL`
`YOLO_URL` `CANARY_URL` `WANDB_API_KEY` `WANDB_TEAM` `WANDB_PROJECT` `S3_ENDPOINT` `S3_ACCESS_KEY`
`S3_SECRET_KEY` `S3_CHUNKS_BUCKET` `S3_SEGMENTS_BUCKET` `VASTDB_BUCKET` `VDB_SCHEMA`
`VDB_COLLECTION` `VDB_PROMPTS_COLLECTION` `TEAM`

- VM team config (`/config/team-46.config`) has NO GPU URLs and NO W&B keys. On the VM: `WANDB_*`
  and `GPU_BEARER_TOKEN` are shell env vars. GPU URLs follow the organisers' docs:
  `http://${GPU_HOST}:8001` Cosmos Reason, `:8002` YOLO11, `:8003` Embed, `:8004` Canary.
  `GPU_HOST` is the same host the VSS Backend Config shows.
- Off-VM, `INGRESS_URL` is unreachable (ConnectError); use the public team URL for `VSS_URL`.

## Working entry points

| Path | What it is | Status |
|---|---|---|
| `server/app/agent/perception.py` | `ArchivePerceptionProvider`: list_rides / inspect_ride / verify_evidence / statuses from cache | Real (cached model outputs) |
| `server/app/agent/perception_build.py` | Cache builder: W&B extraction + Cosmos v2 verification, Weave-traced | Real, run once 2026-10-17 |
| `server/tests/test_perception_archive.py` | Provider tests (protocol, provenance, no URL leaks, statuses) | pass |
| `server/app/agent/perception_claims.py` | Clause-level lane-obstruction reading of captions: `caption_assertion(caption)` returns `present / denied / hedged / adjacent / unclear / none` plus `bike_lane / lane / roadway / unknown` and the clause | Real, pure, tested |
| `server/fixtures/rideahead/cache/ride_gx010001_manifest.json` | Ride manifest: timing rules, reconstructed route, demo-section anchors, 10-segment shortlist with roles | Real corpus data; coordinates hand-placed |
| `server/fixtures/rideahead/cache/captions_gx010001_shortlist.json` | Sanitised cached captions + YOLO11 counts for the 10 shortlisted segments (no media URLs) | Cached recorded |
| `server/tests/test_perception_claims.py` | 5 required trust cases (master prompt section 9) + all 10 real captions | 12 tests pass |

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

Cache: `server/fixtures/rideahead/cache/verify_lane_blocked_v1.json` (prompt `c-verify-lane-blocked-v1`, model
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

### Second pass: all three bike rides (2026-10-17)

Ranking: `caption_assertion` over every bike segment (78 chunks, 3 rides). Only **7 segments**
have a caption clause asserting something blocks the *bike lane*. 5 not yet checked were sent to
Cosmos with the same prompt `c-verify-lane-blocked-v1` (sequential, 3.0–7.1 s each).

| Segment | Caption claim | Cosmos v1 | Frame review (Agent C) |
|---|---|---|---|
| `gx050001-c05-s3` | red car parked, partially blocking bike lane | supported | **uncertain**: red car parked at the curb ahead, in the curbside lane the rider uses; no bike-lane paint visible |
| `gx050001-c17-s2` | traffic cone near bike lane | supported ("car parked in the bike lane") | **contradicted**: green lane clear, cars and cone to its right |
| `gx010001-c07-s6` | utility truck partially blocking bike lane | contradicted | not reviewed |
| `gopr0130-c17-s4` | UPS truck near green lane | contradicted | not reviewed |
| `gx050001-c07-s2` | bollards block the bike lane | contradicted (prompt asks about vehicles) | not reviewed |

**Conclusions**
- Across 8 Cosmos checks, the verifier was wrong at least once in each direction compared with frame
  review (1 false "supported"). Treat Cosmos as one vote, not ground truth.
- **Best real observation so far: `gx050001-c05-s3`** (ride GX050001, stream `aff9e3f6…`, chunk 5,
  10–15 s): a parked red car in the rider's curbside lane. Use support = **uncertain**, assertion =
  present, with caption + Cosmos + frame-review evidence. It is outside the anchored 6th Ave section,
  so it needs its own anchor (captions near chunk 5 of that ride have no street names yet).
- **No clean positive control exists** among caption-claimed bike-lane blockages in this corpus.
- Proposed prompt v2 for A: ask separately (a) where the bike-lane markings are, (b) whether any
  vehicle's wheels are inside them, (c) the second it is visible. Pair with YOLO11 boxes from the
  stored detections (vehicle box overlapping the lane region) as a second, independent vote.

## Checks run and results

- `uv run pytest -q` (whole server, after rebase on 5fd686f): **145 passed, 1 skipped**.
- API smoke test with `RIDEAHEAD_PERCEPTION=archive`: `/capabilities` and `/rides` 200, statuses cached.
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
