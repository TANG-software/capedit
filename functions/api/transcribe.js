// Cloudflare Pages Function -> https://your-site.pages.dev/api/transcribe
import { handleTranscribe } from '../../shared/transcribe.js';

export const onRequestGet = ({ request, env }) => handleTranscribe(request, env);
export const onRequestPost = ({ request, env }) => handleTranscribe(request, env);
