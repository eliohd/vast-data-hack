# RideAhead — "One bike sees it. The next bike avoids it."

> **Background notes, not build instructions.** `master-prompt.md` and `COLLABORATION.md` take
> precedence wherever they differ. In particular, the build plan and prompt in sections 10–11 below
> (osmnx, Streamlit, VAST DB tables, a 6-hour plan) are superseded by the master prompt
> (openrouteservice, the existing Astro UI, an in-memory store, 4 hours). Useful parts: corpus findings
> (sections 3 and 5) and the per-jurisdiction law table (section 6). Agents: don't implement from this file.

VAST Builders Challenge (London) · Team 46

## 1. The idea

Camera-equipped bikes detect emergencies, accidents, obstructions and collision risk.
They share short-lived, evidence-backed hazard reports, and other cyclists' routes change
based on **whether the hazard will still be there when they arrive**.

What is new (vs. past VAST projects such as StreetCast, CloseCall, Sidewalk Pulse):
hazards have a **lifecycle** (observed → confirmed → stale → cleared), every hazard is
**verified** before it is shared, the network **asks approaching bikes to re-check** stale
hazards, the output is a **decision** (ignore / heads-up / slow / wait / dismount / reroute)
rather than just a pin, and every reroute is **legal under the local traffic law** of where the
rider is.

## 2. Three layers

| Layer | Range (adjustable) | Job | Prototype |
|---|---|---|---|
| 1. On your bike | ~50 m ahead | Immediate warning: emergency vehicle ahead, lane blocked ahead, closing vehicle ahead (collision risk) | Forward-facing GoPro clip + Cosmos check + looming-based time-to-collision |
| 2. Nearby riders | 200 m | Broadcast expiring hazards to nearby rider sessions | In-process pub/sub between simulated riders |
| 3. Wider area | 2 km | Hazard map + time-aware rerouting | OSM graph (osmnx) with edge penalties |

Distances are illustrative design settings shown as sliders, not validated safety distances.
Rear-approach warnings were cut by team decision (no rear-facing footage exists).

## 3. Hazard types

| Type | Source | Prior duration | Default action |
|---|---|---|---|
| EMERGENCY_SCENE (stationary emergency vehicle, flashing lights, police scene) | Video (~15 flashing-light, ~9 ambulance, 2 fire-truck sightings) | 20–60 min | Reroute |
| EMERGENCY_VEHICLE_MOVING | Video | < 1 min | Heads-up only |
| ACCIDENT | Video detector (Cosmos verify) + NYC Open Data crash records + one labelled simulated scenario | 30–90 min | Reroute |
| LANE_BLOCKED (vehicle in bike lane) | Video (77 asserted sightings) | 2–15 min | Slow; reroute if confirmed twice |
| WORK_ZONE (cones, barriers, flagger) | Video (52 sightings + fixed nyc_streets_cam-1) | hours–days | Reroute |
| COLLISION_RISK | Video conditions (night, wet, trucks turning, forced merge) + looming TTC + historical crash density | that session | Weight in safest-vs-fastest routing |

Honesty notes for the pitch:
- The footage contains **zero real accidents**: every "accident/collision/near-miss" mention in
  the captions is negated. The accident detector is real and runs on all footage; the accident
  shown in the demo is a clearly labelled simulated scenario, and historical crashes come from
  NYC Open Data.
- Collision prediction is **uncalibrated**: time-to-collision from bounding-box growth
  (looming), shown as a relative risk level, not metres or seconds of guaranteed accuracy.
- Bike positions are **simulated** along hand-drawn routes; the clips have no GPS.

## 4. Hazard lifecycle and decision rules

```
OBSERVED ──2nd sighting──▶ CONFIRMED ──age > type half-life──▶ STALE
    │                          │                                  │
    └── contradicting ──▶ DISPUTED (show both)     positive "clear" sighting ──▶ CLEARED
```

- P(still present | age, type) = exp(-age / half_life[type]); each confirmation resets age.
- **Stale never means clear.** Only an observation of the road being clear clears a hazard.
- Match hazard to road segment **and direction of travel** before alerting anyone.
- Decision per rider: `p = P(present at ETA)`; compare `p × expected_delay` against `detour_cost`.
  - p < 0.2 → ignore · 0.2–0.5 → heads-up · short delay → slow/wait · otherwise → reroute.
- Every card shows evidence and freshness: "Ambulance + flashing lights, seen 18 s ago by Bike A,
  confirmed by fixed cam, 82% likely still there when you arrive in 3 min → reroute (+40 s)".
- Wording is about observations ("truck turning across the cycle lane"), never people or areas
  ("dangerous driver", "dangerous neighbourhood").

**Fresh-look request:** when a hazard goes STALE and a rider's route passes it, the system sends
that rider's next clip to Cosmos with a targeted yes/no question ("Is an emergency vehicle still
stopped here? YES/NO/UNCLEAR + second"). Result confirms or clears the hazard.

## 5. Trust filter (why our hazards are believable)

Captions are unreliable: 288 of 3,537 segments are heavily negated, and "no vehicles blocking
the lane" contains "blocking". Before a hazard is created:
1. Split caption into sentences; drop negated claims.
2. Cross-check against detector `object_counts` (e.g. claimed vehicle actually detected).
3. Targeted Cosmos yes/no on the 5-second segment for candidates.
4. Store a trust score; only trust ≥ threshold becomes a shared hazard.

## 6. Location laws (jurisdiction rules packs)

Every reroute and every alert must be **legal where the rider is**. The camera's `location`
(new_york, san_francisco, toronto, nashville, + london for our own footage) selects a rules pack
`rules/<jurisdiction>.yaml`. The same hazard can produce a different legal reroute in a different city.

### 6a. What the rules pack encodes

| Rule | Used for | NYC | San Francisco | Toronto | Nashville | London |
|---|---|---|---|---|---|---|
| Side of road | Direction matching, which side hazards sit on | Right | Right | Right | Right | **Left** |
| Adult sidewalk/pavement riding | Never route onto footways | Prohibited | Prohibited | Prohibited (adult-size bikes) | Check local ordinance | Prohibited |
| Bike-lane use | Whether leaving the lane to pass a blockage is allowed | Use when provided; may leave for safety | Use when provided; may leave to pass/avoid hazards | No general mandate | Check | No mandate (Highway Code guidance) |
| Bikes on motorways/interstates | Remove edges from graph | Prohibited | Prohibited | 400-series prohibited | I-24 prohibited | Motorways prohibited |
| One-way streets | Only ride against flow on contraflow lanes | Contraflow only | Contraflow only | Contraflow only | Contraflow only | Contraflow only ("except cycles" signs) |
| Bus lanes | Allow as reroute edges? | Generally no | Generally no | Generally no | Check | **Generally yes**, unless signed |
| Stop signs / red lights | Never suggest rolling through | Full stop | Full stop | Full stop | Full stop | Full stop |
| Minimum passing distance (drivers) | Threshold for COLLISION_RISK "close pass" grading | No numeric rule ("safe distance") | 3 ft | 1 m | 3 ft | 1.5 m guidance ≤30 mph |
| Emergency vehicles | Rider action in Layer 1 | Yield, pull right, stop | Yield, pull right, stop | Yield, pull right, stop | Yield, pull right, stop | Let pass safely, pull **left**, no rule-breaking to make way |
| Dismount and walk | Fallback when no legal detour | Pedestrian rules apply | Same | Same | Same | Same |

> ⚠️ These are simplified encodings for a prototype, **not legal advice**. Rules marked
> "Check", plus every value, must be verified against the source (NY VTL & NYC Admin Code,
> California Vehicle Code & SF Transportation Code, Ontario HTA & Toronto bylaws, Tennessee Code,
> UK Highway Code & Highway Act 1835) before being shown as fact. Each rule in the YAML carries
> its citation and a `verified: true/false` flag that the UI displays.

### 6b. How the laws change behaviour

1. **Routing constraints (hard).** Edges illegal for bikes are removed from the graph *before*
   routing: footways/pavements, motorways/interstates, one-way against flow without contraflow, and bus
   lanes where bikes aren't allowed. A reroute is never suggested if it's illegal, even when it would be faster.
2. **Decision options (soft).** If no legal detour exists, the decision becomes *wait*, *slow*
   or *dismount and walk*, never "ride on the sidewalk".
3. **Hazard semantics.** A vehicle stopped in a bike lane is also tagged
   `possible_rule_breach: parking/stopping in bike lane (<citation>)` for the **city report only**.
   Rider alerts stay observational. No one is accused, and the tag is labelled "possible".
4. **Collision-risk grading.** "Close pass" thresholds use the local minimum-passing rule (labelled
   uncalibrated, because distances come from bounding boxes).
5. **Emergency behaviour.** Layer 1 tells the rider the locally correct action ("pull right and stop"
   in NYC; "let it pass, keep left" in London).
6. **Explainable cards.** Every reroute card names the rule that shaped it:
   *"Detour via 2nd Ave (+40 s). Shorter path uses the sidewalk, which isn't allowed for adults in NYC (Admin Code 19-176)."*

### 6c. Privacy and data-sharing law (sharing footage between bikes)

Sharing camera footage of the public between riders is regulated: UK GDPR / Data Protection
Act 2018 in London, PIPEDA in Canada, and state laws in the US. Design choices:
- **Share events, not video.** Hazard records carry type, location, time, trust score and a text description.
  Clips stay in VAST storage and are viewable only as evidence in the app.
- **Blur faces and number plates** on any evidence clip shown (blur boxes from the detector).
- **Data minimisation and retention.** Hazards and evidence expire (e.g. 24 h) unless they're added to the
  aggregated city report, which holds no images.
- **No person-level labels.** Observations only, matching the "no dangerous driver" rule.

## 7. Sponsor tools

- **VAST**: S3 segments + VAST DB tables (`segments`, `hazards`, `sightings`) queried by
  place/time/direction.
- **NVIDIA**: Cosmos reasoner (verification, fresh-look, accident detector), Cosmos-Embed (similar-hazard search).
- **W&B Weave**: trace every model call; `weave.Evaluation` for hazard precision.
- **CoreWeave**: team VM compute, if confirmed on the dashboard.

## 8. Evaluation (documented, reproducible)

- Hand-label 40 bike segments: hazard yes/no + type.
- Compare: (A) raw caption keyword search, (B) + negation filter, (C) + Cosmos verify.
  Metrics: hazard precision/recall, fake hazards from negation, Cosmos calls per hazard.
- Lifecycle simulation: replay ride timeline, measure % of alerts that were still valid at ETA
  vs. a naive "show every pin for 10 min" baseline.
- **Legality check:** for 20 generated reroutes per jurisdiction, assert 0 illegal edges
  (footway, motorway, wrong-way without contraflow, disallowed bus lane). Report "naive shortest
  detour" illegal-edge rate vs ours.
- `make eval` reproduces everything; README documents inputs, outputs and steps.

## 9. 2-minute demo

1. 0:00–0:20 — Bike A's clip: ambulance with flashing lights stopped ahead. Layer 1 tells the rider
   the local action ("pull right and stop"); hazard pin drops ("seen 0 s ago, typical 20–60 min").
2. 0:20–0:45 — Bike B (3 min away) gets "reroute (+40 s)". The card explains the shorter path
   used the sidewalk, which isn't allowed for adults in NYC. Bike D (heading the other way) gets nothing (direction matching).
3. 0:45–1:05 — **Jurisdiction switch:** the same hazard with the London rules pack. Left-hand
   traffic and bus lanes are now allowed, so a different legal detour appears.
4. 1:05–1:25 — Labelled simulated accident: reported → confirmed by second sighting → reroute.
   Bike-lane blockage goes stale → fresh-look request to Bike C → "clear" → cleared.
5. 1:25–1:55 — W&B eval: fake hazards from raw captions vs ours; alert validity vs naive pins;
   illegal reroutes: naive detour vs ours (0).
6. 1:55–2:00 — "Shared road knowledge that knows when it's out of date, and what's legal where you ride."

## 10. Build plan (6 h, 4 people)

| Hour | A: Video + trust | B: Hazard engine + laws | C: Map + routing | D: UI + eval + pitch |
|---|---|---|---|---|
| 0–1 | Pull captions from explore API; negation filter | Schema, hazard types, half-lives; write NYC + London rules YAML with citations | Draw 3 rides on OSM; osmnx graph | Label 40 segments |
| 1–3 | Hazard extraction + Cosmos verify; accident detector | Lifecycle + direction matching (uses road side from rules) | Legal-edge filter from rules pack; time-aware rerouting | Leaflet map + decision cards with rule citations |
| 3–4.5 | Fresh-look flow; looming TTC on bike clips | Decision engine (wait/slow/dismount when no legal detour); SF/Toronto/Nashville packs | Simulate riders B/C/D; load NYC crash data; London demo area graph | Wire UI to events; jurisdiction switch; Weave tracing |
| 4.5–5.5 | Weave evaluation; face/plate blur on evidence clips | Tests (expiry, clearing, direction, legality) | City report (recurring hazards + possible-breach tags) | README + `make eval` |
| 5.5–6 | Freeze. Rehearse demo ×3. | | | |

Cut order if behind (confirm with team first): city report → SF/Toronto/Nashville packs (keep
NYC + London) → looming TTC → fresh-look.
Never cut: lifecycle, decision engine, trust filter, legal-edge filter, evaluation.

---

## 11. Build prompt (paste into Cursor / Claude Code)

> You are building **RideAhead**, a hackathon prototype (6 hours) that reroutes cyclists around
> emergencies, accidents, obstructions and collision risk detected from bike-camera video.
>
> **Data.** A VSS (Video Search & Summary) server exposes
> `GET /api/v1/videos/explore?scope=all&limit=100&offset=N` (Bearer token from env
> `VSS_TOKEN`, base URL from env `VSS_URL`). Each chunk has `camera_id`, `location`,
> `stream_id`, `chunk_index`, and `timeline[]` of 5-second segments with `reasoning_content`
> (caption), `object_counts` (JSON string) and `source` (S3 path of the segment mp4). Main
> camera: `nyc_bike_gopro-1` (forward-facing, 3 rides, night, NYC). Supporting fixed cameras:
> `nyc_streets_cam-1` (work zone with flagger), `nyc_streets_cam-2`, `sf_streets_cam-*`.
> Cosmos reasoner (OpenAI-compatible) at env `COSMOS_URL`; S3/VAST DB credentials in env.
> Never hard-code secrets. Download video only for `nyc_bike_gopro-1` segments that are hazard
> candidates.
>
> **Build, in this order:**
> 1. `pull.py` — page through explore API, write `segments.parquet` (one row per 5 s segment).
> 2. `trust.py` — sentence-split captions, drop negated sentences (no/not/without/none/absence),
>    extract hazard candidates by type (EMERGENCY_SCENE, EMERGENCY_VEHICLE_MOVING, ACCIDENT,
>    LANE_BLOCKED, WORK_ZONE, COLLISION_RISK), cross-check with `object_counts`, then verify
>    candidates with a Cosmos yes/no question on the segment video. Output `hazard_candidates`
>    with trust score. Decorate model calls with `@weave.op`.
> 3. `ttc.py` — for bike clips, track vehicles ahead (YOLOv8 + ByteTrack, 5 fps) and compute
>    looming time-to-collision `TTC ≈ h / (dh/dt)` of bbox height; emit relative risk
>    (low/med/high). Label as uncalibrated.
> 4. `hazards.py` — hazard store (VAST DB table, parquet fallback) with lifecycle
>    OBSERVED/CONFIRMED/STALE/DISPUTED/CLEARED, half-life per type, direction-of-travel matching,
>    and the rule that only a positive "clear" observation clears a hazard.
> 5. `rules/` — one YAML per jurisdiction (`nyc`, `london` first; then `sf`, `toronto`,
>    `nashville`) with: driving side, adult sidewalk riding, bike-lane use rule, motorway ban,
>    contraflow rule, bus-lane access, full-stop rule, minimum passing distance, emergency-vehicle
>    rider action. Every rule has `citation` and `verified: true/false`; the UI shows both and a
>    "not legal advice" note. `rules.py` loads the pack from the camera's `location`.
> 6. `routing.py` — osmnx bike graph for the ride area; hand-placed route polylines for 3 rides
>    with clip timestamps mapped along them. **Before routing, remove edges that are illegal under
>    the active rules pack** (footways, motorways, wrong-way without contraflow, disallowed bus
>    lanes). Reroute with edge penalty `p_present_at_eta × expected_delay`; decision
>    ignore/heads-up/slow/wait/dismount/reroute (dismount or wait when no legal detour). Each
>    decision returns the rule citations that shaped it. NYC Open Data crash records as a
>    historical risk weight.
> 7. `sim.py` — simulated riders A–D moving along routes, 200 m nearby channel and 2 km planning
>    radius (configurable); fresh-look requests when a STALE hazard is on a rider's path; one
>    clearly labelled simulated ACCIDENT scenario. Layer 1 emergency-vehicle alerts use the
>    rules pack's rider action (e.g. "pull right and stop" NYC, "let it pass, keep left" London).
> 8. `app.py` — Leaflet/Streamlit UI: map with riders and hazard pins (colour by state), video
>    panel showing the evidence clip **with faces and number plates blurred**, decision cards with
>    freshness + evidence + rule citations, sliders for radii, and a jurisdiction switch
>    (NYC ↔ London) that re-runs routing under the other rules pack.
> 9. `eval/` — 40 hand labels; `weave.Evaluation` comparing raw keywords vs negation filter vs
>    Cosmos verify; alert-validity-at-ETA vs naive 10-minute pins; legality test (0 illegal edges
>    in 20 reroutes per jurisdiction vs naive shortest detour). `make eval`.
> 10. `city_report.py` (stretch) — recurring hazards per road segment over all rides, with
>    `possible_rule_breach` tags (e.g. stopping in bike lane) labelled "possible".
>
> **Rules.** Describe observations, never people or neighbourhoods. Mark anything simulated,
> uncalibrated or legally unverified in the UI. Never suggest an illegal manoeuvre (sidewalk
> riding, wrong-way riding, rolling a stop/red light) even if faster. Share hazard events, not
> raw video; blur faces/plates on evidence; expire hazards and evidence after 24 h. Keep every
> claim linked to a segment clip and timestamp.
