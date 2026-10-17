# Cysense street map — verification receipt

2026-10-17, Lane B, `agent-b/manhattan-demo-polish`, integrated through main `3e65538`.

## Full repository verification

`make verify`: **exit 0** on the final integrated source.

- Server ruff formatting/lint and pyright: passed.
- Pytest: **176 passed, 1 skipped**. The skipped test requires an opt-in live ORS connection.
- Standard frontend Prettier, ESLint and Astro diagnostics: passed (0 errors/warnings/hints).
- Vitest: **72 passed in 10 files**.
- Production build: passed for `/` and `/live`.
- Existing non-fatal Weave/Pydantic deprecations and Zod annotation warnings remain.

Windows execution used MSYS make/bash and bundled Python 3.12 with `PYTHONUTF8=1`.
A temporary pnpm shell launcher lived outside the repository. Local child-process
`DEMO_KEY=` / `TRACING=false` avoided unrelated private authentication/tracing settings.
The first attempts hit a sandbox MSYS restriction, a broken uv Python minor-version link,
and a missing MSYS pnpm launcher; all were resolved with environment/runtime selection.
No repository toolchain, backend source or sponsor credential changes were needed.

## Browser verification

`browser-checks.json`: **66 passed, zero page errors**.

Headless installed Chrome, built production site, real OpenStreetMap tiles, 390×844 mobile
and 1440×1000 desktop. Session responses were controlled canonical snapshots so the
test could exercise route changes, rider movement, stale/cleared states, invalid locations
and settings failures deterministically. Media error checks used explicit unavailable bytes.

Verified: Cysense titles/wordmarks; edge-to-edge mobile; desktop panels; no status bar,
notch or compass; coordinate/route rendering; alternative styling; rider updates;
preserved pan and zoom during polling and decisions; recenter and zoom; accessible hazard
activation/evidence; uncertainty circles; synthetic labels; stale dashed amber versus solid
green clearance; camera permission only after tap; proxy-video error state; config PATCH;
end/resume guidance and bounded saved-journey search; absent coordinates and tile failure.

The browser test exposed Leaflet div-marker keyboard activation without a popup; explicit
Enter/Space activation fixed it. Development-server dependency optimization interfered
with an early run; the final tests used the built site and passed.

## Actual local backend

`real-backend-check.json`: passed after reconciling the latest main's scenario selector.

The desktop selector submitted `nyc-broadway-work-zone-v1` with its matching recorded-camera
ride. The real backend advanced to t=60 and returned an observed work zone and a reroute.
The rendered selected route ID matched the actual decision. Both riders remained visible;
recorded evidence opened without a synthetic banner. The same live session was resized
to mobile and recentered. No responses or decisions were mocked in this check.

The backend replayed genuine recorded ORS responses and model-output caches. This verifies
integration with the actual runtime, not live inference or new routing-service calls.

## Screenshots

- `mobile-broadway.png`: actual local backend, recorded Broadway work zone, selected detour.
- `desktop.png`: the same session, Cysense command centre and evidence inspector.
- `tiles-unavailable.png`: forced tile outage; honest message and retained route overlays.

No physical iPhone/Android check or authenticated VSS media-byte playback was performed.
Those require A/C's deployed VM and demo device. Custom destination planning and server-side
session termination remain outside the current API; requests are recorded in handoff-B.
