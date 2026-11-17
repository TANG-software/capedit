# CapEdit

**Live demo: https://tang-software.github.io/capedit/**


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

## Deploy

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

## What is built

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
