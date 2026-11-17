/**
 * CapEdit transcription service — one request in, word timings out.
 *
 * Runs on Cloudflare Pages Functions and Netlify Functions from the same code.
 * The browser never sees an API key: it posts the clip's audio here, this file
 * adds the key server-side, and returns normalised words:
 *
 *   { ok: true, words: [ { w: "Namaste", s: 0.42, e: 0.91 }, ... ] }
 *
 * Configure exactly one provider key in the host's environment variables:
 *   GROQ_API_KEY      -> whisper-large-v3-turbo   (fast, has a free tier)
 *   OPENAI_API_KEY    -> whisper-1                (paid, very accurate)
 *   DEEPGRAM_API_KEY  -> nova-2                   (tightest word timings)
 * Optional:
 *   STT_PROVIDER      -> groq | openai | deepgram (force one when several are set)
 */

const PROVIDERS = {
  groq: {
    kind: 'openai',
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    env: 'GROQ_API_KEY',
  },
  openai: {
    kind: 'openai',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
    env: 'OPENAI_API_KEY',
  },
  deepgram: {
    kind: 'deepgram',
    url: 'https://api.deepgram.com/v1/listen',
    model: 'nova-2',
    env: 'DEEPGRAM_API_KEY',
  },
};

const MAX_BYTES = 24 * 1024 * 1024;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign(
      { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      extra
    ),
  });
}

function pickProvider(env) {
  const forced = (env.STT_PROVIDER || '').trim().toLowerCase();
  if (forced && PROVIDERS[forced] && env[PROVIDERS[forced].env]) {
    return { name: forced, ...PROVIDERS[forced], key: env[PROVIDERS[forced].env] };
  }
  for (const name of Object.keys(PROVIDERS)) {
    const p = PROVIDERS[name];
    if (env[p.env]) return { name, ...p, key: env[p.env] };
  }
  return null;
}

/* Best-effort per-instance throttle. For real commercial traffic put the same
   check in Cloudflare's WAF / a KV counter / Upstash — an isolate's memory does
   not survive long and is not shared between edges. */
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const win = 60 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < win);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 60;
}

async function callOpenAICompatible(p, audio, language) {
  const fd = new FormData();
  fd.append('file', audio, 'audio.wav');
  fd.append('model', p.model);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  if (language) fd.append('language', language);
  const r = await fetch(p.url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + p.key },
    body: fd,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error)) || j.message || 'provider error ' + r.status;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  if (Array.isArray(j.words) && j.words.length) {
    return j.words
      .map((w) => ({ w: String(w.word || '').trim(), s: +w.start, e: +w.end }))
      .filter((w) => w.w);
  }
  if (Array.isArray(j.segments) && j.segments.length) {
    const out = [];
    for (const sg of j.segments) {
      const parts = String(sg.text || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) continue;
      const step = (sg.end - sg.start) / parts.length;
      parts.forEach((w, i) => out.push({ w, s: sg.start + i * step, e: sg.start + (i + 1) * step }));
    }
    return out;
  }
  throw new Error('provider returned no timings');
}

async function callDeepgram(p, audio, language) {
  const q = new URLSearchParams({ model: p.model, smart_format: 'true', punctuate: 'true' });
  if (language) q.set('language', language);
  const r = await fetch(p.url + '?' + q.toString(), {
    method: 'POST',
    headers: { authorization: 'Token ' + p.key, 'content-type': 'audio/wav' },
    body: await audio.arrayBuffer(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.err_msg || j.error || 'provider error ' + r.status) + '');
  const alt = (((j.results || {}).channels || [{}])[0].alternatives || [{}])[0];
  return (alt.words || [])
    .map((w) => ({ w: String(w.punctuated_word || w.word || '').trim(), s: +w.start, e: +w.end }))
    .filter((w) => w.w);
}

export async function handleTranscribe(request, env) {
  const method = request.method.toUpperCase();
  const p = pickProvider(env);

  if (method === 'GET' || method === 'HEAD') {
    // the editor pings this to decide whether to use the service or its own engine
    return json({ ok: !!p, service: 'capedit-transcribe', provider: p ? p.name : null });
  }
  if (method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (!p) return json({ ok: false, error: 'transcription is not configured on this deployment' }, 503);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-nf-client-connection-ip') || 'anon';
  if (throttled(ip)) return json({ ok: false, error: 'too many requests — try again later' }, 429);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ ok: false, error: 'expected multipart/form-data' }, 400);
  }
  const audio = form.get('audio');
  if (!audio || typeof audio === 'string') return json({ ok: false, error: 'missing audio field' }, 400);
  if (audio.size > MAX_BYTES) return json({ ok: false, error: 'audio too large (24 MB max)' }, 413);

  const language = String(form.get('language') || '').trim().slice(0, 8) || '';

  try {
    const words = p.kind === 'deepgram' ? await callDeepgram(p, audio, language) : await callOpenAICompatible(p, audio, language);
    if (!words.length) return json({ ok: false, error: 'no speech found' }, 200);
    const last = words[words.length - 1];
    return json({ ok: true, provider: p.name, words, duration: last ? last.e : 0 });
  } catch (e) {
    return json({ ok: false, error: e.message || 'transcription failed' }, 502);
  }
}
