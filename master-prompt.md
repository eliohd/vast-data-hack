# RideAhead — master build prompt

## Mission

Build **RideAhead: “One bike sees it. The next bike avoids it.”**

Create a working cyclist navigation prototype for the VAST Builders Challenge. An observation from recorded cycling footage becomes an evidence-linked hazard report. That report changes over time and helps another simulated cyclist decide whether to continue with an advisory, slow down, wait or take another route.

The defining contribution is **shared hazards that are updated, corroborated, become stale, or are explicitly cleared, with decisions based on the approaching rider’s route and arrival time**.

We have approximately four hours and four AI coding agents, potentially running across separate laptops with limited communication. Deliver a complete, explainable demonstration before expanding features. These are four agents building the application; the deployed application does not require four autonomous runtime agents.

## 0. Fast delivery plan — use this as the default

This section sets the delivery priority for the four-hour build. The broader interfaces below are extension points, not a requirement to finish every optional feature before showing a working demonstration.

### First demonstration

Deliver one small story: Bike A observes a blocked cycle lane; Bike B receives an advisory or a genuine route alternative; the report becomes stale; a clearly labelled later observation clears it. The second rider is simulated. A synthetic clearance must be labelled at event level and must not be presented as recorded evidence.

Keep the first implementation to:

- **5–10 selected clips from one ride**, including a useful obstruction and ordinary/negative examples. Do not process the whole corpus.
- **One manually anchored road section**, if usable GPS is absent; preserve location uncertainty.
- **One hazard type: `lane_blocked`**. Add `work_zone` after the complete flow works.
- **Two riders, A and B**, one tested origin/destination pair and one reliable detour.
- **A minimal openrouteservice adapter behind the routing-provider boundary**, using a bicycle profile and provider-computed route alternatives/exclusions. Do not build a custom routing graph.
- **An in-memory observation/hazard store**, optionally saved as a local JSON snapshot. No database migration or new writable VastDB tables.
- **One screen**, existing UI components, simple session-state polling and the unchanged existing WebSocket.
- **10–15 human-labelled clips** for the first evaluation, including negatives and uncertain scenes. A larger set is optional.
- Cached genuine model outputs with source IDs, model/prompt versions and visible replay labels. Replaying cached results must not imply live inference or provide future evidence to the engine.

Keep all five integrations in the same small flow: VAST retrieves the clips, Cosmos supplies scene interpretation/verification, YOLO11 supplies object evidence, W&B Inference extracts the observation, and Weave traces the operations. Selective checks and caching reduce calls; fixtures do not count as real sponsor integration.

### Early integration, not four finished components

Agent A publishes the minimum shared models, stub API, one fixture snapshot and generated browser types within **15 minutes**. Agent C returns one genuine evidence-linked observation before attempting a larger batch. Agent D returns the minimal observed → stale → cleared engine and a deterministic decision before adding additional lifecycle cases. Agent B connects one screen to the stub API immediately.

Target the **first complete end-to-end flow in 60–90 minutes**. At that checkpoint it may have a basic interface and fixture route, but the source observation should be real when upstream access works. A fixture route remains labelled and does not satisfy the real-routing acceptance criterion. Replace remaining stubs incrementally; do not wait for all four lanes to finish.

Timebox an upstream or routing integration problem to about 15 minutes of focused diagnosis before recording it in the lane handoff and continuing with an explicit adapter fallback. Never silently turn an unavailable integration into a successful one. A and C coordinate the unresolved real-integration work while B and D continue independently.

There is no hard feature freeze; keep time at the end for integration fixes, relevant tests, final deployment, documentation and the recording.

### Preparation before starting the build

Preparation means access, setup and inspection; build the judged application during the event.

**Everyone:** use a separate clone or worktree; sync the same starting commit; read the repository instructions and this prompt; record your A–D assignment; run the existing setup and baseline checks where feasible; use configured environment files for credentials; never paste secret values into prompts or handoffs. Confirm one integration owner and one shared code repository. Do not make agent-to-agent messaging infrastructure a prerequisite.

**Agent A:** confirm the backend/stub flow starts, inspect existing models and clients, check deployment access and the routing API key if available, and prepare the minimal contract/bootstrap commit. Set the integration checkpoints and the shared fixture location. Only A deploys.

**Agent B:** confirm the frontend starts with the existing API proxy and UI components; inspect the typed API client, media playback and demo-key handling; prepare to consume A's generated types and fixture snapshot. Test the eventual demo device/browser; backend credentials do not belong in the frontend environment.

**Agent C:** obtain authorised access to the assigned lab VM and existing team configuration; inspect the organiser skills and existing VSS/GPU/W&B clients; verify connectivity without printing secrets; identify the 5–10-clip shortlist and evidence for a small route anchor. Leave inference implementation and judged feature work to build time. Do not ingest external footage or copy earlier teams' private outputs.

**Agent D:** inspect the canonical model plan and existing test setup; prepare a small labelling sheet covering present/absent/uncertain obstruction cases and a separate lifecycle scenario table. Include duplicate, opposite-direction, stale, explicit-clear and provider-unavailable cases. Keep simulated truth independent of the persistence heuristic.

After A's bootstrap commit, B, C and D pull that exact contract once, build independently against fixtures, and report through their own handoff files. Expand the framework only through the small interfaces already described below.

## 1. Start from the existing repository

Repository: `https://github.com/eliohd/vast-data-hack`

Read:

- `AGENTS.md`
- `COLLABORATION.md`
- `docs/architecture.md`
- `docs/vss-api.md`
- This master prompt
- The source files relevant to your assigned lane

Preserve the established stack:

- FastAPI, Pydantic, httpx and uv on the server.
- Astro with React islands, Tailwind and existing UI components.
- Generated OpenAPI types and the existing typed browser API client.
- Existing VSS, Cosmos, YOLO11 and W&B clients.
- Existing configuration, demo-key protection, media proxy and deployment setup.

The current repository contains generic phone-camera functionality. Make archive replay the primary RideAhead experience while preserving existing capabilities where practical.

Do not introduce Flask, Streamlit, a second frontend framework, a message broker, Kubernetes infrastructure or a new agent framework. Keep `/ws/live` compatible; use a dedicated RideAhead REST API for the prototype rather than changing the existing WebSocket protocol.

## 2. Scope and evidence boundaries

Required:

- Event-provided cycling or street footage.
- One recorded observer, represented as Bike A.
- A second simulated cyclist, Bike B.
- Lane-obstruction observations first; work zones are the first optional additional hazard type.
- Evidence playback with timestamps.
- Hazard lifecycle and explicit freshness.
- Location and direction matching.
- A suggested wait/advisory and at least one genuine route alternative.
- W&B Weave traces and a small reproducible evaluation.

Exclude from the required build:

- Rear-facing warnings.
- Collision prediction, TTC and calibrated passing-distance estimates.
- Real accidents unless suitable footage is actually found.
- Emergency-response instructions.
- Five-jurisdiction legal rules.
- City complaint submission.
- Physical bike hardware or Bluetooth/Wi-Fi mesh networking.
- Real Lime fleet access.
- Face recognition, plate recognition or individual driver scoring.

Existing sighting counts and assumptions in earlier notes are hypotheses until checked against the actual corpus. Do not repeat them as measured results without recording how they were obtained.

Clearly distinguish:

1. Recorded source footage.
2. Model-generated interpretations.
3. Manually reconstructed locations.
4. Simulated riders and scenario events.
5. Cached real model outputs.
6. Synthetic development fixtures.

Do not ingest internet videos. Use the supplied indexed footage. Keep any new recording/upload feature outside the required demonstration unless the organiser’s workflow explicitly permits it.

## 3. Architecture and sponsor integrations

Implement this flow:

**VAST retrieval → Cosmos descriptions + YOLO11 evidence → W&B Inference extraction → trust checks → observations → hazard lifecycle → rider-specific routing decision → browser interface.**

Use each integration meaningfully:

### VAST

Use existing `VSSClient` methods to browse rides, search relevant moments, retrieve segments and detections, and access video through the server media proxy. VSS already searches the VastDB-backed archive.

Do not require new writable VastDB tables to make the application work. Put application persistence behind a small repository interface, initially backed by in-memory state with an optional local JSON snapshot. SQLite is optional after the first demonstration works. A dedicated application-owned VastDB adapter is an extension.

Never change or recreate organiser-owned index tables.

### NVIDIA Cosmos

Use existing segment descriptions for candidate retrieval. Re-watch selected candidate clips with `CosmosReason.ask_video` when available to assess whether the specific obstruction is visible.

Return supported / contradicted / unclear, with evidence. Model checking is not ground truth.

Use the existing VSS search path for Cosmos Embed-backed retrieval. Direct embedding calls are optional when they serve a concrete feature; do not add redundant calls simply to list another integration.

### YOLO11

Use stored detections and counts first. Call the existing YOLO11 inference endpoint selectively when additional evidence is needed.

Object presence supports a claim but does not establish lane blockage, distance, direction, legal status or collision risk. Missing detections should reduce certainty, not automatically prove absence.

Do not install YOLOv8 or start a second local detection pipeline.

### W&B Inference

Use the existing `LLM.chat_json` client for structured observation extraction from captions and detections. Validate the result with Pydantic.

Use it optionally to explain a decision from structured facts. The model must not invent coordinates, durations, route geometry, clearance evidence or legal rules.

Lifecycle transitions, route selection and action selection must be deterministic application logic.

### W&B Weave

Trace retrieval, extraction, verification, hazard updates and route decisions. Link an observation through to its resulting decision using stable IDs.

Record model identity, prompt version, latency, outcome and evidence references. Configure tracing to avoid recording credentials, authenticated media URLs or unnecessarily copying raw video/base64 payloads.

Show whether tracing is actually connected. A local activity log is useful but must not be presented as a successful Weave trace.

## 4. Four-agent ownership

Use these project-specific lanes. Agent A updates the collaboration documentation during bootstrap so it no longer assigns TTC to Agent D.

### Agent A — integrator and application runtime

Owns:

- Canonical Pydantic models.
- Shared prompts.
- RideAhead API routes and runtime orchestration.
- Routing-provider adapter.
- Application configuration and service wiring.
- Shared dependencies and generated API artifacts.
- Integration documentation and final deployment.

Agent A has the heaviest coordination role and may do more work than the others. Protect its time by keeping the other lanes independent.

### Agent B — interface

Owns:

- RideAhead React components.
- Page composition and styling.
- Browser playback controls and API consumption.
- Map presentation and interaction.
- Frontend tests.

Agent B does not implement lifecycle rules or calculate authoritative routing decisions in the browser.

### Agent C — archive and perception

Owns:

- Ride discovery and segment normalization.
- Location-anchor manifests.
- Candidate extraction and model verification.
- Necessary VSS/GPU client changes.
- Perception tests and sanitised source samples.

Agent C may call the existing W&B client but does not own changes to that shared client.

### Agent D — hazard engine, route scoring and evaluation

Owns:

- Pure hazard lifecycle logic.
- Observation deduplication and corroboration.
- Persistence estimates and freshness.
- Route relevance and candidate scoring.
- Evaluation fixtures, labels, scorers and reports.
- Corresponding tests.

Agent D does not implement TTC or invent collision probabilities.

### Single-owner shared files

Agent A alone edits:

- `server/app/agent/models.py`
- `server/app/agent/prompts.py`
- `server/app/services.py`
- `server/app/main.py`
- `server/app/config.py`
- `server/app/clients/llm.py`
- Python dependency files
- Generated OpenAPI and REST type artifacts
- Root instructions and integration documentation

Agent B owns frontend source and frontend dependencies, except generated REST types.

Agent C owns existing VSS/GPU/VastDB client changes.

Agent D’s hazard-engine modules are explicit exceptions to Agent A’s general ownership of `server/app/agent/`.

Each agent owns its corresponding test files. Avoid shared omnibus test files.

## 5. Working with limited communication

### Bootstrap gate

Agent A first publishes canonical models, provider interfaces, example payloads and working stubs. Target completion within the first 15 minutes; publish only the minimum contracts and runnable stubs needed by the first demonstration.

Agents B, C and D can inspect their code and prepare local work immediately, but must build shared integration against this committed contract.

Use one short bootstrap handoff containing:

- Contract commit SHA.
- Model and interface locations.
- Fixture locations.
- Commands for running the stub flow.

After that, avoid requiring repeated discussions.

### Contract freeze

- Freeze required field names and entry points after bootstrap.
- Permit backward-compatible optional fields with defaults.
- Do not rename public functions or silently change units.
- Put unavailable data in explicit null/unknown states.
- If a change is needed, record it in the lane handoff and provide an adapter that preserves the frozen contract.
- Agent A resolves cross-lane changes during integration.

### Written handoffs

Each lane maintains its own `docs/rideahead/handoff-A.md`, `handoff-B.md`, `handoff-C.md` or `handoff-D.md`.

Use the same short format:

- Current branch and commit.
- Working entry points.
- Checks run and results.
- Real integrations versus fixtures.
- Known limitations.
- Requested changes outside ownership.

Do not depend on Agent Mail or another messaging service being available. Git commits and handoff documents are sufficient.

### Integration rhythm

Use separate clones or worktrees. Commit small, complete changes and integrate approximately every 30 minutes, with the first complete flow targeted for 60–90 minutes. Do not wait for all four lanes to finish.

Only Agent A merges shared integration changes and deploys the demo. Other agents continue their owned work while integration happens.

Do not force-push shared branches, overwrite another agent’s work, or hand-edit generated files.

## 6. Canonical contracts

Agent A implements these as Pydantic models with `schema_version = "1"`. Use snake_case JSON field names for the new REST API and generate browser types from OpenAPI.

Use GeoJSON ordering `[longitude, latitude]` inside geometry. Use named `lat` and `lon` fields elsewhere. Convert explicitly at map boundaries.

### Evidence

Include:

- Stable evidence ID.
- Source segment ID and ride ID.
- Camera ID.
- Clip-relative start and end seconds.
- Ride-relative offset seconds.
- Original recording time when available.
- Application-controlled media reference.
- Provenance: recorded, synthetic or cached recorded.
- Model and prompt versions when applicable.

Never return upstream JWT-bearing video URLs.

### Location estimate

Include:

- Optional latitude and longitude.
- Optional directed road-segment ID.
- Optional travel bearing.
- Location method: metadata, manual anchor, interpolated or unknown.
- Optional uncertainty in metres.
- Anchor/reference notes.

Missing or uncertain geography must remain visible. Do not fabricate exact positions.

### Observation

Include:

- Stable observation ID.
- Hazard type, initially `lane_blocked`; keep the type configuration extensible for `work_zone`.
- Assertion: present, clear or unclear.
- Evidence references.
- Location estimate.
- Observer identity and source-group ID.
- Short factual description.
- Support assessment: supported, uncertain or contradicted.
- Optional model confidence, explicitly uncalibrated.
- Ride offset and session observation time.

A negative caption is not automatically a clearance observation.

### Hazard

Include:

- Stable hazard ID and type.
- Directed road/location reference.
- State: observed, confirmed, stale, disputed or cleared.
- Observation IDs.
- First-seen and last-supported session times.
- Persistence-prior configuration and version.
- Evidence-strength assessment.
- Separate impact/severity assessment.
- Optional clearance evidence ID.

### Rider

Include:

- Rider ID.
- Position, bearing and route progress.
- Destination and candidate route references.
- Explicit simulated flag.

### Route candidate

Include:

- Stable route ID.
- GeoJSON LineString.
- Estimated travel duration in seconds.
- Distance in metres.
- Provider and bicycle-profile metadata.
- Recorded/live-provider/fixture provenance.
- Known limitations or warnings.

### Decision

Include:

- Rider and hazard references.
- Action: continue, heads_up, slow, wait, reroute or unavailable.
- Selected route when applicable.
- Estimated delay and detour cost where supported.
- Short deterministic reason.
- Evidence references and assumptions.
- Whether the recommendation changed.
- Session time and state revision.

### Session snapshot

Include:

- Session ID.
- Schema version and monotonic revision.
- Current replay time.
- Riders, hazards, observations and decisions.
- Current configuration.
- Integration capability/status information.
- Explicit simulation and provenance labels.

## 7. Frozen module boundaries

Agent A publishes these interfaces and their stub implementations during bootstrap.

### Perception provider — Agent C

- `list_rides()` returns normalised ride manifests.
- `inspect_ride(ride_id)` returns normalised observations with ride-relative timing.
- `verify_evidence(evidence_id, question)` returns a structured supported/contradicted/unclear result.

Keep upstream access inside this provider and the existing clients. It must be replaceable by a fixture provider without changing the UI or hazard engine.

### Hazard engine — Agent D

- `ingest(observation)` applies one observation idempotently.
- `snapshot(as_of_s)` returns current hazards.
- `reset()` clears the session state.
- `score_routes(routes, rider, hazards, config, now_s)` returns a deterministic decision.

Use the same frozen models as Agent C. The engine must run without network access.

### Routing provider — Agent A

- `candidate_routes(origin, destination, exclusions)` returns normalised cycling route candidates.

Provide a real openrouteservice adapter and a clearly labelled fixture adapter. Start with one tested origin/destination and one provider-computed detour; do not create a custom road graph. Cache provider responses so polling does not repeatedly recalculate routes. Verify current provider capabilities rather than assuming every option is available.

### Runtime — Agent A

The runtime connects perception, replay scheduling, the hazard engine and routing. It owns session creation, configuration, clock advancement and snapshots.

It is the only authoritative owner of session state.

## 8. Replay and location handling

Inspect actual ride metadata before assuming the number of rides or availability of GPS.

If GPS is absent:

- Manually anchor a small demonstration section using visible signs or landmarks.
- Store anchors in a manifest with ride offsets, coordinates, evidence and uncertainty.
- Interpolate cautiously between anchors.
- Keep unknown locations unmapped.
- Label the result “manually reconstructed route.”

Choose a small credible demonstration area. Do not label NYC footage as London footage.

Original recording time, processing time and simulation time are different fields.

Observations become available only when replay reaches their session time. Precomputing interpretations is allowed; exposing future observations to the hazard engine is not.

Advancing backwards must reset and deterministically replay observations. Repeated requests or clip replays must not duplicate reports.

A second simulated rider is a navigation consumer. Its simulated position alone does not create a new camera observation or independently confirm a hazard.

If a clearance or second observer is synthetic, label that specific event.

## 9. Trust and lifecycle rules

### Trust

Retrieve candidate moments, extract structured claims and validate their evidence.

Test at least:

- “No vehicles block the bike lane.”
- “No cars are moving because a truck blocks the lane.”
- “A truck is parked beside the bike lane.”
- “A truck may be blocking the lane.”
- An obscured view where blockage cannot be determined.

Use clause-level meaning rather than discarding every sentence containing a negation word.

Cosmos verification asks whether the specific obstruction is visible, whether the relevant road space is visible, and what supports the answer. Unparseable or failed calls produce unknown status.

### Identity and corroboration

Match hazards using location, road direction, type and compatible time.

Repeated frames, adjacent chunks and duplicate model calls from one sighting are not independent observers. Continued observation and independent corroboration must be distinguished.

### Lifecycle

- Observed: supported first observation.
- Confirmed: additional qualifying evidence supports persistence or independent corroboration; preserve which kind.
- Stale: freshness threshold exceeded.
- Disputed: relevant evidence conflicts.
- Cleared: later evidence explicitly shows the previously affected area is clear.

Stale does not mean clear. Missing detections, an absent camera, failed API calls and occlusion do not clear a report.

Fresh-look requests only inspect an available later clip that actually covers the same affected area. Otherwise display that fresh evidence is unavailable.

### Persistence

Use configurable type-based priors, labelled as demonstration assumptions.

If using half-life decay:

`persistence_weight = 2 ** (-(age_s + arrival_in_s) / half_life_s)`

This is a heuristic weight, not a validated probability. Avoid displaying percentages as measured likelihood.

A repeated duplicate must not reset the clock. A genuinely newer supported sighting can update last-seen time.

## 10. Routing and sharing

Use a short-radius setting initially 200 m and a planning-area setting initially 2 km. Expose both as labelled sliders.

Radius alone is insufficient: check road segment, direction and whether the hazard is ahead on the rider’s route.

Use routing-service duration estimates to approximate arrival at a hazard along each candidate route. State assumptions. Compare estimated obstruction delay with detour cost.

- Brief obstruction: advisory or suggested wait where appropriate.
- Persistent relevant obstruction: route alternative.
- Cleared or unrelated obstruction: no active warning.
- Stale/disputed serious report: explicitly communicate uncertainty.
- No valid route/provider failure: unavailable result with explanation.

Do not let a low persistence weight silently declare an unresolved serious obstruction safe.

Use a bicycle routing profile. Do not claim universal legal compliance or complete map accuracy. A label such as “bicycle route from provider, subject to map restrictions” is acceptable.

Do not copy SafeRoute’s synthetic grid as a real street graph. Avoid treating an offline camera as a blocked road.

Use a shared application server for rider sessions. Describe this as server-mediated sharing; physical peer-to-peer networking is future work.

## 11. API and interface

Agent A implements typed routes under `/api/rideahead` for:

- Capabilities and integration status.
- Available rides.
- Session creation.
- Session snapshot.
- Advancing replay to a requested time.
- Updating session configuration.

Publish exact paths and generated types during bootstrap. Session reads must not advance time or trigger repeated model calls. Clock updates must be atomic and snapshots revisioned.

Agent B builds a mobile-friendly RideAhead island with:

- Map, Bike A and Bike B.
- Recorded clip playback.
- Hazard markers coloured by lifecycle.
- Evidence/freshness panel.
- Rider-specific decision card.
- Original and alternative route.
- Play, pause, reset and time controls.
- Radius sliders.
- Integration and provenance badges.
- Clear empty, loading, unknown and failed states.

Use the existing media proxy and authentication mechanism. Browser components must never receive upstream secrets.

Start with simple polling of lightweight snapshots. Avoid introducing a new streaming protocol unless the finished flow justifies it.

Keep the UI understandable to a cyclist. Put detailed traces and assumptions in an expandable evidence panel.

## 12. Extensibility without overengineering

Use small replaceable boundaries:

- Perception provider.
- Routing provider.
- Observation/hazard repository.
- Hazard-type configuration.
- Deterministic decision policy.

Prefer ordinary Python protocols, constructor injection and a small explicit registry. Do not build a general plugin marketplace, distributed service architecture or autonomous multi-agent runtime.

A new hazard type should require:

1. A type configuration and extraction prompt update.
2. Any additional validation.
3. Test fixtures.
4. Optional specialised presentation.

A new routing or storage provider should not require rewriting perception or lifecycle logic.

Version configuration, prompts and stored schemas. Document extension steps in `docs/rideahead/extensions.md`.

Keep shared prompts centralised in the existing prompt module. Agents submit proposed prompt changes through handoffs when outside their ownership.

## 13. Reliability, privacy and cost

- Reuse existing authentication, configuration and media-proxy code.
- Apply finite timeouts and bounded retries.
- Limit concurrent model calls.
- Cache by source ID, model and prompt version.
- Do not rerun inference whenever the UI polls.
- Keep optional integrations from preventing application startup.
- Distinguish unavailable upstreams from legitimate empty results.
- Review trace inputs and logs for secret/media leakage.
- No face/plate recognition or driver identities in hazard records.
- Do not claim evidence is blurred unless redaction is implemented and checked.
- Prefer clips/views suitable for the demo; reliable face/plate redaction is a separately scoped feature.
- Expiring application reports must not delete organiser-owned footage.

Only Agent C coordinates small re-ingestion batches, after Agent A identifies a concrete retrieval gap. No self-healing loop may repeatedly re-ingest the corpus.

TfL disruptions, weather, historical collision data, additional cities and live phone input are optional adapters. They must preserve geography, timestamps and provenance and must not delay the core flow.

## 14. USE THIS TO SPEED UP PROJECT: Architecture reuse and attribution

Reference:

- StreetCast: `https://github.com/muskancellhub/warehouse-guard`
- SafeRoute: `https://github.com/madhu-garudala/SafeRoute`

Adapt StreetCast’s retrieval, timeline reconstruction and structured extraction pattern.

Adapt SafeRoute’s separation of model calls, map presentation, tracing and route explanations.


Document inherited components and RideAhead’s new work. Do not reuse previous teams’ credentials, authenticated URLs, claims of evaluation success or branding.

## 15. Evaluation and completion criteria

Agent D maintains two distinct evaluations.

### Video interpretation

Start with 10–15 human-labelled segments, including normal traffic, negated captions, uncertain scenes and actual obstructions. Expand to 20–40 only after the end-to-end demonstration is reliable. The 5–10-clip development shortlist can overlap this set, but disclose that overlap; do not claim independent held-out accuracy from clips used for prompt tuning.

Compare:

- Keyword baseline.
- Structured extraction with assertion handling.
- Extraction plus model verification.

Report precision, recall where positive examples exist, false positives from negation, sample size, model-call count and latency.

Do not claim accident recall without positive accident footage. Do not invent evaluation results.

### Lifecycle and decisions

Use explicit simulated ground truth to test:

- Duplicate observations.
- Independent versus repeated sightings.
- Stale versus cleared.
- Relevant versus opposite-direction or parallel-road hazards.
- No future-observation leakage.
- Deterministic reset/replay.
- Route changes.
- Provider failure and unavailable routes.

Do not use the persistence model’s own estimates as the ground-truth labels for proving its accuracy.

Log the labelled evaluation to Weave when configured. Local results remain clearly local if publication fails.

### Done means

- A complete demonstration works from a clean startup.
- One recorded observation produces a model-checked report.
- Bike B receives a route-relevant decision.
- A real cycling route alternative can be shown when the provider is available.
- Staleness and explicit clearance are visibly different.
- All five requested integrations have demonstrable roles.
- Offline mode is usable and honestly labelled.
- Relevant tests and `make verify` pass, or remaining failures are documented.
- Setup, assumptions, sources, licences and evaluation are documented.
- The two-minute demonstration can be repeated reliably.

## 16. Four-hour execution and cut order

- **0–15 minutes:** A commits minimum contracts, runnable stubs, one snapshot fixture and generated API types. B, C and D inspect their lanes and prepare independent work.
- **15–45 minutes:** B connects one screen to stubs; C returns the first genuine observation and evidence reference; D implements observed/stale/cleared plus duplicate handling and simple decisions; A wires the session runtime.
- **45–90 minutes:** Integrate the first complete recorded-observation → decision → map flow. Replace interfaces incrementally; do not wait for full lane completion.
- **90–150 minutes:** Add the real openrouteservice detour, explicit cached replay, route/direction relevance and a clearly sourced clearance scenario.
- **150–180 minutes:** Complete the 10–15-clip evaluation, remaining lifecycle tests and Weave evidence. Add sliders or polish only if the core works.
- **180–240 minutes:** Final integration (no hard feature freeze). Fix integration bugs, run verification, test the demo device, deploy through A, document limitations and record/rehearse the two-minute demonstration.

The target is a working core within 2–3 hours, subject to functioning upstream access; the final hour is reserved for delivery.

Defer automatic fresh-look scheduling, additional providers/integrations, jurisdiction packs, historical crash weighting, direct VastDB writes, live phone input and additional hazard types. Do not build them before the first demonstration. If behind, cut those deferred features and visual polish before cutting evidence, lifecycle correctness, trust checks or honest provenance.

Preserve lifecycle correctness, evidence, provenance labels, the trust checks and one complete rider decision.

## 17. Agent launch prompts

Copy the relevant prompt below into each coding-agent session after sharing this master prompt.

### Agent A — integration lead

You are Agent A, the RideAhead integration lead. Read the repository instructions and this master prompt. Your first deliverable is the bootstrap contract: Pydantic models, frozen provider signatures, sample payloads, working stubs, exact API paths and generated browser types. Commit the minimum runnable contract within approximately 15 minutes and record its SHA in your handoff. Follow section 0: integrate a complete flow within 60–90 minutes, use an in-memory store with optional JSON snapshot, and test one real openrouteservice origin/destination and detour. Then implement the session runtime, routing-provider adapter, typed API and service wiring. Own shared configuration, prompts, dependencies and generated artifacts. Keep `/ws/live` compatible. Integrate B’s UI, C’s perception and D’s hazard engine through the frozen interfaces. You may carry more work than the other agents, but avoid making them wait for optional changes. Merge small increments, preserve existing authentication and media handling, and run the complete flow repeatedly. Only you deploy the demo. Keep `docs/rideahead/handoff-A.md` current. Prioritise a working evidence-linked navigation flow over extra features.

### Agent B — interface

You are Agent B, responsible for RideAhead’s browser interface. Read the repository instructions and this master prompt. Own frontend source, components, page composition, frontend dependencies and frontend tests, except generated API types. Build a mobile-friendly React island in the existing Astro app using the existing UI system and typed API client. Start with Agent A’s canonical fixture snapshot, connect one screen to its stub API immediately, then consume the same frozen API as real adapters land. Do not wait for perception or routing to finish. Follow the preparation checklist and scope limits in section 0. Implement the map, recorded video, simulated riders, hazard lifecycle markers, evidence panel, route decision card, route alternatives, replay controls and radius sliders. Show provenance, uncertainty and integration failures clearly. Do not calculate authoritative hazard states or decisions in the browser, change backend contracts, expose upstream credentials or introduce another frontend framework. Keep your changes modular so new hazard types can reuse the same cards. Maintain `docs/rideahead/handoff-B.md`, commit complete increments and run frontend verification.

### Agent C — archive and perception

You are Agent C, responsible for RideAhead’s archive and perception provider. Read the repository instructions and this master prompt. Inspect the actual event corpus and existing VSS/GPU clients. Follow section 0: select 5–10 clips from one ride, return one real evidence-linked lane-obstruction observation first, and anchor only one small road section if GPS is absent. Cache genuine outputs with provenance; do not process the whole corpus before integration. Implement the frozen ride-discovery, inspection and evidence-verification interfaces using VAST retrieval, Cosmos descriptions/video checking, YOLO11 evidence and the existing W&B Inference client. Central prompts belong to Agent A; provide requested additions through your handoff. Normalize timings, source IDs, counts and evidence references. Inspect location metadata, create a small manually anchored route manifest when needed, and preserve uncertainty. Handle negation, unsupported claims and unknown outcomes explicitly. Prefer stored detections and selective verification; cache results and bound concurrency. Never expose authenticated media URLs or fabricate independent observations. You own VSS/GPU client changes and related tests. Only coordinate small re-ingestion batches for demonstrated gaps. Maintain `docs/rideahead/handoff-C.md` with sanitised response samples, real-versus-fixture status and test results.

### Agent D — lifecycle, scoring and evaluation

You are Agent D, responsible for RideAhead’s deterministic hazard engine, route scoring and evaluation. Read the repository instructions and this master prompt. Implement the frozen engine interfaces as pure, network-independent logic using Agent A’s models. Follow section 0: ship the observed/stale/cleared flow, idempotency and a simple rider decision first; begin with 10–15 labelled clips and a separate scenario-ground-truth test set. Do not wait for real video or routing access; build against the shared fixtures. Own observation deduplication, source-aware corroboration, state transitions, configurable persistence priors, route relevance and deterministic action selection. Keep evidence strength separate from impact. Stale never means cleared; only adequately matched later evidence can clear a report. Prevent duplicate clock resets, future-observation leakage and false confirmation from adjacent chunks. Score the route candidates supplied by Agent A using estimated arrival and obstruction-delay assumptions, with explicit unavailable outcomes. Do not implement TTC, collision prediction or legal guarantees. Build human-labelled extraction evaluation and separate simulator-ground-truth lifecycle tests; publish Weave evaluations when configured and label local-only results honestly. Maintain `docs/rideahead/handoff-D.md`, documented evaluation commands and modular tests.
