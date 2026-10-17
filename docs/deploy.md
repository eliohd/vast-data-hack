# Deploy: lab VM + Cloudflare tunnel → https://hack.elio.ltd

## Once: the tunnel (elio.ltd is on Cloudflare)

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel** (cloudflared), name
   it `hack`. Copy the **token** from the install command.
2. In the tunnel → **Public hostnames** → add `hack.elio.ltd` → Service `HTTP` →
   `localhost:8000`. WebSockets work by default.
3. On the lab VM (no sudo needed), download cloudflared and run it with the token:

   ```bash
   mkdir -p ~/bin && curl -fsSL -o ~/bin/cloudflared \
     https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   chmod +x ~/bin/cloudflared
   tmux new-session -d -s tunnel "~/bin/cloudflared tunnel run --token <TOKEN>"
   ```

   Keep the token out of the repo and out of shell history (`read -s CF_TOKEN` first, then
   `--token "$CF_TOKEN"`). This is separate from the cloudflared process the workshop uses for SSH.

Check: `curl https://hack.elio.ltd/api/health` from your laptop.

## Every deploy

```bash
make deploy VM=bc-<you>      # builds web/dist locally, rsyncs to ~/hack on the VM, restarts
```

`scripts/vm-run.sh` installs uv if missing, syncs Python deps, and runs uvicorn on
`127.0.0.1:8000` in tmux session `hack` (`tmux attach -t hack` for logs, or `/tmp/hack-server.log`).

Developing directly on the VM (Cursor remote-SSH): edit, then `./scripts/vm-run.sh`. Build the web
on your laptop (the VM has no Node) and `make deploy`, or rsync just `web/dist`.

## Credentials on the VM

Nothing to copy: `app/config.py` reads `/config/<team>.config`. Extras (e.g. `DEMO_KEY`,
`LLM_MODEL`, `GPU_BEARER_TOKEN` if the team file lacks it) go in `server/.env` on the VM, which
`deploy.sh` never overwrites.

## Protecting shared GPUs

Set `DEMO_KEY=…` in `server/.env` on the VM, then share `https://hack.elio.ltd/?key=…`. The key is
remembered in the browser and sent on every API call and WebSocket. Per-IP rate limits apply
regardless (`RATE_LIMIT_PER_MINUTE`, and 180 frames/min on the socket).

## Phone testing during development

`make phone-tunnel` gives an HTTPS `trycloudflare.com` URL for the local web dev server, so the
camera works on a phone. The dev server proxies `/api` and `/ws` to `API_TARGET` (default
`http://127.0.0.1:8000`).

## Demo-day safety

- Mirror the phone on the laptop: iPhone → cable → QuickTime → New Movie Recording → iPhone.
- Bring a hotspot; venue Wi-Fi will be busy.
- Record a backup demo video at feature freeze.
