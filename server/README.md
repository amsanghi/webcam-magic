# Home AI server (Tier 3)

Run a strong AI model on your Mac and let the website call it — from either of your
laptops **or phones, anywhere.** It sits at the **top of the ladder**:

```
Tier 3  home server (this)      ← best: big model on your Mac, shared to both of you
Tier 2  powerhouse in-browser   ← a capable desktop runs WebLLM (~8B) locally
Tier 1  light in-browser        ← phones/Safari run a tiny model
Tier 0  static decks            ← always works, offline
```

The site auto-degrades: server if reachable → stronger device → light model → static decks.

## The idea: one fixed URL, swappable capability
- A **permanent ngrok tunnel** on your static domain → the URL **never changes**.
- Ollama serves an alias called **`active`**; the website always requests `active`.
- **`./start.sh heavy|light`** just re-points `active` to a different model (and frees the other).
- So you dial capability up/down anytime **without touching the website, the URL, or any device.**

Two models are installed:
| Command | Model | When |
|---|---|---|
| `./start.sh heavy` | `dolphin-mixtral:8x7b` — best, fully uncensored (~26 GB) | Mac idle / you're on your phone |
| `./start.sh light`  | `dolphin3:8b` — fast, uncensored, frees ~26 GB | You want to actually use the Mac |

Both are uncensored; the app's refusal-retry + static fallback mean you never see "I cannot…".

## 1. One-time setup
Grab a free **static domain** and your **authtoken** at <https://dashboard.ngrok.com>, then:
```bash
cd server
NGROK_DOMAIN=yourname.ngrok-free.app NGROK_AUTHTOKEN=your_token ./setup.sh
```
This installs Ollama + ngrok, runs **both** as always-on login services (auto-start on boot, CORS
allowed for the site, permanent tunnel), pulls both models + a vision model, and sets `active` to
the heavy model. (Run without the env vars to install everything except the tunnel, then re-run with
them once you have a domain.)

## 2. Point each device — once
The URL is fixed, so do this a single time per device (it's saved + auto-shared to your partner on a call):
- **Link (easiest, works on phones):** `https://amsanghi.github.io/webcam-magic/?ai=https://yourname.ngrok-free.app&aimodel=active`
- **Tap the ✨ AI pill** → paste `https://yourname.ngrok-free.app` → Use server.
- **Desktop console:** `wmAI.configure("https://yourname.ngrok-free.app", "active")`

The pill shows **AI on (server)**. Done forever — you never change this again.

## 3. Daily use — ONE command (`wm.sh`)
You don't run scripts every day: the core services (Ollama, proxy, ngrok, wm-media) are login
agents that come back on every boot. `wm.sh` is the single control for everything else:

```bash
./wm.sh             # bring the WHOLE stack up (text+vision, tunnel, voice, images)
./wm.sh down        # take it all down + free all the RAM
./wm.sh status      # what's running + your public URL
./wm.sh heavy       # best text model (dolphin-mixtral:8x7b)
./wm.sh light       # fast text model (dolphin3:8b) — frees the Mac
./wm.sh autostart   # ← run ONCE: makes images auto-start on boot too, so you
                    #   never run any script again
```

The one piece that isn't a login agent by default is the Stable-Diffusion image server; `./wm.sh`
starts it, and `./wm.sh autostart` turns it into a login agent so the entire stack boots on its own.
(The older `start.sh` / `stop.sh` still work, but `wm.sh` supersedes them.)

## Optional add-ons
- **Speech-to-text (Whisper):** `brew install whisper-cpp` or a small `faster-whisper` server.
- **Image generation (Stable Diffusion):** run ComfyUI / AUTOMATIC1111, tunnel its port, add a mode.
- **Max-quality text (uncensored):** an abliterated ~32B, e.g.
  `ollama pull hf.co/huihui-ai/Qwen2.5-32B-Instruct-abliterated-GGUF:Q4_K_M` (~20 GB; confirm the exact
  tag on huggingface.co), then `ollama cp <that-model> active`.

## Security note
- The ngrok tunnel is **public** — anyone with the URL can hit your Ollama (no auth by default). The
  domain is unguessable-ish; don't post it publicly. For real privacy, front it with an auth proxy.
- Uses **your own** ngrok account — nothing to do with your work Tailscale.

## Troubleshooting
- **Pill stays off/light:** the tunnel domain isn't reachable (is ngrok running? `tail -f /tmp/webcam-magic-ngrok.log`) or the URL wasn't set. Re-open the `?ai=` link.
- **`curl` to the tunnel works but the site can't reach it (403 / CORS preflight):** browser fetches through free ngrok need the `ngrok-skip-browser-warning` header, but Ollama's fixed CORS allow-list rejects that header on preflight, and Ollama also 403s any non-localhost `Host`. That's what `proxy.js` (`:11435`) solves — it answers the preflight permissively and rewrites the Host. **ngrok must point at the proxy (11435), not Ollama (11434)** — `setup.sh` wires this. Chain: browser → ngrok → proxy `:11435` → Ollama `:11434`. If the pill won't connect, check the proxy: `curl -s localhost:11435/api/tags` and `tail /tmp/webcam-magic-proxy.log`.
- **First message slow after a switch:** normal — Ollama is loading the new model; subsequent ones are fast.
- **CORS error:** the Ollama LaunchAgent sets `OLLAMA_ORIGINS` to the site origin — keep it if you fork the site.
- **Restart everything:** `launchctl unload ~/Library/LaunchAgents/com.webcam-magic.{ollama,ngrok}.plist && launchctl load ~/Library/LaunchAgents/com.webcam-magic.{ollama,ngrok}.plist`
