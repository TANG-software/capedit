# CapEdit

A browser video editor with word-level auto captions. Light three-pane workspace,
full-width timeline, transcript you can edit line by line.

Static site — no build step, no framework, no bundler. One optional serverless
function adds cloud transcription.

```
index.html  app.js  style.css       the whole editor
functions/api/transcribe.js         Cloudflare Pages Function
netlify/functions/transcribe.mjs    Netlify adapter for the same code
shared/transcribe.js                provider calls, normalised to {w,s,e} words
```

## Run locally

```bash
npx serve .        # any static server; file:// will not work for captions
```

Captions work without a server (the browser transcribes locally). To exercise the
cloud path locally, run `netlify dev` or `wrangler pages dev .` with a key set.

## Deploy on Render

Two ways, same repo.

**A. Web Service (recommended — cloud captions work)**

| Field | Value |
|---|---|
| Type | Web Service |
| Repository | `TANG-software/capedit` |
| Branch | `main` |
| Runtime | Node |
| Region | Singapore (closest to India) |
| Build Command | `npm install --no-audit --no-fund` |
| Start Command | `node server.mjs` |
| Instance Type | Free |
| Health Check Path | `/` |
| Environment variable | `GROQ_API_KEY` = your key (Secret) |

`server.mjs` serves the editor and `/api/transcribe` from one process, with no
dependencies. Add `STT_PROVIDER=groq` only if you set more than one key.

**B. Static Site (no server, captions run in the browser)**

| Field | Value |
|---|---|
| Type | Static Site |
| Repository | `TANG-software/capedit` |
| Branch | `main` |
| Build Command | *(leave empty)* |
| Publish Directory | `.` |
| Environment variables | none |

Or use the included `render.yaml`: **New + → Blueprint → pick this repo**, and
Render fills the form in for you.

Note: Render's free instance sleeps after ~15 minutes idle, so the first caption
after a quiet spell waits ~40 s while it wakes. The static site never sleeps but
has no server, so captions fall back to the in-browser engine.

## Deploy elsewhere

| Host | Captions | Command |
|---|---|---|
| **Cloudflare Pages** (recommended) | Cloud transcription via `/api/transcribe` | connect repo, set env var, build command empty, output `/` |
| **Netlify** | Cloud transcription via `/api/transcribe` (redirect in `netlify.toml`) | connect repo, set env var |
| **GitHub Pages** | On-device only (Pages cannot run functions) | push to `main`, workflow included |

`index.html` at the repository root is the site, so all three hosts work from the
same tree.

## API keys

Set exactly one as an environment variable on the host. Nothing is exposed to the
browser.

| Variable | Provider | Model | Notes |
|---|---|---|---|
| `GROQ_API_KEY` | Groq | whisper-large-v3-turbo | Fastest, generous free tier — start here |
| `OPENAI_API_KEY` | OpenAI | whisper-1 | Paid, very accurate |
| `DEEPGRAM_API_KEY` | Deepgram | nova-2 | Tightest word timings |
| `STT_PROVIDER` | — | `groq` / `openai` / `deepgram` | Optional, when more than one key is set |

Get keys at `console.groq.com`, `platform.openai.com`, `console.deepgram.com`.

That is the complete list. No storage, CDN, database or email keys are needed —
video never leaves the browser, only a clip's audio goes to the function.

### How the key stays secret

The browser posts audio to `/api/transcribe` on your own domain. That function
holds the key and calls the provider. If no function is deployed (GitHub Pages),
the editor silently falls back to its built-in speech engine, so the feature
never breaks — it just runs slower and less accurately.

## Editing a transcript

After **Auto caption**, the left panel lists every line. Each line is a textarea:
fix a misheard word and the word timings for that line are recomputed across its
original span, so the karaoke highlight keeps up. Click a timestamp to jump there.

## Noise removal

Two modes, in the Audio panel of any video or audio clip.

**Fast** runs in the browser: STFT, per-bin noise floor from the 20th percentile
over time, spectral subtraction with a residual floor, inverse STFT. Under a
second for a minute of audio, no network, no model.

**Voice AI** also runs on the device, and it is the one to use for speech.
RNNoise — the model Jitsi Meet uses for live noise suppression — compiled to
WebAssembly, 112 KB, processing 480-sample frames at 48 kHz. Measured on real
speech with white noise added: noise floor 0.0416 → 0.0020 (95% gone) while
speech stayed at 97%, in about 3 seconds for 11 seconds of audio. No server, no
upload, works offline.

**Studio** is optional and needs a server: it sends the clip's audio to `denoise/denoise_api.py`, a FastAPI service
with three backends — `demucs` (Hybrid-Transformer Demucs vocal isolation),
`dfn` (DeepFilterNet3) and `spectral` (numpy Wiener filter). The editor shows
whichever backend the service reports and installs the returned audio as the
clip's new track. On Render the free instance gives you `spectral`; Demucs needs
torch and about 1.5–2 GB of RAM, so a Standard instance.

Both modes write a cleaned track that plays and exports with the video, and the
original is one tap away. Note the licence: the Demucs backend uses Meta's
htdemucs weights (MIT) via torchaudio — check the licence of any model you ship
commercially.

## What is built

**Look and finish** — 24 graded looks with an intensity slider (Warm, Golden hour,
Sunset, Cool, Teal & orange, Night, B&W, Noir, Mono, Vivid, Punch, Fade, Matte,
Vintage, Retro, Film, Cinematic, Drama, Dream, Soft, Crisp, Sepia, Neon), plus
per-clip brightness, contrast, saturation and hue.

**Titles** — 10 title presets (bold white, lower third, caption bar, mint
highlight, news strap, cinema title, typewriter, neon glow, big impact, minimal)
and 15 animations (fade, slide up/down/left/right, pop, scale in, rotate in,
typewriter, word by word, bounce, wave, blur in, glow).

**Compositing** — 9 blend modes and 8 entry transitions (dissolve, wipe right,
wipe up, slide up, zoom, blur, flash) with a one-tap overlap helper.

**Templates** — 6 one-tap project templates: YouTube video, Instagram Reel,
Wedding highlight, Product promo, News explainer, Podcast clip. Each sets the
aspect ratio, a look on every clip, the caption style and a matching title.

**Captions** — 6 caption presets on top of the editable word-level transcript.

**Projects** — saved on the device in IndexedDB, media included, so a project
reopens intact without re-importing anything.

Multi-track timeline (drag, trim, split, duplicate, snapping, zoom) · video,
overlay, text and audio tracks · scale/position/rotate/flip · 10 filters plus
brightness/contrast/saturation/hue · styled text with 5 animations · word-level
captions with editable transcript and SRT export · volume, fades, voiceover ·
0.25×–3× speed · 9:16, 1:1, 4:5, 3:4, 16:9, 21:9 at 1080p · MP4/WebM export ·
undo/redo · project save and load.

## What is not built (honest list vs Clipchamp)

Transitions, keyframes, masks, chroma key, blend modes, speed ramps, stock
library, templates, brand kit, auto-reframe, beat sync, text-to-speech, cloud
project storage, multi-user collaboration. The layout follows Clipchamp's
arrangement (library left, preview centre, properties right, timeline below);
the feature set does not.

## Privacy

Video and images are processed in the browser and never uploaded. When cloud
transcription is enabled, only the selected clip's audio (16 kHz mono WAV) is sent
to the function and on to the configured provider. The service keeps no copy.

## License

MIT — see `LICENSE`.
