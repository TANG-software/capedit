/**
 * CapEdit server — serves the static editor and the transcription endpoint.
 *
 * Built for Render (or any Node host): one process, zero dependencies.
 *   GET  /                 the editor
 *   GET  /api/transcribe   health probe ({ok:true|false})
 *   POST /api/transcribe   multipart audio in, word timings out
 *
 * The provider key lives in the environment, never in the browser:
 *   GROQ_API_KEY | OPENAI_API_KEY | DEEPGRAM_API_KEY   (set one)
 *   STT_PROVIDER                                       (optional)
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTranscribe } from './shared/transcribe.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD = 26 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
};

/* Files that exist in the repo but must never be served. */
const BLOCKED = [/^\/(\.git|netlify|functions|shared)(\/|$)/, /^\/(server\.mjs|render\.yaml|package\.json|package-lock\.json)$/];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, body, status = 200) {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(s),
    'cache-control': 'no-store',
  });
  res.end(s);
}

export function createApp() {
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return json(res, { ok: false, error: 'bad request' }, 400);
    }
    const pathname = decodeURIComponent(url.pathname);

    /* ---------------------------------------------------------- API routes */
    if (pathname === '/api/transcribe') {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return handleTranscribe(new Request('http://local/api/transcribe', { method: req.method }), process.env)
          .then((r) => r.text())
          .then((body) => {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(req.method === 'HEAD' ? undefined : body);
          });
      }
      if (req.method !== 'POST') return json(res, { ok: false, error: 'method not allowed' }, 405);
      try {
        const body = await readBody(req);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(', '));
        }
        const request = new Request('http://local/api/transcribe', { method: 'POST', headers, body });
        const out = await handleTranscribe(request, process.env);
        const text = await out.text();
        res.writeHead(out.status, {
          'content-type': out.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(text);
      } catch (e) {
        const msg = e && e.message === 'too large' ? 'audio too large' : 'request failed';
        json(res, { ok: false, error: msg }, e && e.message === 'too large' ? 413 : 400);
      }
      return;
    }

    /* ------------------------------------------------------- static files */
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { ok: false, error: 'method not allowed' }, 405);

    if (BLOCKED.some((re) => re.test(pathname))) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('Forbidden');
    }

    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const ext = path.extname(file).toLowerCase();
      const isAsset = /\.(png|jpg|ico|svg|wasm|onnx)$/.test(ext);
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': isAsset ? 'public, max-age=604800' : 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found. <a href="/">Open CapEdit</a>');
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  createApp().listen(PORT, () => {
    const provider = process.env.STT_PROVIDER || (process.env.GROQ_API_KEY ? 'groq' : process.env.OPENAI_API_KEY ? 'openai' : process.env.DEEPGRAM_API_KEY ? 'deepgram' : 'none');
    console.log(`CapEdit on http://0.0.0.0:${PORT}  ·  transcription provider: ${provider}`);
  });
}
