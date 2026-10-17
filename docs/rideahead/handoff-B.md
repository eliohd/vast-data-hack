# Handoff B — Cysense browser interface

## Branch and integration base

- Branch: `agent-b/manhattan-demo-polish`. This delivery builds on main `3e65538`
  (recorded Broadway scenario, mid-journey detours, C/D integration and D’s scenario picker). See the branch head for the delivery SHA.
- Product branding is now **Cysense**: both wordmarks, page titles, live-tools copy, error messages,
  favicon, package name and Astro site URL (`https://cysense.elio.ltd`). Existing `/api/rideahead`
  paths, source identifiers, prompt provenance and generated contracts remain compatible.
- Only frontend files and B's handoff/verification artifacts were changed. No backend, hazard
  policy, sponsor credential, generated API type or canonical snapshot changes.

## Interactive street map

- `web/src/components/rideahead/NavigationMap.tsx` now mounts **Leaflet 1.9.4** with the standard
  OpenStreetMap street basemap, touch pan/pinch, zoom buttons and an explicit recenter button.
- Provider: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. No key or environment variable is
  required. Direct browser requests preserve ordinary HTTP caching; no tile proxy, offline tile
  download, prefetch or server credentials. Tile usage is best-effort under the OSM policy.
- SafeRoute `tools/saferoute/ui.js` was inspected and its layer-group, marker, hazard-circle and
  polyline presentation patterns adapted. Its invented grid, location assignments, disasters and
  Dijkstra routing are excluded. Backend openrouteservice geometry is rendered without rerouting.
- GeoJSON `[longitude, latitude]` becomes named `lat`/`lon` at the existing adapter boundary, then
  Leaflet `[latitude, longitude]`. Invalid coordinates remain unmapped; invalid route vertices
  break the line instead of inventing a connecting section.
- Backend `decision.selected_route_id` alone chooses the solid green route. Alternatives are
  purple and dashed. Snapshot revisions update routes, riders and lifecycle markers automatically.
- The map instance survives polling. Data updates never call `setView`/`fitBounds`. Initial session
  fit and explicit recenter respect measured overlays. Repeated identical revisions preserve
  marker focus as well as pan/zoom. Resize invalidates dimensions without refitting.
- Bike A / recorded observer and simulated Bike B have distinct labelled markers. The observer's
  visual pin has a stem to its true coordinate so a colocated camera and hazard remain visible.
- Clicking a hazard, or pressing Enter/Space on its marker, opens the existing evidence/video
  panel. Location uncertainty is a labelled, metre-radius circle, not a hazard footprint.
- Lifecycle styles remain shared with the legend: observed amber; stale faded amber with a clock
  and dashed border; cleared green with a check and solid border. Stale never becomes clearance.
- Missing locations, failed map initialization and failed/incomplete tiles have explicit messages.
  Tile failure retains the backend route overlays, journey details and evidence access.
- Visible Leaflet / OpenStreetMap / openrouteservice attribution and `/map-notices.txt` carry the
  SafeRoute MIT, Leaflet BSD and bot-avatars MIT copyright/license notices. The referrer policy
  sends only the origin cross-origin, keeping demo-key query strings off tile requests.

## Phone and desktop presentation

- Mobile/tablet (up to 900 CSS px): full-viewport map, no fake phone frame, notch, status bar,
  battery, Wi-Fi icons, compass, bottom Cosmos strip or replay toolbar. The transparent header
  has a text-only Cysense wordmark and glass settings button.
- Desktop: a basic phone silhouette between a left replay/session/camera command centre and a
  right evidence/inference inspector. Replay, seek, reset, scenario selection and live diagnostics
  remain available there. The generated canonical offline replay is available via the desktop
  controls or `/?preview=1` (also linked from a failed session's settings panel).
- A translucent glass bottom sheet shows **server-provided remaining** duration/distance and
  estimated clock arrival. Unknown estimates stay unknown; whole-route totals are not substituted.
  It expands to show location reconstruction, route provenance and estimation assumptions.
- The directions bubble uses the backend rider's active route, `next_step_index`, route instructions
  and `distance_to_next_step_m`. Clover from `bot-avatars` / libraries.dev guides the rider. Its
  working animation accompanies actual replay requests, not a fabricated routing operation.
  Hazard advisories, route-change notices and synthetic labels remain explicit.
- Road view is a clean, borderless feed with compact provenance. Its floating button hides/shows
  it and stays collapsed across polls/clip changes. Full verifier rationale/trust is in evidence.
  Recorded clips retain muted inline autoplay, tap-to-play and load-error states; synthetic events
  never acquire a video. Camera permission is requested only after a tap. Analysis tools moved
  to the desktop command centre; live camera output still cannot modify route decisions.
- End route ends **guidance on this device** and pauses replay. The inactive sheet offers a saved
  departure and search/filter for the existing backend-planned journey, plus resume. It does not
  pretend that arbitrary address searches can create routes through the current API.

## Verification

- `make verify`: passed using MSYS make/bash, bundled Python 3.12, `PYTHONUTF8=1`, and a temporary
  pnpm shell launcher outside the repository. Child-process `DEMO_KEY=` / `TRACING=false` avoid
  unrelated local authentication/tracing settings. No toolchain or server source edits.
- Server: ruff formatting/lint, pyright; **176 passed, 1 skipped** (live ORS opt-in).
- Frontend: standard format check, eslint, Astro diagnostics (zero), **72 tests in 10 files**,
  production build. Existing non-fatal Weave deprecations / Zod annotation warnings remain.
- New unit coverage verifies GeoJSON order in both hemispheres, actual canonical route geometry,
  invalid-coordinate gaps, backend-selected-route propagation, fit-once behavior, server remaining
  estimates, unknown values, maneuver indices and arrival status.
- Headless Chrome: **66 interaction checks**, at 390×844 mobile and 1440×1000 desktop.
  Built site, real OSM tiles, canonical API snapshots / controlled backend-response changes.
  Checks cover route/rider updates, zoom/pan preservation, recenter, keyboard hazard selection,
  evidence, stale versus cleared, settings PATCH, end/resume/search, missing locations, no camera
  call before tapping, recorded proxy/error behavior and explicit tile failure. No page errors.
- Separate **real local backend** check: create `nyc-broadway-work-zone-v1`, advance to t=60;
  actual engine returns observed `work_zone` + `reroute`, using recorded ORS responses. The map
  highlights exactly its selected route, displays its turn instruction and opens recorded evidence
  without a synthetic banner. The reconciled desktop scenario picker was exercised against the
  actual backend, sending the matching ride/scenario pair, then switching to mobile. No mocked
  session responses or decisions in this separate check.
- Screenshots and final verification receipt: `docs/rideahead/interface-map-review/`.
  Desktop and mobile Broadway images use the actual local backend; tile-failure uses a canonical snapshot.

## Limits and requests for A / C

1. **A/C:** integrate this branch, run the deployment checks, then verify real VSS MP4 bytes,
   iOS Safari autoplay, camera permissions and pinch gestures on the demo phone. Headless mobile
   emulation is not a physical-phone check. The local map needs no tile proxy.
2. **A:** the frozen API has no arbitrary-origin/destination planning, geocoding or session-end
   operation. Provide typed server operations if the route-search UI should plan new trips or End
   should terminate a server session. Current saved-journey search and local guidance end are
   deliberately labelled. No browser routing algorithm or speculative endpoint was added.
3. **A:** update shared README/deployment/API documentation to the Cysense product name when
   integrating. Keep compatibility for the existing RideAhead API paths and recorded provenance.
4. OSM tiles require internet access; offline replay uses cached data but has no offline street
   tiles. Tile outages are visible. Antimeridian wrapping remains outside this NYC demo's scope.

## References

- SafeRoute: https://github.com/madhu-garudala/SafeRoute/blob/main/tools/saferoute/ui.js
- Leaflet: https://leafletjs.com/reference-1.9.4.html
- OpenStreetMap tile policy: https://operations.osmfoundation.org/policies/tiles/
- Clover: https://libraries.dev/bots
