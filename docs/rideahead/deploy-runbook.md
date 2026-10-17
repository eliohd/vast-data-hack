# RideAhead deploy runbook (run by lane C on the lab VM, at A's request)

A owns *what* is deployed (a `main` SHA that A has verified). C runs the deploy because C has
VM access. Never deploy a feature branch or uncommitted changes. Report results in
`handoff-C.md` (SHA, URL, smoke-test output; never secrets).

## 0. Before you start

```bash
git switch main && git pull --rebase
git log --oneline -1                      # must be the SHA A asked for
make verify                               # must be green
```

Your laptop builds the web (the VM has no Node): you need `pnpm` and `uv` locally (`make setup`).
You need an SSH alias for your lab VM (e.g. `bc-rishik`) in `~/.ssh/config`.

## 1. Server settings on the VM (once)

The server reads `/config/<team>.config` automatically. Add RideAhead extras to
`~/hack/server/.env` **on the VM** (`deploy.sh` never overwrites it). Values are shared privately,
never in chat, commits or handoffs.

```bash
ssh bc-<you>
mkdir -p ~/hack/server && nano ~/hack/server/.env
```

```
DEMO_KEY=<private demo key>        # required: protects shared GPUs on the public URL
RIDEAHEAD_SCENARIO=scenario_nyc.json
RIDEAHEAD_PERCEPTION=fixture       # switch to archive once your provider is merged to main
RIDEAHEAD_ROUTING=auto
ORS_API_KEY=<from Elio, privately> # optional: without it the app replays recorded ORS routes
                                   # (labelled "cached"), which is fine for the demo
```

GPU URLs / W&B keys: if they are not in the team config file, add them here too
(`COSMOS_REASON_URL`, `YOLO_URL`, `COSMOS_EMBED_URL`, `GPU_BEARER_TOKEN`, `WANDB_API_KEY`,
`WANDB_TEAM`, `WANDB_PROJECT`). Variables exported only in your interactive shell are **not**
seen by the tmux session the deploy starts.

## 2. Deploy

```bash
make deploy VM=bc-<you>
```

This builds `web/dist` locally, rsyncs the repo to `~/hack` (excluding `.env`, `.venv`,
`server/data`), runs `scripts/vm-run.sh` (uv sync, uvicorn on `127.0.0.1:8000` in tmux `hack`,
log `/tmp/hack-server.log`) and prints `/api/health`.

## 3. HTTPS for the phone

Pick one.

- **Named tunnel `https://hack.elio.ltd`**: needs Elio's tunnel token, shared privately. On the VM:
  `read -s CF_TOKEN; tmux new-session -d -s tunnel "~/bin/cloudflared tunnel run --token $CF_TOKEN"`
  (install steps in `docs/deploy.md`). Only one VM may run this tunnel at a time.
- **Quick tunnel (no account)**: on the VM
  `tmux new-session -d -s tunnel "~/bin/cloudflared tunnel --url http://localhost:8000"`, then
  `tmux attach -t tunnel` to read the `https://….trycloudflare.com` URL (changes on restart).

## 4. Smoke test (on the VM, then through the public URL)

```bash
K=<demo key>; B=http://127.0.0.1:8000     # later: B=https://<public url>
curl -fsS $B/api/health
curl -fsS -H "x-demo-key: $K" $B/api/health/upstreams | python3 -m json.tool
curl -fsS -H "x-demo-key: $K" $B/api/rideahead/capabilities | python3 -m json.tool
SID=$(curl -fsS -H "x-demo-key: $K" -H 'content-type: application/json' -XPOST \
  $B/api/rideahead/sessions -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["session_id"])')
for t in 60 200 330 450; do
  curl -fsS -H "x-demo-key: $K" -H 'content-type: application/json' -XPOST \
    $B/api/rideahead/sessions/$SID/advance -d "{\"to_s\":$t}" | python3 -c \
    'import sys,json;s=json.load(sys.stdin);print(s["replay_time_s"],[h["state"] for h in s["hazards"]],[d["action"] for d in s["decisions"]],{r["provenance"] for r in s["routes"]})'
done
```

Expected with the NYC placeholder scenario:

```
60.0  ['observed'] ['heads_up'] {'live_provider'} or {'cached_provider'}
200.0 ['observed'] ['wait']     …
330.0 ['stale']    ['continue']   # Bike B already past it
450.0 ['cleared']  ['continue']
```

Then on the phone: open `https://<public url>/?key=<demo key>`, check that the map loads, Play
advances the replay, the decision card changes, and the integration badges are honest (routing
`connected` or `cached`, Weave `connected` only if W&B is configured on the VM).

Also confirm media through the proxy works on the VM (VSS is private to it):
`curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' -H "x-demo-key: $K" "$B/api/archive/media?source=<segment_file>"`
→ `200 video/mp4` (or `206` with a Range header).

## 5. Report back (handoff-C.md)

Deployed SHA, public URL (not the key), smoke-test lines, `upstreams` summary (names + ok, no
details containing hosts/tokens), anything that failed. Logs: `tmux attach -t hack` or
`tail -100 /tmp/hack-server.log`.

## Rollback

`git switch --detach <previous good SHA> && make deploy VM=bc-<you>`, then `git switch main`.
