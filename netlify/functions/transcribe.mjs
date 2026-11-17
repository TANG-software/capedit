// Netlify Function -> /.netlify/functions/transcribe  (aliased to /api/transcribe in netlify.toml)
import { handleTranscribe } from '../../shared/transcribe.js';

export default async (event) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers || {})) headers.set(k, v);

  let body;
  if (event.body) {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body);
  }
  const request = new Request(event.rawUrl || 'https://local/api/transcribe', {
    method: event.httpMethod,
    headers,
    body: event.httpMethod === 'GET' || event.httpMethod === 'HEAD' ? undefined : body,
  });

  const res = await handleTranscribe(request, process.env);
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  };
};
