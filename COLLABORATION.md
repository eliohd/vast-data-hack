# Working together

How four people (two on Codex, two on Claude Code) build this repo in parallel on hack day
(17 Oct 2026) without stepping on each other. Agents: read this after [AGENTS.md](AGENTS.md).

**Short version:** everyone clones the same repo, each person owns a lane (a set of files),
contracts are agreed first, and everyone merges small changes to `main` every 30–60 minutes.
The tool doesn't matter: Codex and Claude Code both just run git in a local clone. The only
thing that matters is that two people (or agents) never edit the same file at once.

## 1. Access

- Repo: https://github.com/eliohd/vast-data-hack (default branch `main`).
- Owner adds the other three under **Settings → Collaborators**.
- Everyone:

  ```bash
  git clone https://github.com/eliohd/vast-data-hack.git hack
  cd hack && make setup
  ```

## 2. Lanes and ownership

Each lane owns its files. Edit outside your lane only by asking the owner first (or have them do
it). Fill in names on the day.

| Lane | Who (tool) | Owns | Scope |
|---|---|---|---|
| **A. Integrator + runtime** | Elio (Claude) | `server/app/agent/{models,interfaces,runtime,routing,geo,perception_fixture,prompts}.py`, `server/app/api/rideahead.py`, `server/app/{services,main,config}.py`, `server/app/clients/llm.py`, Python deps, `server/fixtures/rideahead/*.json`, generated artifacts, root docs | RideAhead contract, session runtime, openrouteservice adapter, wiring, deploy |
| **B. Interface** | _____ | `web/src/**` (except generated `schema.d.ts`), `web/package.json`, `web/pnpm-lock.yaml`, web tests | RideAhead island: map, riders, evidence playback, decision card, controls |
| **C. Archive + perception** | _____ | `server/app/agent/perception.py`, `server/app/clients/{vss,gpu,vastdb_client}.py`, `server/app/api/{archive,clips}.py`, `server/fixtures/rideahead/cache/`, perception tests | Ride discovery, anchors, extraction + Cosmos/YOLO verification, cached outputs |
| **D. Hazard engine + eval** | _____ | `server/app/agent/hazards.py`, `server/app/agent/scoring.py`, `server/eval/`, engine/eval tests | Lifecycle, dedup/corroboration, persistence, route relevance + decisions, evaluation. **No TTC / collision prediction.** |

RideAhead specifics: see [master-prompt.md](master-prompt.md) section 4 and
[docs/rideahead/handoff-A.md](docs/rideahead/handoff-A.md) for the frozen contract.

Starting a new file in your own lane is always fine. That's the easiest way to avoid conflicts.

### Shared "hot" files: one owner each, small edits only

| File | Owner | Rule |
|---|---|---|
| `server/app/agent/analyser.py` (`build_analyser`) | A | Others add their analyser in their own module; A wires it in. |
| `server/app/core/protocol.py` ⇄ `web/src/lib/protocol.ts` | A + B together | Change both in one commit. |
| `server/app/clients/gpu.py` | C | Others request changes through `handoff-C.md`. |
| `server/pyproject.toml`, `server/uv.lock` | A | Ask A to add Python deps. |
| `web/src/pages/index.astro` | B | Others hand B a component to mount. |
| `README.md`, `AGENTS.md`, this file | A | Anyone may suggest a change; A merges. |
| `server/openapi.json`, `web/src/lib/api/schema.d.ts` | generated | Never hand-edit. Run `make gen-api` after rebasing. |

## 3. Contracts first (first 20–30 minutes)

Agree on the shapes passed between lanes and push them to `main` as stubs **before** building
features. Then every lane can build against mock data without waiting on the others.

- **What the analyser returns:** goes in `Analysis.data`. Define its Pydantic model (e.g. `Clip`,
  `Detection`, `Verdict`, `SeverityScore`) in one place, `server/app/agent/models.py`, owned by A.
- **REST:** FastAPI is the source of truth. After any route/model change: `make gen-api`, then use the
  typed `api` client in `web/src/lib/api/client.ts`. Never hand-write REST types.
- **WebSocket `/ws/live`:** `protocol.py` ⇄ `protocol.ts`, changed together.
- **Stubs:** each lane first ships a function with the agreed signature that returns fake data
  (the `StubAnalyser` pattern), then makes it real.

## 4. One instruction file for both tools

- Codex reads `AGENTS.md`. Claude Code reads `CLAUDE.md`, which only contains `@AGENTS.md`. Both get the
  same rules. Put team-wide agent rules in `AGENTS.md`, not in per-tool files.
- Opening line for any agent session (Codex or Claude):

  > Read AGENTS.md and COLLABORATION.md. You are working in lane **X**. Only edit files that lane
  > owns; if you need a change elsewhere, stop and tell me. Run `make verify` before committing.

- Agents must never: `git push --force`, rewrite history on `main`, reformat files they didn't
  change, edit generated files by hand, or commit secrets.

## 5. Git rhythm

```bash
git switch main && git pull --rebase
git switch -c <name>/<topic>           # e.g. elio/agent-loop
# ... work, small commits ...
git pull --rebase origin main          # often
make verify                            # must be green
git push -u origin HEAD                # open a small PR, or merge straight to main if lane-only
```

- **Merge often.** Branches live for minutes to an hour, not all day. Ten small merges beat one
  big merge at 3pm.
- A change that only touches your own lane can go straight to `main` once `make verify`
  passes. Anything touching hot files goes through a quick PR the owner looks at.
- CI (`.github/workflows/verify.yml`) runs `make verify` on every push to `main` and on every PR.
  Keep it green. If you break `main`, fixing it comes before anything else.
- **Several agents at once on one laptop:** give each its own worktree so they don't overwrite each
  other:

  ```bash
  git worktree add ../hack-<topic> -b <name>/<topic>
  ```

- Ignore the Dependabot branch until after the event.

### Resolving conflicts

- **Generated files** (`openapi.json`, `schema.d.ts`): take either side, then `make gen-api`.
- **Lockfiles:** take `main`'s version, then `cd server && uv lock` or `cd web && pnpm install`.
- **Anything else:** ask the file's owner. Don't let an agent "resolve" by deleting the other side.

## 6. Secrets and config

- Real values never go in git (`.gitignore` already covers `.env`, `*.config`, `team-configs/`).
- On the lab VM the server reads `/config/<team>.config`. Locally, copy `server/.env.example` to
  `server/.env`.
- Share keys (VAST, W&B, NVIDIA/GPU endpoints) privately between teammates, never in the repo,
  issues or chat logs an agent might print.
- List env names only (`env | cut -d= -f1 | sort`), never values.

## 7. Shared resources: be careful

- **VSS pipeline:** all four of us share one. Re-ingest only through the VSS API, in small,
  deliberate batches, and say so in team chat first. Never redeploy the organisers' pipeline.
- **Demo deploy**: A decides *what* ships (a verified `main` SHA); lane C runs the deploy on the
  lab VM following [docs/rideahead/deploy-runbook.md](docs/rideahead/deploy-runbook.md). Nobody else
  deploys. Everyone else tests locally (`make dev`, `make phone-tunnel`).
- **Footage:** no internet video. Our own phone clips are fine, filmed with consent.

## 8. Integration and timeline

The integrator (A) pulls `main` and runs the full pipeline end to end at every checkpoint.

| Time | Checkpoint |
|---|---|
| Start | Lanes assigned, contracts + stubs on `main` |
| Hourly (12:30, 13:30, 14:30) | Everyone merged; end-to-end run on `main`; adjust lanes |
| **15:30** | **Feature freeze.** Only bug fixes, demo polish, eval numbers |
| 16:00 | Final deploy + demo rehearsal on the phone |
| **16:30** | **Submission closes / demos start** |

## Checklist

- [ ] All four are collaborators and have run `make setup`
- [ ] Lane names filled in above
- [ ] `server/app/agent/models.py` contracts + stubs merged
- [ ] Keys shared privately; `make probe` green on the VM
- [ ] Every agent session started with the opening line from section 4
