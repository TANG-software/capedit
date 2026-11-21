#!/usr/bin/env python3
"""
denoise_api.py - background-noise removal for audio and video, in one file.

A single drop-in file: the denoising engine, the HTTP API, and a working web page.
No other project files, no cross-imports.

RUN IT
    pip install fastapi "uvicorn[standard]" python-multipart soundfile imageio-ffmpeg
    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    python denoise_api.py
    # -> http://localhost:8000   (drag-drop page; API docs at /docs)

USE IT FROM THE COMMAND LINE
    python denoise_api.py --cli interview.mp4 -o clean.mp4
    python denoise_api.py --cli voice.wav -o voice_clean.wav --backend demucs --strength 1.0

PUT IT ON YOUR EDITING WEBSITE
    Serve this file on any box, then from your editor:

        <iframe src="https://YOUR-HOST/" width="100%" height="640" style="border:0"></iframe>

    ...or call the API and show the result in your own player:

        const fd = new FormData();
        fd.append("file", file); fd.append("backend", "auto"); fd.append("strength", "0.85");
        const {job_id} = await (await fetch(API + "/api/jobs", {method: "POST", body: fd})).json();
        // poll GET /api/jobs/{job_id} until status == "done", then:
        // GET /api/jobs/{job_id}/result  -> the cleaned file

API
    GET    /api/health              backends available, version
    POST   /api/jobs                multipart file -> {"job_id": ...}
    GET    /api/jobs/{id}           {"status", "progress", "elapsed", "error"}
    GET    /api/jobs/{id}/result    the cleaned file (video stream untouched)
    DELETE /api/jobs/{id}           delete job and files

ENGINES
    demucs    Hybrid-Transformer Demucs vocal isolation - strongest, needs torch
    dfn       DeepFilterNet3 - needs `pip install DeepFilterNet` + Rust
    spectral  built-in Wiener filter, numpy only, always available
    auto      best available (default)

ENV
    PORT, DENOISE_API_KEY, DENOISE_WORKERS, DENOISE_MAX_MB, DENOISE_WORK

LICENCE NOTE: uses Meta's htdemucs weights (MIT) via torchaudio. Check the licence
of any model you ship commercially.
"""



import argparse
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

# ----------------------------------------------------------------------------
# ffmpeg discovery
# ----------------------------------------------------------------------------


def ffmpeg_bin():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit(
            "ffmpeg not found. Install ffmpeg, or `pip install imageio-ffmpeg` "
            "to get a bundled static build."
        )


FFMPEG = None


def _run(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{p.stdout[-2000:]}")
    return p.stdout


def probe(path):
    """Return (has_video, has_audio, duration_s) using ffmpeg's banner output."""
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    ).stdout
    has_video = "Video:" in out
    has_audio = "Audio:" in out
    dur = 0.0
    for line in out.splitlines():
        if "Duration:" in line:
            try:
                t = line.split("Duration:")[1].split(",")[0].strip()
                h, m, s = t.split(":")
                dur = int(h) * 3600 + int(m) * 60 + float(s)
            except Exception:
                pass
            break
    return has_video, has_audio, dur


def channels_of(path):
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    ).stdout
    for line in out.splitlines():
        if "Audio:" in line:
            if "stereo" in line:
                return 2
            if "mono" in line:
                return 1
            return 2
    return 1


def extract_audio(src, sr, dst, channels=1):
    _run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
          "-i", src, "-vn", "-ac", str(channels), "-ar", str(sr),
          "-c:a", "pcm_f32le", dst])
    return dst


def write_audio(x, sr, dst, channels=1):
    import soundfile as sf

    x = np.asarray(x, dtype=np.float32)
    if channels == 2 and x.ndim == 1:
        x = np.stack([x, x], axis=1)
    sf.write(dst, x, sr, subtype="PCM_16")
    return dst


def read_audio(path):
    import soundfile as sf

    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return x, sr


def remux(video_src, audio_src, dst):
    """Replace the audio of video_src with audio_src, video stream copied as-is."""
    _run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
          "-i", video_src, "-i", audio_src,
          "-map", "0:v:0", "-map", "1:a:0",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
          "-shortest", "-movflags", "+faststart", dst])
    return dst


# ----------------------------------------------------------------------------
# signal helpers
# ----------------------------------------------------------------------------


def resample(x, sr_in, sr_out):
    if sr_in == sr_out:
        return x
    try:
        import torch
        import torchaudio

        t = torch.from_numpy(np.asarray(x, dtype=np.float32))
        return torchaudio.functional.resample(t, sr_in, sr_out).numpy()
    except Exception:
        # linear interpolation fallback
        n_out = int(round(len(x) * sr_out / sr_in))
        xi = np.linspace(0, len(x) - 1, n_out)
        return np.interp(xi, np.arange(len(x)), x).astype(np.float32)


def si_sdr(est, ref):
    """Scale-invariant SDR in dB. Higher is better."""
    n = min(len(est), len(ref))
    est, ref = est[:n].astype(np.float64), ref[:n].astype(np.float64)
    est = est - est.mean()
    ref = ref - ref.mean()
    a = np.dot(est, ref) / (np.dot(ref, ref) + 1e-12)
    target = a * ref
    noise = est - target
    return 10 * np.log10((np.dot(target, target) + 1e-12) / (np.dot(noise, noise) + 1e-12))


def snr_db(x, ref):
    n = min(len(x), len(ref))
    x, ref = x[:n].astype(np.float64), ref[:n].astype(np.float64)
    return 10 * np.log10((np.dot(ref, ref) + 1e-12) / (np.dot(x - ref, x - ref) + 1e-12))


# ----------------------------------------------------------------------------
# backend: spectral (numpy only)
# ----------------------------------------------------------------------------


def _stft(x, n_fft=1024, hop=256):
    win = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    pad = n_fft
    xp = np.concatenate([np.zeros(pad, np.float32), x.astype(np.float32),
                         np.zeros(pad + n_fft, np.float32)])
    n_frames = 1 + (len(xp) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n_frames)[:, None]
    frames = xp[idx] * win
    return np.fft.rfft(frames, axis=1), win, pad, hop, n_fft


def _istft(spec, win, pad, hop, n_fft, length):
    frames = np.fft.irfft(spec, n=n_fft, axis=1).astype(np.float32) * win
    out = np.zeros(pad * 2 + n_fft + len(frames) * hop, np.float32)
    wsum = np.zeros_like(out)
    for i in range(frames.shape[0]):
        s = i * hop
        out[s:s + n_fft] += frames[i]
        wsum[s:s + n_fft] += win ** 2
    out = out / np.maximum(wsum, 1e-8)
    return out[pad:pad + length]


def spectral_denoise(x, sr, strength=0.8, n_fft=1024):
    """Statistical Wiener filter with minimum-statistics noise tracking.

    strength 0 = untouched, 1 = maximum suppression (more artefacts).
    """
    if len(x) < n_fft * 2:
        return x
    spec, win, pad, hop, n_fft = _stft(x, n_fft, n_fft // 4)
    P = np.abs(spec) ** 2

    # recursive power smoothing (fast attack, slow release)
    Ps = np.empty_like(P)
    acc = P[0]
    for t in range(P.shape[0]):
        a = 0.55 if P[t].mean() > acc.mean() else 0.90
        acc = a * acc + (1 - a) * P[t]
        Ps[t] = acc

    # minimum statistics over a ~1.2 s window
    win_frames = max(3, int(1.2 * sr / hop))
    try:
        from scipy.ndimage import minimum_filter1d

        N = minimum_filter1d(Ps, size=win_frames, axis=0, mode="nearest") * 1.5
    except Exception:
        N = np.empty_like(Ps)
        for b in range(Ps.shape[1]):
            col = Ps[:, b]
            for t in range(len(col)):
                N[t, b] = col[max(0, t - win_frames):t + 1].min()
        N *= 1.5

    # over-subtraction driven by strength
    alpha = 0.8 + 2.6 * strength
    G = np.sqrt(np.maximum(0.0, 1.0 - alpha * N / (P + 1e-12)))
    G = np.clip(G, 0.0, 1.0)

    # median smoothing across frequency (kills isolated peaks / musical noise)
    try:
        from scipy.ndimage import median_filter

        G = median_filter(G, size=(1, 3), mode="nearest")
    except Exception:
        pass

    # time smoothing of the gain
    for t in range(1, G.shape[0]):
        G[t] = 0.6 * G[t] + 0.4 * G[t - 1]

    # spectral floor + hard gate
    floor = 0.02 * (1.0 - strength) + 0.001
    gate = 0.01 + 0.10 * (1.0 - strength)
    G = np.where(G < gate, 0.0, np.maximum(G, floor))

    y = _istft(spec * G, win, pad, hop, n_fft, len(x))
    return y.astype(np.float32)


# ----------------------------------------------------------------------------
# backend: demucs (neural vocal isolation)
# ----------------------------------------------------------------------------


_DEMUCS_CACHE = {}


def _total_ram_gb():
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):
        return 0.0


def _keep_model():
    """Keep the ~300 MB model resident between jobs when the box has room."""
    env = os.environ.get("DENOISE_CACHE_MODEL")
    if env is not None:
        return env.strip().lower() not in ("0", "false", "no", "off")
    return _total_ram_gb() >= 4.0


def demucs_denoise(x, sr, strength=0.8, chunk_s=2.0, hop_s=1.5, verbose=True, progress_cb=None):
    """Isolate the vocal/speech stem with Hybrid-Transformer Demucs.

    Memory-adaptive: shrinks the analysis window if the box runs out of RAM,
    and keeps the model loaded between jobs when the machine can afford it.
    """
    import torch
    import torchaudio

    torch.set_num_threads(max(1, (os.cpu_count() or 2)))
    bundle = torchaudio.pipelines.HDEMUCS_HIGH_MUSDB_PLUS
    sr_m = bundle.sample_rate

    model = _DEMUCS_CACHE.get("htdemucs")
    if model is None:
        if verbose:
            print(f"  loading htdemucs (sr={sr_m}) ...", flush=True)
        model = bundle.get_model()
        model.eval()
        if _keep_model():
            _DEMUCS_CACHE["htdemucs"] = model

    xm = resample(x, sr, sr_m)
    while chunk_s >= 0.5:
        try:
            return _demucs_pass(model, xm, sr_m, sr, chunk_s, hop_s, strength, verbose, progress_cb)
        except RuntimeError as e:
            msg = str(e).lower()
            if "allocate" not in msg and "out of memory" not in msg:
                raise
            chunk_s -= 0.5
            if verbose:
                print(f"  out of memory, retrying with {chunk_s}s window", flush=True)
    raise RuntimeError(
        "htdemucs needs about 1.5 GB of free RAM and could not run here. "
        "Use backend 'spectral' on this machine, or give the service more memory."
    )


def _demucs_pass(model, xm, sr_m, sr_out, chunk_s, hop_s, strength, verbose, progress_cb=None):
    import torch

    CH = int(chunk_s * sr_m)
    HOP = int(hop_s * sr_m)
    out = np.zeros(len(xm), np.float32)
    wsum = np.zeros(len(xm), np.float32)
    w = np.hanning(CH + 2)[1:-1].astype(np.float32)

    starts = list(range(0, max(1, len(xm) - CH // 2), HOP))
    if not starts:
        starts = [0]
    for i, s in enumerate(starts):
        seg = xm[s:s + CH]
        if len(seg) < sr_m // 4:
            break
        pad_n = CH - len(seg)
        if pad_n > 0:
            seg = np.concatenate([seg, np.zeros(pad_n, np.float32)])
        t = torch.from_numpy(seg)[None, None, :].repeat(1, 2, 1)
        with torch.inference_mode():
            est = model(t)          # (1, n_sources, 2, T)
        voc = est[0, 3].mean(0).numpy()[:CH]
        n = len(seg) - pad_n
        voc = voc[:n]
        ww = w[:n]
        out[s:s + n] += voc * ww
        wsum[s:s + n] += ww
        if verbose:
            print(f"    window {i + 1}/{len(starts)}  ({s / sr_m:.1f}s)", flush=True)
        if progress_cb:
            progress_cb((i + 1) / max(1, len(starts)))

    out = out / np.maximum(wsum, 1e-6)
    # strength = how much of the extracted voice we keep vs the original mix
    dry = resample(xm, sr_m, sr_out) if sr_out != sr_m else xm
    wet = resample(out, sr_m, sr_out) if sr_out != sr_m else out
    n = min(len(dry), len(wet))
    y = (strength * wet[:n] + (1 - strength) * dry[:n]).astype(np.float32)
    return y


# ----------------------------------------------------------------------------
# backend: DeepFilterNet3
# ----------------------------------------------------------------------------


def dfn_denoise(x, sr, strength=0.8, verbose=True):
    try:
        import df
    except Exception:
        raise RuntimeError(
            "DeepFilterNet is not installed. `pip install DeepFilterNet` "
            "(needs a Rust toolchain on first build) or use --backend demucs."
        )
    import torch

    sr_m = 48000
    xm = resample(x, sr, sr_m)
    if verbose:
        print("  loading DeepFilterNet3 ...", flush=True)
    model = df.DeepFilterNet3()
    t = torch.from_numpy(xm)[None, :]
    hop = sr_m * 30  # 30 s blocks keeps memory flat on long files
    outs = []
    with torch.inference_mode():
        for s in range(0, len(xm), hop):
            seg = t[:, s:s + hop]
            enh, _ = model.enhance(seg, reset=True)
            outs.append(enh[0].numpy())
    y = np.concatenate(outs) if outs else np.zeros(0, np.float32)
    y = resample(y, sr_m, sr)
    n = min(len(x), len(y))
    return (strength * y[:n] + (1 - strength) * x[:n]).astype(np.float32)


# ----------------------------------------------------------------------------
# backend selection
# ----------------------------------------------------------------------------


def available_backends():
    have = {"spectral": True, "demucs": False, "dfn": False}
    try:
        import torch, torchaudio  # noqa: F401

        have["demucs"] = True
    except Exception:
        pass
    try:
        import df  # noqa: F401

        have["dfn"] = True
    except Exception:
        pass
    return have


def run_backend(name, x, sr, strength, verbose=True, progress_cb=None):
    if name == "demucs":
        return demucs_denoise(x, sr, strength, verbose=verbose, progress_cb=progress_cb)
    if name == "dfn":
        return dfn_denoise(x, sr, strength, verbose=verbose)
    return spectral_denoise(x, sr, strength)


def post_process(y, sr, strength, hard_gate=False):
    """Peak-normalise and optionally mute near-silent residue."""
    y = np.asarray(y, np.float32)
    if hard_gate:
        frame = int(0.02 * sr)
        n = len(y) // frame
        if n:
            e = np.array([np.sqrt(np.mean(y[i * frame:(i + 1) * frame] ** 2)) for i in range(n)])
            thr = max(1e-4, np.percentile(e, 90) * 10 ** (-45 / 20))
            gate = np.repeat(e < thr, frame)
            y[:len(gate)] = np.where(gate, 0.0, y[:len(gate)])
    peak = float(np.max(np.abs(y)) or 1.0)
    if peak > 0.99:
        y = y * (0.99 / peak)
    return y


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------


def main(argv=None):
    global FFMPEG
    ap = argparse.ArgumentParser(
        description="Remove background noise from audio and video files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("input", help="input audio or video file")
    ap.add_argument("-o", "--output", help="output file (default: <input>_clean.<ext>)")
    ap.add_argument("--backend", default="auto",
                    choices=["auto", "demucs", "dfn", "spectral"])
    ap.add_argument("--strength", type=float, default=0.85,
                    help="0 = untouched, 1 = maximum suppression (default 0.85)")
    ap.add_argument("--sample-rate", type=int, default=0,
                    help="internal working rate (default: backend default)")
    ap.add_argument("--hard-gate", action="store_true",
                    help="mute residual noise in silent passages")
    ap.add_argument("--reference", help="clean reference file, prints SI-SDR/SNR before vs after")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--progress", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    FFMPEG = ffmpeg_bin()
    verbose = not args.quiet

    src = args.input
    if not os.path.exists(src):
        sys.exit(f"input not found: {src}")

    has_video, has_audio, dur = probe(src)
    if not has_audio:
        sys.exit("input has no audio stream")

    base, ext = os.path.splitext(src)
    out = args.output or f"{base}_clean{ext if has_video else '.wav'}"
    n_ch = channels_of(src)

    backend = args.backend
    if backend == "auto":
        avail = available_backends()
        backend = "dfn" if avail["dfn"] else ("demucs" if avail["demucs"] else "spectral")
    if verbose:
        print(f"input     : {src}  ({'video+audio' if has_video else 'audio'}, {dur:.1f}s)")
        print(f"backend   : {backend}   strength={args.strength}")

    sr = args.sample_rate or {"demucs": 44100, "dfn": 48000}.get(backend, 16000)

    tmp = tempfile.mkdtemp(prefix="denoise_")
    try:
        wav_in = os.path.join(tmp, "in.wav")
        extract_audio(src, sr, wav_in, channels=1)
        x, real_sr = read_audio(wav_in)
        if verbose:
            print(f"extracted : {len(x) / real_sr:.1f}s @ {real_sr} Hz")

        def _cb(p):
            print(f"PROGRESS {0.15 + 0.70 * float(p):.3f}", flush=True)

        cb = _cb if args.progress else None
        y = run_backend(backend, x, real_sr, args.strength, verbose=verbose, progress_cb=cb)
        if args.progress:
            print("PROGRESS 0.900", flush=True)
        y = post_process(y, real_sr, args.strength, args.hard_gate)

        if args.reference:
            ref, ref_sr = read_audio(args.reference)
            ref = resample(ref, ref_sr, real_sr)
            print(f"SI-SDR  before: {si_sdr(x, ref):6.2f} dB   after: {si_sdr(y, ref):6.2f} dB")
            print(f"SNR     before: {snr_db(x, ref):6.2f} dB   after: {snr_db(y, ref):6.2f} dB")

        wav_out = os.path.join(tmp, "out.wav")
        write_audio(y, real_sr, wav_out, channels=2 if has_video else 1)

        if has_video:
            remux(src, wav_out, out)
        else:
            shutil.copyfile(wav_out, out)
        if verbose:
            print(f"wrote     : {out}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ----------------------------------------------------------------------------
# HTTP API
# ----------------------------------------------------------------------------



import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse


VERSION = "1.1.0"
WORK = os.environ.get("DENOISE_WORK", os.path.join(tempfile.gettempdir(), "denoise-jobs"))
MAX_MB = int(os.environ.get("DENOISE_MAX_MB", "500"))
WORKERS = int(os.environ.get("DENOISE_WORKERS", "1"))
API_KEY = os.environ.get("DENOISE_API_KEY", "")
HERE = os.path.dirname(os.path.abspath(__file__))

os.makedirs(WORK, exist_ok=True)
FFMPEG = ffmpeg_bin()

app = FastAPI(title="Denoise API", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("DENOISE_ALLOW_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: dict = {}
POOL = ThreadPoolExecutor(max_workers=max(1, WORKERS))


def _auth(key):
    if API_KEY and key != API_KEY:
        raise HTTPException(status_code=401, detail="bad or missing X-API-Key")


def _cleanup(job):
    for p in (job.get("src"), job.get("dst")):
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except OSError:
            pass


def _work(job_id, backend, strength, gate):
    """Run one job in its own process.

    A separate process, not a thread, on purpose: the neural model needs ~1.3 GB,
    and a fresh process guarantees every byte is returned to the OS when the job
    ends. It also means a crash in the model cannot take the API down.
    """
    job = JOBS[job_id]
    job.update(status="processing", started=time.time(), progress=0.03)
    try:
        cmd = [sys.executable, os.path.abspath(__file__), "--cli", job["src"],
               "-o", job["dst"], "--backend", backend,
               "--strength", f"{strength:.3f}", "--progress", "--quiet"]
        if gate:
            cmd.append("--hard-gate")

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, bufsize=1)
        err_buf = []
        drain = threading.Thread(target=lambda: err_buf.append(proc.stderr.read()), daemon=True)
        drain.start()
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("PROGRESS "):
                try:
                    job["progress"] = min(0.99, round(float(line.split()[1]), 3))
                except (IndexError, ValueError):
                    pass
        code = proc.wait()
        drain.join(timeout=10)

        if code != 0:
            tail = (err_buf[0] if err_buf else "").strip().splitlines()
            raise RuntimeError(tail[-1] if tail else f"worker exited with code {code}")
        if not os.path.exists(job["dst"]):
            raise RuntimeError("worker produced no output file")
        job.update(status="done", progress=1.0)
    except Exception as e:  # noqa: BLE001 - surfaced to the client as JSON
        job.update(status="failed", error=f"{type(e).__name__}: {e}")
    finally:
        job["elapsed"] = round(time.time() - job.get("started", time.time()), 1)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "version": VERSION,
        "backends": available_backends(),
        "workers": WORKERS,
        "max_upload_mb": MAX_MB,
    }


@app.post("/api/jobs")
async def create_job(
    file: UploadFile = File(...),
    backend: str = Form("auto"),
    strength: float = Form(0.85),
    hard_gate: bool = Form(False),
    x_api_key: str = Header(None),
):
    _auth(x_api_key)
    if backend not in ("auto", "demucs", "dfn", "spectral"):
        raise HTTPException(400, "backend must be auto|demucs|dfn|spectral")
    strength = min(1.0, max(0.0, float(strength)))
    if backend == "auto":
        b = available_backends()
        backend = "dfn" if b["dfn"] else ("demucs" if b["demucs"] else "spectral")

    job_id = uuid.uuid4().hex[:12]
    job_dir = os.path.join(WORK, job_id)
    os.makedirs(job_dir, exist_ok=True)

    name = os.path.basename(file.filename or "upload")
    stem, ext = os.path.splitext(name)
    ext = ext.lower() or ".wav"
    src = os.path.join(job_dir, "input" + ext)

    size = 0
    with open(src, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_MB * 1024 * 1024:
                f.close()
                shutil.rmtree(job_dir, ignore_errors=True)
                raise HTTPException(413, f"file larger than {MAX_MB} MB")
            f.write(chunk)
    if size == 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, "empty upload")

    has_video, has_audio, _ = probe(src)
    if not has_audio:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, "no audio stream in this file")

    dst = os.path.join(job_dir, f"{stem}_clean{ext if has_video else '.wav'}")
    JOBS[job_id] = {
        "id": job_id, "status": "queued", "progress": 0.0, "backend": backend,
        "strength": strength, "hard_gate": gate_flag(hard_gate),
        "src": src, "dst": dst, "created": time.time(),
        "filename": os.path.basename(dst), "video": has_video, "bytes": size,
    }
    POOL.submit(_work, job_id, backend, strength, gate_flag(hard_gate))
    return {"job_id": job_id, "status": "queued", "backend": backend}


def gate_flag(v):
    return bool(v)


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str, x_api_key: str = Header(None)):
    _auth(x_api_key)
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress", 0.0),
        "elapsed": job.get("elapsed", round(time.time() - job["created"], 1)),
        "duration": job.get("duration"),
        "backend": job["backend"],
        "video": job.get("video", False),
        "error": job.get("error"),
    }


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: str, x_api_key: str = Header(None)):
    _auth(x_api_key)
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    if job["status"] != "done":
        raise HTTPException(409, f"job is {job['status']}")
    return FileResponse(job["dst"], filename=job["filename"],
                        media_type="video/mp4" if job["video"] else "audio/wav")


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str, x_api_key: str = Header(None)):
    _auth(x_api_key)
    job = JOBS.pop(job_id, None)
    if not job:
        raise HTTPException(404, "no such job")
    _cleanup(job)
    shutil.rmtree(os.path.dirname(job["src"]), ignore_errors=True)
    return {"deleted": job_id}


# ----------------------------------------------------------------------------
# demo page (embedded, so this file stands alone)
# ----------------------------------------------------------------------------

DEMO_PAGE = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Denoise — remove background noise</title>
<style>
  :root{
    --bg:#0b0d12; --panel:#12151d; --line:#232a36; --text:#e8eaf2;
    --muted:#8b93a7; --accent:#6c8cff; --ok:#4ade80; --err:#f87171;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .wrap{width:100%;max-width:680px}
  h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
  p.sub{color:var(--muted);margin:0 0 22px;font-size:14px}
  .drop{border:1.5px dashed var(--line);border-radius:14px;background:var(--panel);
        padding:38px 22px;text-align:center;cursor:pointer;transition:.15s}
  .drop:hover,.drop.over{border-color:var(--accent);background:#151a26}
  .drop b{color:var(--accent)}
  .drop small{display:block;color:var(--muted);margin-top:8px;font-size:12.5px}
  .file{display:none;margin-top:16px;background:var(--panel);border:1px solid var(--line);
        border-radius:12px;padding:14px 16px;font-size:13.5px;color:var(--muted)}
  .file b{color:var(--text)}
  .opts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}
  label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px;
        text-transform:uppercase;letter-spacing:.06em}
  select,input[type=range]{width:100%}
  select{background:var(--panel);color:var(--text);border:1px solid var(--line);
         border-radius:9px;padding:9px 10px;font-size:14px}
  input[type=range]{accent-color:var(--accent)}
  button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:11px;
         background:var(--accent);color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  button:disabled{opacity:.45;cursor:not-allowed}
  .bar{height:7px;background:#1b202b;border-radius:99px;overflow:hidden;margin-top:20px;display:none}
  .bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .35s}
  .status{margin-top:12px;font-size:13.5px;color:var(--muted);min-height:20px}
  .status.ok{color:var(--ok)} .status.err{color:var(--err)}
  a.dl{display:none;margin-top:14px;text-align:center;padding:12px;border-radius:11px;
       background:#16241c;border:1px solid #235c39;color:var(--ok);
       text-decoration:none;font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <h1>Remove background noise</h1>
  <p class="sub">Audio or video. The picture is never re-encoded — only the sound is rebuilt.</p>

  <div class="drop" id="drop">
    <div>Drop a file here, or <b>browse</b></div>
    <small>mp4 · mov · mkv · wav · mp3 · m4a — up to 500 MB</small>
    <input type="file" id="picker" hidden accept="audio/*,video/*">
  </div>

  <div class="file" id="fileInfo"></div>

  <div class="opts">
    <div>
      <label>Engine</label>
      <select id="backend">
        <option value="auto">Auto (best available)</option>
        <option value="demucs">Demucs — strongest</option>
        <option value="spectral">Spectral — fastest</option>
      </select>
    </div>
    <div>
      <label>Strength <span id="sv">85%</span></label>
      <input type="range" id="strength" min="0" max="100" value="85">
    </div>
  </div>

  <button id="go" disabled>Denoise</button>
  <div class="bar" id="bar"><i></i></div>
  <div class="status" id="status"></div>
  <a class="dl" id="dl" download>Download cleaned file</a>
</div>

<script>
const $ = s => document.querySelector(s);
const drop = $('#drop'), picker = $('#picker'), go = $('#go');
const bar = $('#bar'), fill = bar.querySelector('i'), status_ = $('#status'), dl = $('#dl');
let file = null, timer = null;

drop.onclick = () => picker.click();
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => {
  e.preventDefault(); drop.classList.remove('over');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
};
picker.onchange = () => picker.files[0] && setFile(picker.files[0]);

$('#strength').oninput = e => $('#sv').textContent = e.target.value + '%';

function setFile(f){
  file = f;
  const mb = (f.size / 1048576).toFixed(1);
  $('#fileInfo').style.display = 'block';
  $('#fileInfo').innerHTML = `<b>${f.name}</b> · ${mb} MB`;
  go.disabled = false;
  dl.style.display = 'none';
  status_.textContent = ''; status_.className = 'status';
  bar.style.display = 'none'; fill.style.width = '0%';
}

function setStatus(t, cls=''){ status_.textContent = t; status_.className = 'status ' + cls; }

go.onclick = async () => {
  if (!file) return;
  go.disabled = true; dl.style.display = 'none';
  bar.style.display = 'block'; fill.style.width = '4%';
  setStatus('Uploading…');

  const fd = new FormData();
  fd.append('file', file);
  fd.append('backend', $('#backend').value);
  fd.append('strength', ($('#strength').value / 100).toFixed(2));

  let job;
  try {
    const r = await fetch('/api/jobs', { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    job = await r.json();
  } catch (err) {
    setStatus('Upload failed: ' + err.message, 'err'); go.disabled = false; return;
  }

  setStatus('Processing…');
  timer = setInterval(async () => {
    let s;
    try {
      s = await (await fetch('/api/jobs/' + job.job_id)).json();
    } catch { return; }

    const pct = Math.max(4, Math.round((s.progress || 0) * 100));
    fill.style.width = pct + '%';

    if (s.status === 'done') {
      clearInterval(timer); fill.style.width = '100%';
      setStatus(`Done in ${s.elapsed}s — ${s.video ? 'video' : 'audio'} cleaned`, 'ok');
      dl.href = '/api/jobs/' + job.job_id + '/result';
      dl.style.display = 'block';
      go.disabled = false;
    } else if (s.status === 'failed') {
      clearInterval(timer);
      setStatus('Failed: ' + (s.error || 'unknown error'), 'err');
      go.disabled = false;
    } else {
      setStatus(`Processing… ${pct}%  ·  ${s.elapsed || 0}s`);
    }
  }, 900);
};
</script>
</body>
</html>
'''


@app.get("/", response_class=HTMLResponse)
def index():
    return DEMO_PAGE


# ----------------------------------------------------------------------------
# entry point
# ----------------------------------------------------------------------------

if __name__ == "__main__":
    _args = sys.argv[1:]
    if _args and _args[0] in ("-h", "--help"):
        main(["--help"])
    elif _args and _args[0] == "--cli":
        main(_args[1:])
    else:
        import uvicorn

        uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
