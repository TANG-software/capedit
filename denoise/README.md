# Noise removal service

`denoise_api.py` is the denoising engine: FastAPI + a job queue, with three
backends — `demucs` (vocal isolation, needs torch), `dfn` (DeepFilterNet3) and
`spectral` (numpy Wiener filter, always available).

The editor talks to it through the main server's `/api/denoise` proxy, so the
service never has to be exposed to browsers directly.

## Run locally

```bash
pip install -r requirements.txt
python denoise_api.py           # http://localhost:8000  (docs at /docs)
```

## Endpoints

    GET    /api/health              backends available
    POST   /api/jobs                multipart file -> {"job_id": ...}
    GET    /api/jobs/{id}           {"status", "progress", "elapsed", "error"}
    GET    /api/jobs/{id}/result    the cleaned file
    DELETE /api/jobs/{id}

## On Render

`render.yaml` already declares this as a second service (`capedit-denoise`) and
wires its URL into the editor service as `DENOISE_URL`.

Free tier (512 MB) runs the **spectral** backend only. Demucs needs ~1.5–2 GB,
so it requires the Standard instance and the torch lines in `requirements.txt`
uncommented. The editor shows whichever backend the service reports.

## Licence

The Demucs backend uses Meta's htdemucs weights (MIT) via torchaudio. If you ship
this commercially, check the licence of every model you enable.
