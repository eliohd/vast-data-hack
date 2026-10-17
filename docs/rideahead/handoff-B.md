# Handoff B — browser interface

## Current branch and commit

- Branch: `agent-b/rideahead-interface`.
- Implementation commit: `c135c0eec96ec97b414e682eca80497a6e74f7de`.
- Integrated A's bootstrap `5b43e3f`, including the handoff update at `d0a2330`.
- No server files or generated REST types were edited by B. Only A merges and deploys.

## Working entry points

- `/`: mobile-friendly RideAhead React island. Tries the server session first; connection errors remain visible. `Use offline fixture` explicitly switches to the canonical fixture preview.
- `/live`: preserved camera and upstream-status tools; existing WebSocket unchanged.
- `web/src/components/rideahead/RideAheadApp.tsx`: ride selection, server/offline mode, new-session connection.
- `web/src/lib/rideahead/connection.ts`: generated `Schemas['SessionSnapshot']` → presentation projection and typed `api` calls for create/read/advance/configure. Existing demo-key middleware is reused. No inferred REST endpoints or handwritten REST contracts.
- `web/src/lib/rideahead/view.ts`: UI-only models and geographic display helpers, not authoritative lifecycle/routing logic.
- `RideAhead.tsx`: polling, replay clock controls, sliders, server decision and route options. Live replay advances 5 session seconds per second; reads do not advance time. Mutations and polls are serialized. Finite 15-second network timeouts.
- `RouteMap.tsx`: north-up geographic route overview, riders and selectable lifecycle markers. SVG has no street basemap; this limitation is visible. Unknown locations remain unmapped.
- `EvidencePanel.tsx`: clip-window playback through the existing media proxy with demo-key support, evidence IDs, source/ride timing, provenance, verification, model/prompt versions, YOLO counts, freshness and uncertainty. Synthetic clips cannot play as recorded footage. External/token-bearing media paths are rejected.
- Offline fixture: copied from A's `server/fixtures/rideahead/snapshots.json` into `web/src/lib/rideahead/canonical-snapshots.json`. Play steps through complete snapshots; seeking selects the latest available snapshot, without inventing intermediate engine results. Regenerate with `make gen-api` and recopy when the fixture changes. Offline sliders are drafts and cannot change server decisions.

## Checks run and results

- `pnpm lint`: passed.
- `pnpm check`: passed, zero errors/warnings/hints.
- `pnpm test`: passed, 25 tests across 3 files. Includes frozen API request shapes, single session creation under concurrent reads, access-denied behavior, no future-evidence presentation, rewind, GeoJSON coordinate conversion, media URL restrictions and map projection.
- `pnpm build`: passed, `/` and `/live` generated. Existing third-party Zod annotation warnings are non-fatal.
- `pnpm exec prettier --check . --end-of-line auto`: passed.
- Standard `pnpm verify`: stops at formatting because the Windows checkout contains CRLF in 38 untouched baseline files while the repository requires LF. No unrelated formatting was changed. All subsequent verification steps were run individually and passed.
- `make verify`: attempted; Make is unavailable on this Windows machine. Python backend dependencies/uv are also absent, so B did not run server checks.
- Browser: verified backend-unavailable error, explicit offline switching, t=200 alternative-route decision, t=330 stale report, t=450 synthetic clearance. At a 390×844 phone viewport, document content width matched viewport width (no horizontal overflow). Desktop layout also visually inspected. Temporary viewport override reset afterward.

## Real integrations versus fixtures

- Real frontend transport uses A's generated API contract and the existing authenticated client. Transport request/response behavior is tested with mocked API responses.
- Local backend was not running: live end-to-end server behavior, real recorded video playback and sponsor integrations remain unverified on B's laptop. No successful integration is claimed.
- Offline scene, routes, positions, observations and clearance are A's labelled synthetic fixtures. Global labels and event-level provenance are visible. Configured/cached/fixture/unavailable states are distinct from connected.
- Fixture snapshot decisions are displayed unchanged; the browser does not calculate hazard state, route relevance, persistence or recommended actions.

## Known limitations

- No street tiles or custom routing graph. The map renders provider geometry and explicitly identifies itself as a route overview.
- One current simulated-rider decision card is shown (the two-rider demo scope).
- Independent video controls do not drive the server clock; the replay controls do.
- The existing package lock was rejected by the active minimum-release-age policy. B pinned compatible earlier `cn` (0.4.0), `lucide-react` (1.58.0), `shadcn` (4.21.5), and `eslint` (10.12.0), then regenerated the lockfile under the unchanged safety policy. Installation and frontend checks pass. No safety exclusions were added.

## Requested changes outside ownership

- A: merge this branch, run clean full-stack verification, then exercise session creation, replay, reset and settings on the deployed device. No deployment performed by B.
- A/C: provide the real ride/evidence through the frozen contract. Recorded media must use the existing app-controlled `/api/archive/media?source=…` path; new proxy shapes need a small allowlist adapter in B's view helper.
- A: retain event-level synthetic clearance labels and integration status accuracy when real perception/routing land.
- Repository maintainer: use an LF checkout or an agreed cross-platform formatting policy so the unmodified baseline can pass the standard formatting gate on Windows.
