# Home AI server (Tier 3)

Run a strong AI model on your Mac and let the website call it — from either of your
laptops **or phones, anywhere in the world.** It sits at the **top of the ladder**:

```
Tier 3  home server (this)      ← best: big model on your Mac, shared to both of you
Tier 2  powerhouse in-browser   ← a capable desktop runs WebLLM (~8B) locally
Tier 1  light in-browser        ← phones/Safari run a tiny model
Tier 0  static decks            ← always works, offline
```

The site auto-degrades: if the server is reachable it's used; if not, it falls to whoever
has the more capable device; then a light model; then hand-written content.

## What it can do
- **Text** + **image understanding (vision)** out of the box via **Ollama** (OpenAI-compatible API).
- **Audio (speech-to-text)** and **image generation** as optional add-ons (below).
- Real-time **video generation** isn't practical on a laptop; video *understanding* works by
  sending frames to the vision model.

## 1. One-time setup
```bash
cd server
./setup.sh
```
This installs Ollama, registers it as a **login service** (always running, auto-starts on boot,
with CORS allowed for the site), and pulls the models:
- `hermes3:8b` — strong, steerable, low-refusal text model (the default).
- `llama3.2-vision:11b` — image understanding.
- For a **fully uncensored** text model: `ollama pull dolphin3:8b` then use it (see step 3).

M1 Max / 32 GB handles 8–11B models comfortably. Want bigger? `ollama pull qwen2.5:14b`.

## 2. Expose it over https
GitHub Pages is https, so the server needs an https URL. Pick one (no port-forwarding, no work Tailscale):

```bash
./start.sh            # Cloudflare quick tunnel — no account, prints an https URL (changes each run)
./start.sh --ngrok    # ngrok — set NGROK_DOMAIN=you.ngrok-free.app for a PERMANENT stable URL (free)
```
- **Cloudflare (default):** easiest, zero account. The URL (`https://…trycloudflare.com`) is new each run.
- **ngrok (permanent):** free account → one static domain. `ngrok config add-authtoken <token>` once, then
  `NGROK_DOMAIN=yourname.ngrok-free.app ./start.sh --ngrok` gives the **same URL every time**.

Leave the tunnel running while you use the app.

## 3. Point the site at it
Pick whichever is easier — the URL is saved and **auto-shared to your partner over the call**, so only one of you sets it:

- **On a phone (or anywhere) — tap the ✨ AI pill** (top bar) → paste the URL into "Home-server URL" → **Use server**. No console needed.
- **A link (zero typing):** open the site with the URL baked in — great to text to yourself/her:
  `https://amsanghi.github.io/webcam-magic/?ai=https://your-url-from-step-2`  (add `&aimodel=dolphin3:8b` to pick a model)
- **Desktop console:** `wmAI.configure("https://your-url-from-step-2")` (optional 2nd arg = model).

The **✨ AI** pill flips to **"AI on (server)"**. Done — both of you now use your Mac's model.

## Optional add-ons
- **Speech-to-text (Whisper):** `brew install whisper-cpp` or run a small `faster-whisper` server; the
  app's voice input already works in Chrome via the browser, this is for offline/Safari-quality STT.
- **Image generation (Stable Diffusion):** run **ComfyUI** or **AUTOMATIC1111** (exposes an API on
  another port); tunnel that port too and add a mode that posts to it. Heavy but fine on M1 Max for stills.

## Security note
- **Cloudflare/ngrok tunnels are public** — anyone with the URL can hit your Ollama (no auth by default).
  The URLs are long/unguessable; for a couple app that's usually fine. Don't post the URL publicly.
- Want it private? Put a simple auth proxy in front, or use a VPN you control. (Avoid your **work**
  Tailscale — its ACLs/visibility aren't yours to mix with this.)

## Troubleshooting
- **Pill stays "off/light":** the tunnel URL isn't reachable or `wmAI.configure` wasn't run. Re-copy the URL.
- **CORS error in console:** the LaunchAgent sets `OLLAMA_ORIGINS` to the site origin; if you serve the
  site elsewhere, add that origin (edit `com.webcam-magic.ollama.plist`, reload the agent).
- **Model refuses explicit content:** switch to `dolphin3:8b` (uncensored) via `wmAI.configure(url, "dolphin3:8b")`.
  The app also auto-retries tamer and falls back, so you never see a bare refusal.
- **Restart Ollama:** `launchctl unload ~/Library/LaunchAgents/com.webcam-magic.ollama.plist && launchctl load ~/Library/LaunchAgents/com.webcam-magic.ollama.plist`
