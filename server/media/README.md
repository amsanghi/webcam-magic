# Media server (Tier 3+): images + voice

Adds the **generative layer** to your home server so the site can make **couple photos, date-scene teleports, "stylize us" art, photo-dares**, and (optionally) speak in a neural voice / transcribe speech. It's a tiny zero-dependency node service (`wm-media.js`, port **8189**) that forwards to whatever heavy backend you install, and it rides the **same ngrok tunnel** you already have — `proxy.js` routes `/img /tts /stt` to it, so **nothing on the site or the URL changes.**

```
browser ──ngrok──▶ proxy.js :11435 ─┬─ /v1,/api  ──▶ Ollama   :11434   (text + vision)
                                     └─ /img,/tts,/stt ▶ wm-media :8189 ─┬─ /img ▶ Stable Diffusion :7860 (A1111-compatible)
                                                                          ├─ /tts ▶ Piper
                                                                          └─ /stt ▶ whisper.cpp
```

## Install
Run **after** `server/setup.sh`:
```bash
cd server/media && ./setup-media.sh
```
That installs the `wm-media` login agent (:8189), best-effort installs Piper + whisper.cpp with small voice models, and prints how to stand up the image backend. Images need a Stable-Diffusion server exposing the A1111 API on `:7860`:

```bash
git clone https://github.com/vladmandic/sdnext ~/sdnext   # one-time; wm.sh auto-detects ~/sdnext
```
Drop a checkpoint (SDXL is a good default on 32 GB; an uncensored SDXL/Pony checkpoint if you want spicy) into the backend's `models/Stable-diffusion` folder. After that you **never launch it by hand** — `../wm.sh` starts it (and `../wm.sh autostart` makes it boot with everything else). No `--api` flags to remember. **Face fidelity** ("looks like *us*"): add the **ReActor** face-swap or **IP-Adapter / InstantID** extension in the SD UI — `wm-media` img2img already keeps likeness at denoise ≈ 0.55.

## API (what the site calls)
| Endpoint | Body | Returns |
|---|---|---|
| `POST /img` | `{prompt, negative?, init?(dataURL), w?, h?, steps?, denoise?}` | `{image: dataURL}` — `init` present ⇒ img2img ("stylize us" from a live frame), else txt2img |
| `POST /tts` | `{text, voice?}` | `audio/wav` (Piper) |
| `POST /stt` | raw `audio/wav` body | `{text}` (whisper.cpp) |
| `GET /health` | — | `{ok, sd}` |

From the site (once tier 3 is configured), the client uses `host.ai.image(spec, fallback)` — see **Portrait Studio** and the AI photo-dares.

## Voice (Cupid speaks + hears)
Once tier 3 is on, this is **automatic** — no site setting:
- **Cupid speaks** in a neural voice: the chat 🔊 toggle now plays audio from `/tts` (Piper), falling back to the browser's robotic voice only if the server isn't reachable.
- **Mic → text** uses `/stt` (Whisper) on browsers without Web Speech (**Safari / iOS / Firefox** — i.e. her devices): tap 🎤, talk, tap again; it records, transcodes (ffmpeg), and drops the text into the box.

**Cloned voices (in *your* voices):** Piper ships pre-trained voices, not clones. To read notes/stories in your own voices, swap the `/tts` backend to **XTTS-v2** or **F5-TTS** (zero-shot cloning from a ~20s sample each) and point `wm-media` at it — the client API doesn't change. Set `PIPER_VOICE` in `~/Library/LaunchAgents/com.webcam-magic.media.plist` to pick a voice.

## Hardware notes (M1 Max 32 GB)
- **Images:** SDXL ≈ 15–30 s/image; SD1.5 + LCM ≈ 2–4 s; Flux.1-schnell ≈ 30–60 s. All fine.
- **Voice:** Piper + whisper.cpp are near-real-time and light.
- **Video/music** (LTX / AnimateDiff / MusicGen) are the heavy next step — add them as more `/…` endpoints later; they're minutes-per-clip, not live.

## Verify
```bash
curl -s localhost:8189/health
curl -s localhost:11435/img -H 'content-type: application/json' -d '{"prompt":"a cozy cabin at night"}' | head -c 80
```
If `/img` errors with "no image from SD backend", the SD server on :7860 isn't up yet.

## Security
Same as the text server: the tunnel is public-ish — don't post the URL. Front it with auth for real privacy.
