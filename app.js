/* CapEdit — mobile-first video editor engine (single page, offline, no server) */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ASPECTS = { '9:16': [9, 16], '1:1': [1, 1], '16:9': [16, 9], '4:5': [4, 5], '3:4': [3, 4], '21:9': [21, 9] };

const LOOKS = {
  none: { n: 'Original' },
  warm: { n: 'Warm', b: 1.03, c: 1.05, s: 1.18, h: -6, sep: 0.1 },
  golden: { n: 'Golden hour', b: 1.07, c: 1.02, s: 1.22, h: -10, sep: 0.18 },
  sunset: { n: 'Sunset', b: 1.02, c: 1.08, s: 1.3, h: -14, sep: 0.12 },
  cool: { n: 'Cool', b: 1.03, c: 1.04, s: 1.12, h: 16 },
  teal: { n: 'Teal & orange', c: 1.16, s: 1.2, h: 8 },
  night: { n: 'Night', b: 0.86, c: 1.14, s: 1.05, h: 22 },
  bw: { n: 'B & W', c: 1.12, gray: true },
  noir: { n: 'Noir', c: 1.45, b: 0.9, gray: true },
  mono: { n: 'Mono soft', c: 0.95, b: 1.08, gray: true },
  vivid: { n: 'Vivid', c: 1.12, s: 1.55 },
  punch: { n: 'Punch', c: 1.22, s: 1.35, b: 1.02 },
  fade: { n: 'Fade', b: 1.09, c: 0.88, s: 0.78 },
  matte: { n: 'Matte', b: 1.1, c: 0.82, s: 0.9 },
  vintage: { n: 'Vintage', b: 1.06, c: 0.95, s: 0.95, sep: 0.45 },
  retro: { n: 'Retro', b: 1.04, c: 0.98, s: 1.1, sep: 0.3, h: -6 },
  film: { n: 'Film', c: 1.1, s: 0.92, sep: 0.12 },
  cinematic: { n: 'Cinematic', b: 0.95, c: 1.22, s: 0.88 },
  drama: { n: 'Drama', b: 0.92, c: 1.35, s: 1.05 },
  dream: { n: 'Dream', b: 1.12, s: 1.2, blur: 0.6 },
  soft: { n: 'Soft', b: 1.06, c: 0.94, s: 1.05 },
  crisp: { n: 'Crisp', c: 1.18, s: 1.1, b: 1.02 },
  sepia: { n: 'Sepia', sep: 0.85, c: 1.05 },
  neon: { n: 'Neon', s: 1.8, c: 1.15, h: -20 },
};

const FILTERS = LOOKS; // older projects store a key here; the keys still resolve

const BLENDS = ['source-over', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'color-dodge', 'soft-light', 'difference'];

const TRANSITIONS = {
  none: 'None',
  dissolve: 'Dissolve',
  wipeLeft: 'Wipe →',
  wipeUp: 'Wipe ↑',
  slideUp: 'Slide up',
  zoom: 'Zoom in',
  blur: 'Blur in',
  flash: 'Flash',
};

const TEXT_ANIMS = [
  ['none', 'None'],
  ['fade', 'Fade'],
  ['slideUp', 'Slide up'],
  ['slideDown', 'Slide down'],
  ['slideLeft', 'Slide left'],
  ['slideRight', 'Slide right'],
  ['pop', 'Pop'],
  ['scaleIn', 'Scale in'],
  ['rotateIn', 'Rotate in'],
  ['type', 'Typewriter'],
  ['wordIn', 'Word by word'],
  ['bounce', 'Bounce'],
  ['wave', 'Wave'],
  ['blurIn', 'Blur in'],
  ['glow', 'Glow'],
];

const FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "Courier New", monospace',
  impact: '"Arial Black", Impact, system-ui, sans-serif',
};

/* ------------------------------------------------------------------ state */

const state = {
  name: 'Untitled project',
  aspect: '9:16',
  clips: [],
  tracks: [
    { id: 'V1', kind: 'visual', label: 'Main' },
    { id: 'T1', kind: 'text', label: 'Text' },
    { id: 'A1', kind: 'audio', label: 'Audio' },
  ],
};

const media = {}; // mediaId -> {id, kind, name, url, blob, duration, w, h}
let t = 0;
let playing = false;
let pps = 70; // pixels per second on the timeline
let selectedId = null;
let activeTab = 'media';
let exportMode = false;
let history = [];
let future = [];

const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const stageWrap = $('#stageWrap');

/* ------------------------------------------------------------------ media */

function addMediaFromFile(file) {
  return new Promise((resolve) => {
    const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : file.type.startsWith('image') ? 'image' : null;
    if (!kind) return resolve(null);
    const url = URL.createObjectURL(file);
    const id = uid();
    if (kind === 'image') {
      const im = new Image();
      im.onload = () => {
        media[id] = { id, kind, name: file.name, url, blob: file, duration: 5, w: im.naturalWidth, h: im.naturalHeight };
        resolve(id);
      };
      im.onerror = () => resolve(null);
      im.src = url;
    } else {
      const v = document.createElement(kind === 'audio' ? 'audio' : 'video');
      v.preload = 'metadata';
      v.playsInline = true;
      v.muted = true;
      v.onloadedmetadata = () => {
        const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
        media[id] = { id, kind, name: file.name, url, blob: file, duration: d, w: v.videoWidth || 0, h: v.videoHeight || 0 };
        resolve(id);
      };
      v.onerror = () => resolve(null);
      v.src = url;
    }
  });
}

async function importFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  toast('Importing ' + list.length + ' file(s)…');
  for (const f of list) {
    const id = await addMediaFromFile(f);
    if (id) addClipFromMedia(id);
  }
  pushHistory();
  renderAll();
  toast('Added to timeline');
}

function targetTrackFor(kind) {
  if (kind === 'audio') return 'A1';
  if (kind === 'text') return 'T1';
  return 'V1';
}

function addClipFromMedia(mediaId, trackId) {
  const m = media[mediaId];
  if (!m) return null;
  const track = trackId || targetTrackFor(m.kind);
  const clip = {
    id: uid(),
    trackId: track,
    kind: m.kind,
    mediaId,
    name: m.name,
    start: track === 'V1' || track === 'T1' ? endOfTrack(track) : 0,
    dur: m.kind === 'image' ? 4 : Math.min(m.duration, 600),
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    filter: 'none',
    adj: { b: 1, c: 1, s: 1, h: 0 },
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,
    opacity: 1,
    flipH: false,
    noise: false,
    text: {
      str: m.kind === 'text' ? '' : '',
      size: 64,
      color: '#ffffff',
      font: 'sans',
      bg: 'none',
      stroke: true,
      anim: 'fade',
      align: 'center',
    },
  };
  state.clips.push(clip);
  selectedId = clip.id;
  return clip;
}

function addTextClip(str) {
  const clip = {
    id: uid(),
    trackId: 'T1',
    kind: 'text',
    mediaId: null,
    name: 'Text',
    start: t,
    dur: 3,
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    filter: 'none',
    adj: { b: 1, c: 1, s: 1, h: 0 },
    x: 0,
    y: 0.28,
    scale: 1,
    rotate: 0,
    opacity: 1,
    flipH: false,
    noise: false,
    text: { str: str || 'Your text', size: 64, color: '#ffffff', font: 'sans', bg: 'none', stroke: true, anim: 'fade', align: 'center' },
  };
  state.clips.push(clip);
  selectedId = clip.id;
  pushHistory();
  renderAll();
  setTab('text');
  return clip;
}

const getClip = (id) => state.clips.find((c) => c.id === id);
const clipsOn = (trackId) => state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
const endOfTrack = (trackId) => clipsOn(trackId).reduce((m, c) => Math.max(m, c.start + c.dur), 0);
const projectDuration = () => state.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0) || 10;

/* ------------------------------------------------------------- audio graph */

let ac = null;
let master = null;
let streamDest = null;

function ensureAudioCtx() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = 1;
  master.connect(ac.destination);
  streamDest = ac.createMediaStreamDestination();
  master.connect(streamDest);
  return ac;
}

/* One audio graph per clip element, built once and never rebuilt:
   createMediaElementSource() may only be called a single time per element,
   so "voice clean" is a bypass on filter parameters, not a re-wire. */
function ensureAudio(clip) {
  if (!ac) return null;
  const el = audioSourceEl(clip);
  if (!el || clip.kind === 'image') return null;
  if (clip._nodes && clip._nodes.src) return clip._nodes;
  try {
    const src = ac.createMediaElementSource(el);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 10;
    const cut = ac.createBiquadFilter();
    cut.type = 'peaking';
    cut.frequency.value = 240;
    cut.Q.value = 1.1;
    cut.gain.value = 0;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = 0;
    comp.ratio.value = 1;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(hp);
    hp.connect(cut);
    cut.connect(comp);
    comp.connect(gain);
    gain.connect(master);
    clip._nodes = { src, hp, cut, comp, gain, el };
    el.muted = false;
    if (clip.cleanMediaId && clip._el && clip._el !== el) clip._el.muted = true;
    applyNoise(clip);
  } catch (e) {
    clip._nodes = { src: null, gain: null };
  }
  return clip._nodes;
}

/* Voice clean: high-pass (kills rumble/hum) + presence cut (nasal hiss) +
   gentle compressor. Off = every stage is a true pass-through. */
function applyNoise(clip) {
  const n = clip._nodes;
  if (!n || !n.hp) return;
  const on = !!clip.noise;
  n.hp.frequency.value = on ? 95 : 10;
  n.cut.gain.value = on ? -4 : 0;
  n.comp.threshold.value = on ? -30 : 0;
  n.comp.ratio.value = on ? 3.2 : 1;
}

/* ------------------------------------------------------------- media elems */

const hidden = $('#mediaHost');

function elFor(clip) {
  if (clip.kind === 'text') return null;
  const m = media[clip.mediaId];
  if (!m) return null;
  if (!clip._el) {
    if (m.kind === 'image') {
      const im = new Image();
      im.src = m.url;
      clip._el = im;
    } else {
      const v = document.createElement(m.kind === 'audio' ? 'audio' : 'video');
      v.src = m.url;
      v.preload = 'auto';
      v.playsInline = true;
      v.muted = true;
      v.loop = false;
      hidden.appendChild(v);
      clip._el = v;
      if (ac) ensureAudio(clip);
    }
  }
  return clip._el;
}

/* A denoised copy of a clip's audio lives in its own media entry; it plays in
   step with the picture while the video element itself is muted. */
function cleanElFor(clip) {
  if (!clip.cleanMediaId) return null;
  const m = media[clip.cleanMediaId];
  if (!m) return null;
  if (!clip._cleanEl) {
    const a = document.createElement('audio');
    a.src = m.url;
    a.preload = 'auto';
    a.playsInline = true;
    a.muted = true;
    hidden.appendChild(a);
    clip._cleanEl = a;
  }
  return clip._cleanEl;
}

function audioSourceEl(clip) {
  if (clip.kind === 'image' || clip.kind === 'text') return null;
  return cleanElFor(clip) || elFor(clip);
}

/* ------------------------------------------------------------------ canvas */

function outSize() {
  const [aw, ah] = ASPECTS[state.aspect] || ASPECTS['9:16'];
  const short = exportMode ? 1080 : 540;
  const r = aw / ah;
  let W, H;
  if (r <= 1) {
    W = Math.round(short * r);
    H = short;
  } else {
    H = Math.round(short / r);
    W = short;
  }
  return { W, H };
}

function resizeCanvas() {
  const { W, H } = outSize();
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  layoutStage();
}

let stageObserver = null;

function watchStage() {
  if (stageObserver || typeof ResizeObserver === 'undefined') return;
  stageObserver = new ResizeObserver(() => layoutStage());
  stageObserver.observe(stageWrap);
}

function layoutStage() {
  const box = stageWrap.getBoundingClientRect();
  const pad = 16;
  const aw = canvas.width,
    ah = canvas.height;
  const s = Math.min((box.width - pad) / aw, (box.height - pad) / ah);
  canvas.style.width = Math.max(60, Math.floor(aw * s)) + 'px';
  canvas.style.height = Math.max(60, Math.floor(ah * s)) + 'px';
}

function lookStr(clip) {
  const L = LOOKS[clip.filter] || LOOKS.none;
  const k = clip.lookIntensity == null ? 1 : clip.lookIntensity;
  if (!L || L === LOOKS.none || k <= 0) return '';
  const m = (v) => 1 + ((v == null ? 1 : v) - 1) * k;
  const out = [`brightness(${m(L.b).toFixed(3)})`, `contrast(${m(L.c).toFixed(3)})`, `saturate(${m(L.s).toFixed(3)})`];
  if (L.gray) out.push(`grayscale(${k.toFixed(2)})`);
  if (L.h) out.push(`hue-rotate(${(L.h * k).toFixed(1)}deg)`);
  if (L.sep) out.push(`sepia(${(L.sep * k).toFixed(2)})`);
  if (L.blur) out.push(`blur(${(L.blur * k).toFixed(2)}px)`);
  return out.join(' ');
}

function filterStr(clip) {
  const a = clip.adj || { b: 1, c: 1, s: 1, h: 0 };
  return `brightness(${a.b}) contrast(${a.c}) saturate(${a.s}) hue-rotate(${a.h}deg) ${lookStr(clip)}`.trim();
}

/* entry transition: works when the clip overlaps the one before it */
function transitionState(clip, time, W, H) {
  const st = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, clipRect: null };
  const tr = clip.transIn;
  if (!tr || !tr.type || tr.type === 'none') return st;
  const d = Math.max(0.08, tr.dur || 0.6);
  const q = clamp((time - clip.start) / d, 0, 1);
  if (q >= 1) return st;
  const e = q * q * (3 - 2 * q);
  if (tr.type === 'dissolve' || tr.type === 'flash') st.alpha = e;
  else if (tr.type === 'slideUp') {
    st.dy = (1 - e) * H;
    st.alpha = Math.min(1, e * 1.6);
  } else if (tr.type === 'zoom') {
    st.scale = 1.25 - 0.25 * e;
    st.alpha = e;
  } else if (tr.type === 'blur') {
    st.blur = (1 - e) * 18;
    st.alpha = e;
  } else if (tr.type === 'wipeLeft') {
    st.clipRect = [0, 0, W * e, H];
  } else if (tr.type === 'wipeUp') {
    st.clipRect = [0, H - H * e, W, H * e];
  }
  return st;
}

function clipProgress(clip, time) {
  return clip.dur > 0 ? clamp((time - clip.start) / clip.dur, 0, 1) : 0;
}

function fadeAlpha(clip, time) {
  const p = clipProgress(clip, time);
  let a = 1;
  if (clip.fadeIn > 0) a = Math.min(a, (time - clip.start) / clip.fadeIn);
  if (clip.fadeOut > 0) a = Math.min(a, (clip.start + clip.dur - time) / clip.fadeOut);
  return clamp(a, 0, 1);
}

function drawVisual(clip, time) {
  const el = elFor(clip);
  if (!el) return;
  const W = canvas.width,
    H = canvas.height;
  const sw = clip.kind === 'image' ? el.naturalWidth || 1080 : el.videoWidth || 1080;
  const sh = clip.kind === 'image' ? el.naturalHeight || 1920 : el.videoHeight || 1920;
  if (!sw || !sh) return;

  const tr = transitionState(clip, time, W, H);
  const cover = Math.max(W / sw, H / sh) * clip.scale * tr.scale;

  ctx.save();
  if (tr.clipRect) {
    ctx.beginPath();
    ctx.rect(tr.clipRect[0], tr.clipRect[1], tr.clipRect[2], tr.clipRect[3]);
    ctx.clip();
  }
  ctx.globalAlpha = clip.opacity * fadeAlpha(clip, time) * tr.alpha;
  ctx.globalCompositeOperation = clip.blend && clip.blend !== 'source-over' ? clip.blend : 'source-over';
  ctx.filter = tr.blur ? `blur(${tr.blur.toFixed(1)}px) ${filterStr(clip)}` : filterStr(clip);
  ctx.translate(W / 2 + clip.x * W + tr.dx, H / 2 + clip.y * H + tr.dy);
  if (clip.rotate) ctx.rotate((clip.rotate * Math.PI) / 180);
  if (clip.flipH) ctx.scale(-1, 1);
  try {
    ctx.drawImage(el, (-sw * cover) / 2, (-sh * cover) / 2, sw * cover, sh * cover);
  } catch (e) {
    /* element not ready */
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
}

function wrapLines(text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = test;
    }
    out.push(cur);
  }
  return out;
}

function drawText(clip, time) {
  const W = canvas.width,
    H = canvas.height;
  const scale = W / 1080;
  const txt = clip.text || {};
  const str = txt.str || '';
  if (!str.trim()) return;
  const size = (txt.size || 64) * scale;
  const p = clipProgress(clip, time);
  let alpha = clip.opacity * fadeAlpha(clip, time);
  let dy = 0;
  let sc = 1;
  const anim = txt.anim || 'none';
  const e = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  let dx = 0;
  let rot = 0;
  let blur = 0;
  let glow = 0;
  let str2 = str;
  if (anim === 'fade') alpha *= Math.min(1, p / 0.18, (1 - p) / 0.18);
  else if (anim === 'slideUp') {
    const k = e(p / 0.25);
    dy = (1 - k) * 40 * scale;
    alpha *= k;
  } else if (anim === 'slideDown') {
    const k = e(p / 0.25);
    dy = -(1 - k) * 40 * scale;
    alpha *= k;
  } else if (anim === 'slideLeft') {
    const k = e(p / 0.25);
    dx = (1 - k) * 60 * scale;
    alpha *= k;
  } else if (anim === 'slideRight') {
    const k = e(p / 0.25);
    dx = -(1 - k) * 60 * scale;
    alpha *= k;
  } else if (anim === 'pop') {
    const k = e(p / 0.2);
    sc = 0.7 + 0.3 * k;
    alpha *= k;
  } else if (anim === 'scaleIn') {
    const k = e(p / 0.3);
    sc = 0.2 + 0.8 * k;
    alpha *= k;
  } else if (anim === 'rotateIn') {
    const k = e(p / 0.3);
    rot = (1 - k) * -18;
    sc = 0.8 + 0.2 * k;
    alpha *= k;
  } else if (anim === 'type') {
    const n = Math.floor(str.length * clamp(p / 0.5, 0, 1));
    if (n <= 0) return;
    str2 = str.slice(0, n);
  } else if (anim === 'wordIn') {
    const words = str.split(' ');
    const n = Math.max(1, Math.ceil(words.length * clamp(p / 0.45, 0, 1)));
    str2 = words.slice(0, n).join(' ');
  } else if (anim === 'bounce') {
    const k = clamp(p / 0.5, 0, 1);
    dy = -Math.abs(Math.sin(k * Math.PI * 2.2)) * (1 - k) * 34 * scale;
    alpha *= Math.min(1, k * 2.2);
  } else if (anim === 'wave') {
    dy = Math.sin(time * 5.5) * 7 * scale;
    sc = 1 + Math.sin(time * 5.5) * 0.015;
  } else if (anim === 'blurIn') {
    const k = e(p / 0.35);
    blur = (1 - k) * 14 * scale;
    alpha *= k;
  } else if (anim === 'glow') {
    glow = (0.6 + 0.4 * Math.sin(time * 3.2)) * size * 0.45;
  }
  drawTextString(clip, str2, size, alpha, dy, sc, W, H, dx, rot, blur, glow);
}

function drawTextString(clip, str, size, alpha, dy, sc, W, H, dx, rot, blur, glow) {
  const txt = clip.text;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  if (blur) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.font = `700 ${size}px ${FONTS[txt.font] || FONTS.sans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = W * 0.86;
  const lines = wrapLines(str, maxW);
  const lh = size * 1.22;
  const totalH = lh * lines.length;
  const cx = W / 2 + clip.x * W + (dx || 0);
  const cy = H / 2 + clip.y * H + dy;
  ctx.translate(cx, cy);
  if (clip.rotate || rot) ctx.rotate(((clip.rotate + (rot || 0)) * Math.PI) / 180);
  ctx.scale(sc, sc);
  if (glow) {
    ctx.shadowColor = txt.color || '#fff';
    ctx.shadowBlur = glow;
  }
  if (txt.bg && txt.bg !== 'none') {
    const padX = size * 0.35,
      padY = size * 0.22;
    let widest = 0;
    lines.forEach((l) => (widest = Math.max(widest, ctx.measureText(l).width)));
    ctx.fillStyle = txt.bg;
    roundRect(-widest / 2 - padX, -totalH / 2 - padY, widest + padX * 2, totalH + padY * 2, size * 0.18);
    ctx.fill();
  }
  lines.forEach((line, i) => {
    const y = -totalH / 2 + lh / 2 + i * lh;
    if (txt.stroke) {
      ctx.lineWidth = Math.max(2, size * 0.09);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = txt.color || '#fff';
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
  ctx.filter = 'none';
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderFrame(time) {
  const W = canvas.width,
    H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const order = state.tracks.map((tr) => tr.id);
  const active = state.clips
    .filter((c) => time >= c.start - 1e-6 && time < c.start + c.dur)
    .sort((a, b) => order.indexOf(a.trackId) - order.indexOf(b.trackId) || a.start - b.start);
  for (const c of active) {
    if (c.kind === 'text') {
      if (c.caption && c.words && c.words.length) drawCaptionClip(c, time);
      else drawText(c, time);
    }
    else if (c.kind === 'video' || c.kind === 'image') drawVisual(c, time);
  }
  if (!active.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = `600 ${Math.round(W * 0.038)}px ${FONTS.sans}`;
    ctx.textAlign = 'center';
    ctx.fillText('Add media to start editing', W / 2, H / 2);
  }
}

/* -------------------------------------------------------------- transport */

function driveElement(c, el, time, isPlaying, inRange, target) {
  if (!el || typeof el.pause !== 'function') return;
  if (isPlaying && inRange) {
    if (el.paused) {
      el.playbackRate = clamp(c.speed, 0.25, 4);
      el.play().catch(() => {});
    }
    if (Math.abs(el.currentTime - target) > 0.22) {
      try {
        el.currentTime = target;
      } catch (e) {}
    }
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - target) > 0.05) {
      try {
        el.currentTime = target;
      } catch (e) {}
    }
  }
}

function syncElements(time, isPlaying) {
  for (const c of state.clips) {
    if (c.kind === 'text' || c.kind === 'image') continue;
    const vel = elFor(c);
    const ael = audioSourceEl(c);
    if (!vel && !ael) continue;
    const inRange = time >= c.start - 1e-6 && time < c.start + c.dur;
    const local = clamp((time - c.start) * c.speed, 0, Math.max(0, c.dur * c.speed - 0.001));
    const target = c.inPoint + local;
    driveElement(c, vel, time, isPlaying, inRange, target);
    if (ael && ael !== vel) driveElement(c, ael, time, isPlaying, inRange, target);
    // the element feeding the Web Audio graph must not be muted; the picture
    // element must be, once a cleaned track is carrying the sound
    if (vel && ael && vel !== ael) vel.muted = true;
    if (ael) ael.muted = !ac;
    const nodes = c._nodes;
    if (nodes && nodes.gain) {
      const f = fadeAlpha(c, time);
      const v = inRange ? c.volume * f : 0;
      try {
        nodes.gain.gain.setTargetAtTime(v, ac.currentTime, 0.02);
      } catch (e) {}
    }
  }
}

let lastTs = 0;
let rafId = null;
let onEndCallback = null;

function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  if (playing) {
    t += dt;
    if (t >= projectDuration()) {
      t = projectDuration();
      pause();
      if (onEndCallback) {
        const cb = onEndCallback;
        onEndCallback = null;
        cb();
      }
    }
  }
  syncElements(t, playing);
  renderFrame(t);
  updatePlayhead();
  updateTimeLabel();
  rafId = requestAnimationFrame(loop);
}

function play() {
  if (playing) return;
  if (t >= projectDuration() - 0.02) t = 0;
  ensureAudioCtx();
  if (ac && ac.state === 'suspended') ac.resume();
  for (const c of state.clips) if (c.kind === 'video' || c.kind === 'audio') ensureAudio(c);
  playing = true;
  lastTs = 0;
  $('#btnPlay').textContent = '❚❚';
}

function pause() {
  playing = false;
  $('#btnPlay').textContent = '▶';
  syncElements(t, false);
}

function togglePlay() {
  playing ? pause() : play();
}

function seek(time) {
  t = clamp(time, 0, projectDuration());
  if (!playing) syncElements(t, false);
  renderFrame(t);
  updatePlayhead();
  updateTimeLabel();
}

/* -------------------------------------------------------------------- UI */

function fmt(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* Snapshots never carry runtime handles (video elements, audio nodes) — those
   are rebuilt on demand by elFor()/ensureAudio(). */
function snapshot() {
  return JSON.stringify(
    { aspect: state.aspect, clips: state.clips, tracks: state.tracks, name: state.name },
    (k, v) => (k === '_el' || k === '_nodes' ? undefined : v)
  );
}

let curSnap = null;

/* call AFTER a mutation: stores the state as it was before that mutation */
function pushHistory() {
  const s = snapshot();
  if (curSnap === null) curSnap = s;
  history.push(curSnap);
  if (history.length > 60) history.shift();
  curSnap = s;
  future = [];
  updateUndoBtns();
}

function updateUndoBtns() {
  $('#btnUndo').disabled = !history.length;
  $('#btnRedo').disabled = !future.length;
}

function applySnapshot(json) {
  const s = JSON.parse(json);
  state.aspect = s.aspect;
  state.name = s.name;
  state.tracks = s.tracks;
  state.clips = s.clips.map((c) => {
    delete c._el;
    delete c._nodes;
    return c;
  });
  selectedId = null;
  resizeCanvas();
  renderAll();
}

function undo() {
  if (!history.length) return;
  future.push(curSnap);
  curSnap = history.pop();
  applySnapshot(curSnap);
  updateUndoBtns();
}

function redo() {
  if (!future.length) return;
  history.push(curSnap);
  curSnap = future.pop();
  applySnapshot(curSnap);
  updateUndoBtns();
}

function renderAll() {
  renderTimeline();
  renderPanel();
  layoutStage();
  renderFrame(t);
  updateTimeLabel();
}

function updateTimeLabel() {
  $('#timeNow').textContent = fmt(t);
  $('#timeTotal').textContent = fmt(projectDuration());
}

function updatePlayhead() {
  const ph = $('#playhead');
  if (ph) ph.style.left = t * pps + 'px';
  const sc = $('#tlScroll');
  if (sc && playing) {
    const x = t * pps;
    if (x > sc.scrollLeft + sc.clientWidth - 60) sc.scrollLeft = x - sc.clientWidth + 120;
  }
}

/* --------------------------------------------------------------- timeline */

function trackLabel(tr) {
  return tr.kind === 'visual' ? 'VIDEO' : tr.kind === 'text' ? 'TEXT' : 'AUDIO';
}

function renderTimeline() {
  const dur = Math.max(projectDuration() + 4, 12);
  const wrap = $('#tlTracks');
  wrap.innerHTML = '';
  $('#tlRuler').style.width = dur * pps + 'px';
  wrap.style.width = dur * pps + 'px';

  // ruler ticks
  const ruler = $('#tlRuler');
  ruler.innerHTML = '';
  const step = pps > 90 ? 1 : pps > 45 ? 2 : 5;
  for (let s = 0; s <= dur; s += step) {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = s * pps + 'px';
    tick.innerHTML = `<span>${fmt(s).slice(0, 5)}</span>`;
    ruler.appendChild(tick);
  }

  for (const tr of state.tracks) {
    const row = document.createElement('div');
    row.className = 'tlRow';
    row.dataset.track = tr.id;
    const lbl = document.createElement('div');
    lbl.className = 'tlLabel';
    lbl.textContent = trackLabel(tr);
    lbl.dataset.track = tr.id;
    row.appendChild(lbl);
    const lane = document.createElement('div');
    lane.className = 'tlLane';
    lane.dataset.track = tr.id;
    lane.style.width = dur * pps + 'px';

    for (const c of clipsOn(tr.id)) {
      const el = document.createElement('div');
      el.className = 'clip' + (c.id === selectedId ? ' sel' : '') + ' k-' + c.kind;
      el.style.left = c.start * pps + 'px';
      el.style.width = Math.max(18, c.dur * pps) + 'px';
      el.dataset.id = c.id;
      const label = c.kind === 'text' ? (c.text && c.text.str) || 'Text' : c.name || c.kind;
      el.innerHTML =
        `<div class="clipIn">` +
        (c.kind === 'text' ? `<span class="ci">T</span>` : `<span class="ci">${c.kind === 'video' ? '▶' : c.kind === 'audio' ? '♪' : '▣'}</span>`) +
        `<span class="cname">${escapeHtml(String(label).slice(0, 26))}</span>` +
        `<span class="cdur">${c.dur.toFixed(1)}s</span>` +
        `</div><div class="h l"></div><div class="h r"></div>`;
      el.addEventListener('pointerdown', (ev) => onClipPointerDown(ev, c));
      lane.appendChild(el);
    }
    row.appendChild(lane);
    wrap.appendChild(row);
  }
  updatePlayhead();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function snapTime(val, ignoreId) {
  const edges = [0];
  for (const c of state.clips) {
    if (c.id === ignoreId) continue;
    edges.push(c.start, c.start + c.dur);
  }
  const tol = 8 / pps;
  let best = val,
    bd = tol;
  for (const e of edges) {
    const d = Math.abs(e - val);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return Math.round(best * 1000) / 1000;
}

function onClipPointerDown(ev, clip) {
  ev.preventDefault();
  ev.stopPropagation();
  selectClip(clip.id);
  const target = ev.target;
  const mode = target.classList.contains('h') ? (target.classList.contains('l') ? 'trimL' : 'trimR') : 'move';
  const startX = ev.clientX;
  const orig = { start: clip.start, dur: clip.dur, inPoint: clip.inPoint, trackId: clip.trackId };
  const el = ev.currentTarget;
  let moved = false;

  // NB: listeners live on window and the clip element is never re-created during
  // the drag — re-rendering the timeline here would drop pointer capture.
  const paint = () => {
    el.style.left = clip.start * pps + 'px';
    el.style.width = Math.max(18, clip.dur * pps) + 'px';
    const dEl = el.querySelector('.cdur');
    if (dEl) dEl.textContent = clip.dur.toFixed(1) + 's';
  };

  const onMove = (e) => {
    const dx = (e.clientX - startX) / pps;
    if (Math.abs(e.clientX - startX) > 3) moved = true;
    if (!moved) return;
    if (mode === 'move') {
      let ns = Math.max(0, orig.start + dx);
      ns = snapTime(ns, clip.id);
      clip.start = clamp(ns, 0, Math.max(0, projectDuration() + 30 - clip.dur));
      const rowEl = document.elementFromPoint(e.clientX, e.clientY);
      const lane = rowEl && rowEl.closest ? rowEl.closest('.tlLane') : null;
      if (lane) {
        const tr = state.tracks.find((x) => x.id === lane.dataset.track);
        const sameKind = tr && ((tr.kind === 'visual' && (clip.kind === 'video' || clip.kind === 'image')) || (tr.kind === 'audio' && clip.kind === 'audio') || (tr.kind === 'text' && clip.kind === 'text'));
        if (sameKind && tr.id !== clip.trackId) {
          clip.trackId = tr.id;
          lane.appendChild(el);
        }
      }
    } else if (mode === 'trimL') {
      const maxDelta = orig.dur - 0.2;
      let d = clamp(dx, -orig.inPoint, maxDelta);
      if (clip.kind === 'image' || clip.kind === 'text') d = clamp(dx, -orig.start, maxDelta);
      clip.start = Math.max(0, orig.start + d);
      clip.dur = Math.max(0.2, orig.dur - d);
      if (clip.kind !== 'image' && clip.kind !== 'text') clip.inPoint = Math.max(0, orig.inPoint + d * clip.speed);
    } else {
      const maxDur =
        clip.kind === 'image' || clip.kind === 'text'
          ? 60
          : Math.max(0.2, (media[clip.mediaId] ? media[clip.mediaId].duration - orig.inPoint : 60) / clip.speed);
      clip.dur = clamp(orig.dur + dx, 0.2, maxDur);
    }
    paint();
    renderFrame(t);
    updateTimeLabel();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (moved) {
      pushHistory();
      renderAll();
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function selectClip(id) {
  selectedId = id;
  $$('.clip').forEach((n) => n.classList.toggle('sel', n.dataset.id === id));
  renderPanel();
}

function deleteSelected() {
  if (!selectedId) return;
  state.clips = state.clips.filter((c) => c.id !== selectedId);
  selectedId = null;
  pushHistory();
  renderAll();
}

function duplicateSelected() {
  const c = getClip(selectedId);
  if (!c) return;
  const copy = JSON.parse(JSON.stringify({ ...c, _el: undefined, _nodes: undefined }));
  copy.id = uid();
  copy.start = c.start + c.dur;
  delete copy._el;
  delete copy._nodes;
  state.clips.push(copy);
  selectedId = copy.id;
  pushHistory();
  renderAll();
}

function splitAtPlayhead() {
  const c = getClip(selectedId) || state.clips.find((x) => t > x.start && t < x.start + x.dur);
  if (!c) return toast('Select a clip to split');
  if (!(t > c.start + 0.05 && t < c.start + c.dur - 0.05)) return toast('Move the playhead inside the clip');
  const right = JSON.parse(JSON.stringify({ ...c, _el: undefined, _nodes: undefined }));
  delete right._el;
  delete right._nodes;
  right.id = uid();
  const cut = t - c.start;
  right.start = t;
  right.dur = c.dur - cut;
  if (c.kind !== 'image' && c.kind !== 'text') right.inPoint = c.inPoint + cut * c.speed;
  c.dur = cut;
  state.clips.push(right);
  selectedId = right.id;
  pushHistory();
  renderAll();
}

/* ------------------------------------------------------------------ panel */

const TABS = ['media', 'text', 'captions', 'filters', 'adjust', 'speed', 'audio'];

const LEFT_TABS = ['media', 'templates', 'captions'];
let leftTab = 'media';
let rightTab = 'text';

function isMobileLayout() {
  return window.matchMedia('(max-width: 980px)').matches;
}

function hostPanel() {
  const body = $('#panelBody');
  const host = $('#sheetHost');
  if (host && body.parentElement !== host) host.appendChild(body);
}

function setTab(id) {
  if (LEFT_TABS.indexOf(id) >= 0) leftTab = id;
  else rightTab = id;
  activeTab = id;
  $$('.tab').forEach((b) => {
    const isLeft = LEFT_TABS.indexOf(b.dataset.tab) >= 0;
    b.classList.toggle('on', b.dataset.tab === (isLeft ? leftTab : rightTab));
  });
  renderPanel();
}

function panelHTML(tab, c) {
  if (tab === 'media') return mediaPanel();
  if (tab === 'templates') return templatesPanel();
  if (tab === 'captions') return captionsPanel();
  if (tab === 'text') return textPanel(c);
  if (tab === 'filters') return filtersPanel(c);
  if (tab === 'adjust') return adjustPanel(c);
  if (tab === 'speed') return speedPanel(c);
  if (tab === 'audio') return audioPanel(c);
  return '';
}

function renderPanel() {
  const c = getClip(selectedId);
  if (isMobileLayout()) {
    const body = $('#panelBody');
    hostPanel();
    body.innerHTML = panelHTML(activeTab, c);
    attachRanges(body);
    body.scrollTop = 0;
    layoutStage();
    return;
  }
  const L = $('#leftBody');
  const R = $('#rightBody');
  if (L) {
    L.innerHTML = panelHTML(leftTab, c);
    attachRanges(L);
  }
  if (R) {
    R.innerHTML = panelHTML(rightTab, c);
    attachRanges(R);
  }
  layoutStage();
}

/* every slider in the panel: live value label + cap:change event + history on release */
function attachRanges(root) {
  $$('input[type=range]', root).forEach((inp) => {
    inp.addEventListener('input', () => {
      const b = inp.parentElement.querySelector('b');
      if (b) {
        const step = parseFloat(inp.step) || 1;
        b.textContent = (+inp.value).toFixed(step < 1 ? 2 : 0) + (inp.dataset.suffix || '');
      }
      inp.dispatchEvent(new CustomEvent('cap:change', { detail: +inp.value }));
    });
    inp.addEventListener('change', () => pushHistory());
  });
  $$('input[type=color]', root).forEach((inp) => inp.addEventListener('change', () => pushHistory()));
}

function onRange(inp, fn) {
  if (!inp) return;
  inp.addEventListener('cap:change', (e) => {
    fn(e.detail);
    renderFrame(t);
    updateTimeLabel();
  });
}

function noSel(msg) {
  return `<div class="empty">${msg}</div>`;
}

function mediaPanel() {
  const items = Object.values(media)
    .map(
      (m) => `<button class="mi" data-mid="${m.id}">
      <span class="mik">${m.kind === 'video' ? '▶' : m.kind === 'audio' ? '♪' : '▣'}</span>
      <span class="min">${escapeHtml(m.name.slice(0, 18))}</span>
      <span class="mid">${m.kind === 'image' ? 'image' : m.duration.toFixed(1) + 's'}</span>
    </button>`
    )
    .join('');
  setTimeout(() => {
    if (!$('#btnImport')) return;
    const ls = $('#libSave');
    if (ls) ls.addEventListener('click', () => saveToLibrary());
    LIB.all()
      .then((recs) => {
        const box = $('#libList');
        if (box) box.innerHTML = libraryListHTML(recs);
        $$('[data-open]').forEach((b) => b.addEventListener('click', () => loadFromLibrary(b.dataset.open)));
        $$('[data-del]').forEach((b) =>
          b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            deleteFromLibrary(b.dataset.del);
          })
        );
      })
      .catch(() => {});
    $$('.mi').forEach((b) =>
      b.addEventListener('click', () => {
        addClipFromMedia(b.dataset.mid);
        pushHistory();
        renderAll();
      })
    );
  });
  return `
    <div class="btnrow">
      <button class="btn primary" id="btnImport">+ Import media</button>
      <button class="btn" id="btnVoice">Voiceover</button>
    </div>
    ${items ? `<div class="grid">${items}</div>` : '<div class="empty">No media yet.<br>Import video, photos or music.</div>'}
    <div class="btnrow"><button class="btn" id="libSave">Save project on this device</button></div>
    <div id="libList"></div>`;
}

function textPanel(c) {
  if (!c || c.kind !== 'text') {
    return `<div class="btnrow"><button class="btn primary" id="btnAddText">+ Add text at playhead</button></div>
      <div class="empty">Select a text clip to style it. Tap "Add text" to create one.</div>`;
  }
  const txt = c.text;
  setTimeout(() => {
    const ta = $('#txtStr');
    if (!ta) return;
    ta.addEventListener('input', () => {
      txt.str = ta.value;
      renderTimeline();
      renderFrame(t);
    });
    ta.addEventListener('change', () => pushHistory());
    $$('[data-tf]').forEach((b) =>
      b.addEventListener('click', () => {
        txt.font = b.dataset.tf;
        renderPanel();
        renderFrame(t);
        pushHistory();
      })
    );
    $$('[data-anim]').forEach((b) =>
      b.addEventListener('click', () => {
        txt.anim = b.dataset.anim;
        renderPanel();
        pushHistory();
      })
    );
    $$('[data-tpreset]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = TITLE_PRESETS[+b.dataset.tpreset];
        if (!p) return;
        Object.assign(txt, p.t);
        c.y = p.y;
        renderPanel();
        renderFrame(t);
        pushHistory();
      })
    );
    $$('[data-bg]').forEach((b) =>
      b.addEventListener('click', () => {
        txt.bg = b.dataset.bg;
        renderPanel();
        pushHistory();
      })
    );
    $$('[data-pos]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.dataset.pos;
        c.x = v === 'l' ? -0.28 : v === 'r' ? 0.28 : 0;
        c.y = v === 'top' ? -0.3 : v === 'bot' ? 0.3 : 0;
        renderPanel();
        renderFrame(t);
        pushHistory();
      })
    );
    const col = $('#txtColor');
    col.addEventListener('input', () => {
      txt.color = col.value;
      renderFrame(t);
    });
    col.addEventListener('change', () => pushHistory());
    const s = $('#txtSize');
    onRange(s, (v) => (txt.size = v));
    const rot = $('#txtRot');
    onRange(rot, (v) => (c.rotate = v));
    const op = $('#txtOpacity');
    onRange(op, (v) => (c.opacity = v));
  });
  return `
  <textarea id="txtStr" rows="2" placeholder="Type your text">${escapeHtml(txt.str || '')}</textarea>
  <div class="row2">
    <div class="chips">${Object.keys(FONTS).map((f) => `<button class="chip ${txt.font === f ? 'on' : ''}" data-tf="${f}">${f}</button>`).join('')}</div>
    <input type="color" id="txtColor" value="${txt.color}" title="Text colour">
  </div>
  <label class="row"><span>Size</span><input id="txtSize" type="range" min="24" max="180" step="1" value="${txt.size}" data-bind="size"><b>${txt.size}</b></label>
  <label class="row"><span>Rotate</span><input id="txtRot" type="range" min="-45" max="45" step="1" value="${c.rotate}" data-bind="rot"><b>${c.rotate}</b></label>
  <label class="row"><span>Opacity</span><input id="txtOpacity" type="range" min="0.1" max="1" step="0.05" value="${c.opacity}" data-bind="op"><b>${c.opacity}</b></label>
  <div class="lbl">Background</div>
  <div class="chips">${[
    ['none', 'None'],
    ['rgba(0,0,0,0.6)', 'Black'],
    ['rgba(255,255,255,0.85)', 'White'],
    ['#2ee6a8', 'Mint'],
    ['#ff3b6b', 'Pink'],
  ]
    .map(([v, n]) => `<button class="chip ${txt.bg === v ? 'on' : ''}" data-bg="${v}">${n}</button>`)
    .join('')}</div>
  <div class="lbl">Position</div>
  <div class="chips">${[
    ['top', 'Top'],
    ['mid', 'Center'],
    ['bot', 'Bottom'],
    ['l', 'Left'],
    ['r', 'Right'],
  ]
    .map(([v, n]) => `<button class="chip" data-pos="${v}">${n}</button>`)
    .join('')}</div>
  <div class="lbl">Title presets</div>
  <div class="chips">${TITLE_PRESETS.map((p, i) => `<button class="chip" data-tpreset="${i}">${p.n}</button>`).join('')}</div>
  <div class="lbl">Animation</div>
  <div class="chips wide">${TEXT_ANIMS.map(([v, n]) => `<button class="chip ${txt.anim === v ? 'on' : ''}" data-anim="${v}">${n}</button>`).join('')}</div>`;
}

function captionsPanel() {
  const caps = state.clips.filter((c) => c.caption).sort((x, y) => x.start - y.start);
  const anyCap = caps[0];
  const LANGS = [
    ['auto', 'Auto-detect'],
    ['en', 'English'],
    ['hi', 'Hindi'],
    ['bn', 'Bengali'],
    ['ta', 'Tamil'],
    ['te', 'Telugu'],
    ['mr', 'Marathi'],
    ['gu', 'Gujarati'],
    ['kn', 'Kannada'],
    ['ml', 'Malayalam'],
    ['pa', 'Punjabi'],
  ];
  setTimeout(() => {
    const autoBtn = $('#capAuto');
    if (!autoBtn) return;
    autoBtn.addEventListener('click', () => autoCaption(CAPLANG));
    const ls = $('#capLang');
    if (ls)
      ls.addEventListener('change', () => {
        CAPLANG = ls.value;
      });
    $$('.txta').forEach((ta) =>
      ta.addEventListener('input', () => {
        const c = getClip(ta.dataset.id);
        if (!c) return;
        retimeCaptionLine(c, ta.value);
        renderFrame(t);
      })
    );
    $$('.txta').forEach((ta) =>
      ta.addEventListener('change', () => {
        pushHistory();
        renderTimeline();
      })
    );
    $$('.txtime').forEach((b) =>
      b.addEventListener('click', () => {
        const c = getClip(b.dataset.id);
        if (c) seek(c.start + 0.02);
      })
    );
    $$('.txrow').forEach((row) =>
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('txta')) return;
        const c = getClip(row.dataset.id);
        if (c) {
          selectClip(c.id);
          seek(c.start + 0.02);
        }
      })
    );
    $$('[data-cpreset]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = CAPTION_PRESETS[+b.dataset.cpreset];
        if (!p) return;
        state.clips.filter((c) => c.caption).forEach((c) => Object.assign(c.text, p.t));
        renderPanel();
        renderFrame(t);
        pushHistory();
      })
    );
    const sz = $('#capSize');
    if (sz)
      onRange(sz, (v) => {
        state.clips.filter((c) => c.caption).forEach((c) => (c.text.size = v));
      });
    const hb = $('#capHl');
    if (hb)
      hb.addEventListener('input', () => {
        state.clips.filter((c) => c.caption).forEach((c) => (c.text.hlBg = hb.value));
        renderFrame(t);
      });
    const bg = $('#capBg');
    if (bg)
      bg.addEventListener('change', () => {
        state.clips.filter((c) => c.caption).forEach((c) => (c.text.bg = bg.value));
        renderFrame(t);
        pushHistory();
      });
    const ex = $('#capExport');
    if (ex) ex.addEventListener('click', exportSRT);
    const cl = $('#capClear');
    if (cl)
      cl.addEventListener('click', () => {
        state.clips = state.clips.filter((c) => !c.caption);
        pushHistory();
        renderAll();
        toast('Captions cleared');
      });
    const byokKey = $('#capKey');
    if (byokKey)
      byokKey.addEventListener('change', () => {
        AI.keys[AI.provider] = byokKey.value.trim();
        AI.save();
        toast('Key saved');
      });
  });
  return `
  <button class="btn primary big" id="capAuto">Auto caption</button>
  <div class="row2">
    <select id="capLang" class="sel">${LANGS.map(([v, n]) => `<option value="${v}" ${CAPLANG === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
  </div>
  <p class="hint">Captions are generated from this clip's audio, then each word lights up as it is spoken. Fix any misheard word in the transcript below — the timing follows automatically.</p>
  ${
    BYOK
      ? `<input id="capKey" type="password" placeholder="Your transcription API key" value="${escapeHtml(AI.key())}">`
      : ''
  }
  ${
    caps.length
      ? `<div class="lbl">Transcript · ${caps.length} lines</div>
  <div id="transcript">${caps
    .map(
      (c) => `<div class="txrow" data-id="${c.id}">
      <div class="txtime" data-id="${c.id}">${fmt(c.start).slice(0, 5)}</div>
      <div style="flex:1;min-width:0">
        <textarea class="txta" data-id="${c.id}" rows="2" spellcheck="true">${escapeHtml(c.text.str || '')}</textarea>
      </div>
    </div>`
    )
    .join('')}</div>
  <div class="lbl">Caption presets</div>
  <div class="chips">${CAPTION_PRESETS.map((p, i) => `<button class="chip" data-cpreset="${i}">${p.n}</button>`).join('')}</div>
  <div class="lbl">Caption style</div>
  <label class="row"><span>Size</span><input id="capSize" type="range" min="28" max="110" step="1" value="${(anyCap.text && anyCap.text.size) || 54}" data-bind="size"><b>${(anyCap.text && anyCap.text.size) || 54}</b></label>
  <div class="row2"><span class="hint">Highlight</span><input type="color" id="capHl" value="${(anyCap.text && anyCap.text.hlBg) || '#2ee6a8'}">
    <select id="capBg" class="sel">
      <option value="none" ${anyCap.text.bg === 'none' ? 'selected' : ''}>No box</option>
      <option value="rgba(0,0,0,0.45)" ${anyCap.text.bg === 'rgba(0,0,0,0.45)' ? 'selected' : ''}>Dark box</option>
      <option value="rgba(0,0,0,0.72)" ${anyCap.text.bg === 'rgba(0,0,0,0.72)' ? 'selected' : ''}>Black box</option>
      <option value="rgba(255,255,255,0.85)" ${anyCap.text.bg === 'rgba(255,255,255,0.85)' ? 'selected' : ''}>White box</option>
    </select></div>
  <div class="btnrow">
    <button class="btn" id="capExport">Export .srt</button>
    <button class="btn" id="capClear">Clear all</button>
  </div>`
      : '<div class="empty">No captions yet.<br>Tap <b>Auto caption</b> and the whole clip is transcribed — then edit any line here.</div>'
  }`;
}

function importSRT(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  let n = 0;
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    const tm = lines.find((l) => l.includes('-->'));
    if (!tm) continue;
    const [a, z] = tm.split('-->').map((s) => parseSrtTime(s.trim()));
    const str = lines.slice(lines.indexOf(tm) + 1).join(' ');
    if (!str) continue;
    const c = addTextClip(str);
    c.start = a;
    c.dur = Math.max(0.4, z - a);
    c.y = 0.3;
    c.text.size = 54;
    c.text.bg = 'rgba(0,0,0,0.6)';
    n++;
  }
  pushHistory();
  renderAll();
  toast(n + ' captions imported');
}

function parseSrtTime(s) {
  const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

function exportSRT() {
  const caps = clipsOn('T1').filter((c) => c.text && c.text.str);
  if (!caps.length) return toast('No captions to export');
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const ts = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))},${pad(Math.floor((s % 1) * 1000), 3)}`;
  const body = caps.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.start + c.dur)}\n${c.text.str}\n`).join('\n');
  download(new Blob([body], { type: 'text/plain' }), 'captions.srt');
}

const TITLE_PRESETS = [
  { n: 'Bold white', t: { size: 84, color: '#ffffff', font: 'sans', bg: 'none', stroke: true, anim: 'pop' }, y: 0 },
  { n: 'Lower third', t: { size: 44, color: '#ffffff', font: 'sans', bg: 'rgba(0,0,0,0.62)', stroke: false, anim: 'slideLeft' }, y: 0.3 },
  { n: 'Caption bar', t: { size: 52, color: '#ffffff', font: 'sans', bg: 'rgba(0,0,0,0.55)', stroke: false, anim: 'fade' }, y: 0.32 },
  { n: 'Mint highlight', t: { size: 64, color: '#04120d', font: 'sans', bg: '#2ee6a8', stroke: false, anim: 'scaleIn' }, y: 0.28 },
  { n: 'News strap', t: { size: 40, color: '#ffffff', font: 'impact', bg: '#e5484d', stroke: false, anim: 'slideUp' }, y: 0.33 },
  { n: 'Cinema title', t: { size: 92, color: '#ffffff', font: 'serif', bg: 'none', stroke: true, anim: 'blurIn' }, y: -0.22 },
  { n: 'Typewriter', t: { size: 58, color: '#ffffff', font: 'mono', bg: 'rgba(0,0,0,0.5)', stroke: false, anim: 'type' }, y: 0.3 },
  { n: 'Neon glow', t: { size: 76, color: '#7cf7d0', font: 'sans', bg: 'none', stroke: false, anim: 'glow' }, y: 0 },
  { n: 'Big impact', t: { size: 110, color: '#ffffff', font: 'impact', bg: 'none', stroke: true, anim: 'bounce' }, y: 0 },
  { n: 'Minimal', t: { size: 40, color: '#ffffff', font: 'sans', bg: 'none', stroke: false, anim: 'fade' }, y: -0.34 },
];

const CAPTION_PRESETS = [
  { n: 'Clean', t: { size: 54, color: '#ffffff', bg: 'rgba(0,0,0,0.45)', hlBg: '#2ee6a8', font: 'sans' } },
  { n: 'Boxed', t: { size: 50, color: '#ffffff', bg: 'rgba(0,0,0,0.78)', hlBg: '#ffd166', font: 'sans' } },
  { n: 'Karaoke', t: { size: 60, color: '#ffffff', bg: 'none', hlBg: '#6b4eff', font: 'sans' } },
  { n: 'Bold yellow', t: { size: 58, color: '#ffffff', bg: 'none', hlBg: '#ffd400', font: 'impact' } },
  { n: 'Light', t: { size: 48, color: '#1f1d2b', bg: 'rgba(255,255,255,0.88)', hlBg: '#6b4eff', font: 'sans' } },
  { n: 'Subtle', t: { size: 44, color: '#ffffff', bg: 'none', hlBg: '#2ee6a8', font: 'serif' } },
];

function filtersPanel(c) {
  if (!c || c.kind === 'audio') return noSel('Select a video, photo or text clip to apply a look.');
  setTimeout(() => {
    if (!$('[data-look]')) return;
    $$('[data-look]').forEach((b) =>
      b.addEventListener('click', () => {
        c.filter = b.dataset.look;
        if (c.lookIntensity == null) c.lookIntensity = 1;
        renderPanel();
        renderFrame(t);
        pushHistory();
      })
    );
    const li = $('#lookInt');
    if (li) onRange(li, (v) => (c.lookIntensity = v));
    const all = $('#lookAll');
    if (all)
      all.addEventListener('click', () => {
        state.clips.filter((x) => x.kind === 'video' || x.kind === 'image').forEach((x) => {
          x.filter = c.filter;
          x.lookIntensity = c.lookIntensity == null ? 1 : c.lookIntensity;
        });
        pushHistory();
        renderFrame(t);
        toast('Look applied to every clip');
      });
  });
  return `<div class="chips wide">${Object.keys(LOOKS)
    .map((k) => `<button class="chip ${c.filter === k ? 'on' : ''}" data-look="${k}">${LOOKS[k].n}</button>`)
    .join('')}</div>
  <label class="row"><span>Intensity</span><input id="lookInt" type="range" min="0" max="1" step="0.05" value="${c.lookIntensity == null ? 1 : c.lookIntensity}" data-bind="int"><b>${Math.round((c.lookIntensity == null ? 1 : c.lookIntensity) * 100)}%</b></label>
  <div class="btnrow"><button class="btn" id="lookAll">Apply this look to all clips</button></div>`;
}

function adjustPanel(c) {
  if (!c) return noSel('Select a clip to adjust colour, framing, blending and transitions.');
  const isVisual = c.kind !== 'audio';
  setTimeout(() => {
    if (!$('#adjB')) return;
    const map = { Bright: 'b', Contrast: 'c', Saturation: 's', Hue: 'h' };
    $$('input[type=range]', $('#panelBody')).forEach((inp) => {
      const key = map[inp.dataset.bind];
      if (!key) return;
      onRange(inp, (v) => (c.adj[key] = v));
    });
    onRange($('#adjScale'), (v) => (c.scale = v));
    onRange($('#adjX'), (v) => (c.x = v));
    onRange($('#adjY'), (v) => (c.y = v));
    onRange($('#adjRot'), (v) => (c.rotate = v));
    onRange($('#adjOp'), (v) => (c.opacity = v));
    const bl = $('#adjBlend');
    if (bl) bl.addEventListener('change', () => { c.blend = bl.value; renderFrame(t); pushHistory(); });
    const tr = $('#adjTrans');
    if (tr)
      tr.addEventListener('change', () => {
        c.transIn = { type: tr.value, dur: (c.transIn && c.transIn.dur) || 0.6 };
        renderPanel();
        renderFrame(t);
        pushHistory();
      });
    const td = $('#adjTransDur');
    if (td) onRange(td, (v) => { c.transIn = { type: (c.transIn && c.transIn.type) || 'dissolve', dur: v }; renderFrame(t); });
    const ov = $('#adjOverlap');
    if (ov)
      ov.addEventListener('click', () => {
        const dur = (c.transIn && c.transIn.dur) || 0.6;
        const prev = clipsOn(c.trackId).filter((x) => x.id !== c.id && x.start < c.start).pop();
        if (!prev) return toast('No clip before this one on the track');
        if (!c.transIn || c.transIn.type === 'none') c.transIn = { type: 'dissolve', dur };
        c.start = Math.max(prev.start + 0.1, c.start - dur);
        pushHistory();
        renderAll();
        toast('Overlapped with the previous clip');
      });
    $('#adjFlip').addEventListener('click', () => { c.flipH = !c.flipH; renderFrame(t); pushHistory(); });
    $('#adjReset').addEventListener('click', () => {
      c.adj = { b: 1, c: 1, s: 1, h: 0 };
      c.scale = 1; c.x = 0; c.y = 0; c.rotate = 0; c.flipH = false; c.opacity = 1;
      renderPanel(); renderFrame(t); pushHistory();
    });
  });
  const a = c.adj;
  return `
  <label class="row"><span>Bright</span><input id="adjB" type="range" min="0.4" max="1.8" step="0.01" value="${a.b}" data-bind="Bright"><b>${a.b.toFixed(2)}</b></label>
  <label class="row"><span>Contrast</span><input id="adjC" type="range" min="0.4" max="1.8" step="0.01" value="${a.c}" data-bind="Contrast"><b>${a.c.toFixed(2)}</b></label>
  <label class="row"><span>Saturation</span><input id="adjS" type="range" min="0" max="2" step="0.01" value="${a.s}" data-bind="Saturation"><b>${a.s.toFixed(2)}</b></label>
  <label class="row"><span>Hue</span><input id="adjH" type="range" min="-180" max="180" step="1" value="${a.h}" data-bind="Hue"><b>${a.h}</b></label>
  ${isVisual ? `
  <div class="lbl">Framing</div>
  <label class="row"><span>Scale</span><input id="adjScale" type="range" min="0.2" max="3" step="0.01" value="${c.scale}" data-bind="scale"><b>${c.scale.toFixed(2)}</b></label>
  <label class="row"><span>X</span><input id="adjX" type="range" min="-0.5" max="0.5" step="0.01" value="${c.x}" data-bind="x"><b>${c.x.toFixed(2)}</b></label>
  <label class="row"><span>Y</span><input id="adjY" type="range" min="-0.5" max="0.5" step="0.01" value="${c.y}" data-bind="y"><b>${c.y.toFixed(2)}</b></label>
  <label class="row"><span>Rotate</span><input id="adjRot" type="range" min="-180" max="180" step="1" value="${c.rotate}" data-bind="rot"><b>${c.rotate}</b></label>
  <label class="row"><span>Opacity</span><input id="adjOp" type="range" min="0" max="1" step="0.01" value="${c.opacity}" data-bind="op"><b>${Math.round(c.opacity * 100)}%</b></label>
  <div class="lbl">Blend mode</div>
  <select id="adjBlend" class="sel">${BLENDS.map((b) => `<option value="${b}" ${(c.blend || 'source-over') === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
  <div class="lbl">Transition in</div>
  <select id="adjTrans" class="sel">${Object.keys(TRANSITIONS).map((k) => `<option value="${k}" ${((c.transIn && c.transIn.type) || 'none') === k ? 'selected' : ''}>${TRANSITIONS[k]}</option>`).join('')}</select>
  <label class="row"><span>Length</span><input id="adjTransDur" type="range" min="0.2" max="2" step="0.05" value="${(c.transIn && c.transIn.dur) || 0.6}" data-bind="tdur"><b>${((c.transIn && c.transIn.dur) || 0.6).toFixed(2)}s</b></label>
  <div class="btnrow"><button class="btn" id="adjOverlap">Overlap previous clip</button><button class="btn" id="adjFlip">Flip</button></div>
  ` : ''}
  <div class="btnrow"><button class="btn" id="adjReset">Reset adjustments</button></div>`;
}

function speedPanel(c) {
  if (!c || c.kind === 'text' || c.kind === 'image') return noSel('Select a video or audio clip to change its speed.');
  setTimeout(() => {
    if (!$('#spd')) return;
    onRange($('#spd'), (v) => {
      c.speed = v;
      const m = media[c.mediaId];
      if (m && c.kind !== 'image') c.dur = Math.min(c.dur, Math.max(0.2, (m.duration - c.inPoint) / v));
      renderTimeline();
    });
  });
  return `<label class="row"><span>Speed</span><input id="spd" type="range" min="0.25" max="3" step="0.05" value="${c.speed}" data-bind="speed"><b>${c.speed.toFixed(2)}x</b></label>
  <div class="chips">${[0.25, 0.5, 1, 1.5, 2, 3].map((v) => `<button class="chip" data-sp="${v}">${v}x</button>`).join('')}</div>
  <p class="hint">Speed is applied to the source video and its audio pitch stays natural.</p>`;
}

function audioPanel(c) {
  if (!c || c.kind === 'text' || c.kind === 'image') return noSel('Select a video or audio clip to control its sound.');
  const cleaned = !!c.cleanMediaId;
  setTimeout(() => {
    if (!$('#vol')) return;
    onRange($('#vol'), (v) => {
      c.volume = v;
      syncElements(t, playing);
    });
    onRange($('#fin'), (v) => (c.fadeIn = v));
    onRange($('#fout'), (v) => (c.fadeOut = v));
    const st = $('#nrStr');
    if (st) st.addEventListener('change', () => pushHistory());
    denoiseService().then((s) => {
      const sel = $('#nrMode');
      if (!sel) return;
      const opt = sel.querySelector('option[value="studio"]');
      if (!s.ok) {
        opt.disabled = true;
        opt.textContent = 'Studio \u2014 AI model (not on this deployment)';
      } else {
        opt.textContent = 'Studio \u2014 AI model (' + bestBackendLabel(s.backends) + ')';
      }
    });
    $('#nr').addEventListener('click', async () => {
      const strength = st ? +st.value : 0.8;
      const mode = $('#nrMode') ? $('#nrMode').value : 'fast';
      pause();
      try {
        if (mode === 'studio') {
          showBusy('Studio noise removal', 'separating the voice from the background');
          startCrawl(92);
          const clean = await denoiseStudio(c, strength, (p, el) => setBusy(Math.round((p || 0) * 100), 'working\u2026 ' + (el ? el + 's' : '')));
          stopCrawl();
          setBusy(100, 'done');
          installCleanAudio(c, clean);
          hideBusy();
          pushHistory();
          renderPanel();
          renderAll();
          toast('Studio noise removal applied');
        } else {
          showBusy('Removing background noise', 'analysing this clip on the device');
          startCrawl(85);
          const r = await denoiseClip(c, strength, (n) => setBusy(null, n));
          stopCrawl();
          setBusy(100, 'done');
          hideBusy();
          pushHistory();
          renderPanel();
          renderAll();
          const drop = r.before > 0 ? Math.round((1 - r.after / r.before) * 100) : 0;
          toast('Noise removed \u2014 overall level ' + drop + '% lower');
        }
      } catch (e) {
        hideBusy();
        toast(e && e.message === 'NO_AUDIO' ? 'That clip has no usable audio track' : 'Noise removal failed: ' + (e.message || e));
      }
    });
    const un = $('#nrUndo');
    if (un)
      un.addEventListener('click', () => {
        removeCleanAudio(c);
        pushHistory();
        renderPanel();
        renderAll();
        toast('Back to the original audio');
      });
  });
  return `
  <label class="row"><span>Volume</span><input id="vol" type="range" min="0" max="2" step="0.01" value="${c.volume}" data-bind="vol"><b>${Math.round(c.volume * 100)}%</b></label>
  <label class="row"><span>Fade in</span><input id="fin" type="range" min="0" max="3" step="0.05" value="${c.fadeIn}" data-bind="fin"><b>${c.fadeIn.toFixed(2)}s</b></label>
  <label class="row"><span>Fade out</span><input id="fout" type="range" min="0" max="3" step="0.05" value="${c.fadeOut}" data-bind="fout"><b>${c.fadeOut.toFixed(2)}s</b></label>
  <div class="lbl">Noise removal ${cleaned ? '\u00b7 applied' : ''}</div>
  <label class="row"><span>Strength</span><input id="nrStr" type="range" min="0.3" max="1" step="0.05" value="0.8" data-bind="str"><b>0.80</b></label>
  <select id="nrMode" class="sel">
    <option value="fast">Fast \u2014 on this device</option>
    <option value="studio">Studio \u2014 AI model</option>
  </select>
  <div class="btnrow">
    <button class="btn ${cleaned ? '' : 'primary'}" id="nr">${cleaned ? 'Re-run noise removal' : 'Remove background noise'}</button>
    ${cleaned ? '<button class="btn" id="nrUndo">Undo</button>' : ''}
  </div>
  <p class="hint" id="nrHint">Fast mode learns the hiss and room tone of this clip and subtracts it, on the device, in under a second. Studio mode sends the clip's audio to the noise-removal model, which separates the voice from everything else \u2014 slower, and much stronger on traffic, fans and music.</p>`;
}

/* ------------------------------------------------------------- templates */

const TEMPLATES = [
  { id: 'yt', n: 'YouTube video', d: '16:9 · crisp look · bold title', aspect: '16:9', look: 'crisp', title: 0, cap: 0 },
  { id: 'reel', n: 'Instagram Reel', d: '9:16 · vivid · karaoke captions', aspect: '9:16', look: 'vivid', title: 0, cap: 2 },
  { id: 'wedding', n: 'Wedding highlight', d: '16:9 · golden · soft titles', aspect: '16:9', look: 'golden', title: 5, cap: 5 },
  { id: 'promo', n: 'Product promo', d: '1:1 · punchy · mint highlight', aspect: '1:1', look: 'punch', title: 3, cap: 1 },
  { id: 'news', n: 'News explainer', d: '16:9 · cinematic · red strap', aspect: '16:9', look: 'cinematic', title: 4, cap: 1 },
  { id: 'podcast', n: 'Podcast clip', d: '9:16 · film · boxed captions', aspect: '9:16', look: 'film', title: 1, cap: 2 },
];

function applyTemplate(id) {
  const tp = TEMPLATES.find((x) => x.id === id);
  if (!tp) return;
  state.aspect = tp.aspect;
  if ($('#aspectSel')) $('#aspectSel').value = tp.aspect;
  if ($('#aspectBadge')) $('#aspectBadge').textContent = tp.aspect;
  state.clips
    .filter((c) => c.kind === 'video' || c.kind === 'image')
    .forEach((c) => {
      c.filter = tp.look;
      c.lookIntensity = 1;
    });
  const cp = CAPTION_PRESETS[tp.cap];
  if (cp) state.clips.filter((c) => c.caption).forEach((c) => Object.assign(c.text, cp.t));
  const t = TITLE_PRESETS[tp.title];
  const tc = addTextClip(tp.n);
  if (t) {
    Object.assign(tc.text, t.t);
    tc.y = t.y;
  }
  resizeCanvas();
  pushHistory();
  renderAll();
  toast(tp.n + ' applied');
}

function templatesPanel() {
  setTimeout(() => {
    if (!$('[data-tpl]')) return;
    $$('[data-tpl]').forEach((b) => b.addEventListener('click', () => applyTemplate(b.dataset.tpl)));
  });
  return `<p class="hint">One tap sets the aspect ratio, a look on every clip, the caption style and a matching title.</p>
  <div class="tplgrid">${TEMPLATES.map(
    (tp) => `<button class="tpl" data-tpl="${tp.id}">
      <span class="tplprev">${tp.aspect}</span>
      <b>${tp.n}</b>
      <i>${tp.d}</i>
    </button>`
  ).join('')}</div>`;
}

/* ------------------------------------------------------- local project library
   Free tier keeps projects (and their media) in this browser's IndexedDB. */

const LIB = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('capedit', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async store(mode) {
    const db = await this.open();
    return db.transaction('projects', mode).objectStore('projects');
  },
  async put(rec) {
    const s = await this.store('readwrite');
    return new Promise((res, rej) => {
      const q = s.put(rec);
      q.onsuccess = () => res(rec.id);
      q.onerror = () => rej(q.error);
    });
  },
  async all() {
    const s = await this.store('readonly');
    return new Promise((res, rej) => {
      const q = s.getAll();
      q.onsuccess = () => res(q.result || []);
      q.onerror = () => rej(q.error);
    });
  },
  async del(id) {
    const s = await this.store('readwrite');
    return new Promise((res) => {
      const q = s.delete(id);
      q.onsuccess = () => res(true);
      q.onerror = () => res(false);
    });
  },
};

function projectJSON() {
  return JSON.stringify(
    { aspect: state.aspect, clips: state.clips, tracks: state.tracks, name: state.name },
    (k, v) => (k === '_el' || k === '_nodes' || k === '_cleanEl' ? undefined : v)
  );
}

async function saveToLibrary() {
  try {
    const id = state.projectId || (state.projectId = uid());
    const mediaRecs = Object.values(media)
      .filter((m) => m.blob)
      .map((m) => ({ id: m.id, kind: m.kind, name: m.name, type: m.blob.type, duration: m.duration, w: m.w, h: m.h, blob: m.blob }));
    await LIB.put({ id, name: state.name, updated: Date.now(), json: projectJSON(), media: mediaRecs });
    toast('Saved on this device');
    renderPanel();
  } catch (e) {
    toast('Could not save: ' + (e && e.message ? e.message : e));
  }
}

async function loadFromLibrary(id) {
  try {
    const recs = await LIB.all();
    const rec = recs.find((r) => r.id === id);
    if (!rec) return;
    for (const m of Object.values(media)) {
      try {
        URL.revokeObjectURL(m.url);
      } catch (e) {}
    }
    Object.keys(media).forEach((k) => delete media[k]);
    for (const r of rec.media || []) {
      media[r.id] = { id: r.id, kind: r.kind, name: r.name, url: URL.createObjectURL(r.blob), blob: r.blob, duration: r.duration, w: r.w, h: r.h };
    }
    const s = JSON.parse(rec.json);
    state.aspect = s.aspect;
    state.tracks = s.tracks;
    state.clips = s.clips;
    state.name = rec.name;
    state.projectId = rec.id;
    selectedId = null;
    if ($('#aspectSel')) $('#aspectSel').value = state.aspect;
    if ($('#aspectBadge')) $('#aspectBadge').textContent = state.aspect;
    if ($('#projName')) $('#projName').value = state.name;
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === (LEFT_TABS.indexOf(b.dataset.tab) >= 0 ? leftTab : rightTab)));
    resizeCanvas();
    renderAll();
    pushHistory();
    toast('Opened "' + rec.name + '"');
  } catch (e) {
    toast('Could not open that project');
  }
}

async function deleteFromLibrary(id) {
  await LIB.del(id);
  renderPanel();
  toast('Project deleted');
}

function libraryListHTML(recs) {
  if (!recs.length) return '';
  return `<div class="lbl">Saved on this device</div>
  <div class="caplist">${recs
    .sort((x, y) => y.updated - x.updated)
    .map(
      (r) => `<div class="librow">
      <button class="capItem" data-open="${r.id}"><b>${new Date(r.updated).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</b> ${escapeHtml(r.name)}</button>
      <button class="libdel" data-del="${r.id}" title="Delete">×</button>
    </div>`
    )
    .join('')}</div>`;
}

/* --------------------------------------------------------------- busy overlay */

let crawlTimer = null;

function showBusy(title, note) {
  $('#busyTitle').textContent = title;
  $('#busyNote').textContent = note || '';
  $('#busyPct').style.width = '3%';
  $('#busyWrap').classList.add('show');
}
function setBusy(pct, note) {
  if (pct != null) $('#busyPct').style.width = clamp(pct, 0, 100) + '%';
  if (note) $('#busyNote').textContent = note;
}
function startCrawl(limit) {
  stopCrawl();
  let p = 6;
  crawlTimer = setInterval(() => {
    p = Math.min(limit || 88, p + Math.max(0.4, (limit || 88 - p) * 0.02));
    $('#busyPct').style.width = p + '%';
  }, 400);
}
function stopCrawl() {
  if (crawlTimer) clearInterval(crawlTimer);
  crawlTimer = null;
}
function hideBusy() {
  stopCrawl();
  $('#busyWrap').classList.remove('show');
}

/* ============================================================================
   AUTO CAPTIONS — speech recognition that runs on the device (Whisper, ONNX)
   ========================================================================== */

const ASR = { pipe: null, loading: null, lib: null, localLib: false, localModels: false };
let CAPLANG = 'auto';

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

async function urlExists(u) {
  try {
    const r = await fetch(u, { method: 'HEAD' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function ensureASRLib() {
  if (ASR.lib) return ASR.lib;
  const CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
  ASR.localLib = await urlExists('transformers.min.js');
  // the bundle is an ES module, so it is imported rather than script-tagged
  const mod = await import(ASR.localLib ? './transformers.min.js' : CDN);
  ASR.lib = mod.default || mod;
  const T = ASR.lib;
  if (!T || !T.pipeline) throw new Error('the AI runtime did not load');
  const env = T.env;
  ASR.localModels = await urlExists('models/Xenova/whisper-tiny/config.json');
  env.allowLocalModels = ASR.localModels;
  env.allowRemoteModels = !ASR.localModels;
  env.useBrowserCache = !!(window.isSecureContext && typeof caches !== 'undefined');
  if (ASR.localModels) env.localModelPath = 'models/';
  try {
    if (ASR.localLib) env.backends.onnx.wasm.wasmPaths = 'ort/';
    const threaded = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
    env.backends.onnx.wasm.numThreads = threaded ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  } catch (e) {}
  return T;
}

async function ensureASR(onProgress) {
  if (ASR.pipe) return ASR.pipe;
  if (ASR.loading) return ASR.loading;
  ASR.loading = (async () => {
    const T = await ensureASRLib();
    const pipe = await T.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      quantized: true,
      progress_callback: (p) => onProgress && onProgress(p),
    });
    ASR.pipe = pipe;
    return pipe;
  })();
  try {
    return await ASR.loading;
  } finally {
    ASR.loading = null;
  }
}

function resampleTo16k(input, from) {
  if (!from || Math.abs(from - 16000) < 1) return input;
  const ratio = from / 16000;
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

function rmsOf(f) {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return f.length ? Math.sqrt(s / f.length) : 0;
}

async function decodeBlobAudio(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  try {
    const raw = await blob.arrayBuffer();
    const buf = await new Promise((res, rej) => {
      const p = actx.decodeAudioData(raw, res, rej);
      if (p && p.then) p.then(res).catch(rej);
    });
    return buf;
  } finally {
    try {
      actx.close();
    } catch (e) {}
  }
}

/* mono, 16 kHz, trimmed to the part of the file the clip actually uses */
function trimMix16k(buf, inPoint, dur, speed) {
  const sr = buf.sampleRate;
  const startS = Math.max(0, inPoint || 0);
  const endS = Math.min(buf.duration, startS + (dur || buf.duration) * (speed || 1));
  const i0 = Math.max(0, Math.floor(startS * sr));
  const i1 = Math.max(i0 + 1, Math.min(buf.length, Math.floor(endS * sr)));
  const n = i1 - i0;
  const mono = new Float32Array(n);
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i0 + i] / chs;
  }
  return resampleTo16k(mono, sr);
}

/* Fallback for files the platform decoder refuses (some HEVC/AAC mp4s in
   WebView): play the clip through the audio graph and record what comes out. */
async function captureClipAudio(clip, onProgress, maxSeconds) {
  ensureAudioCtx();
  if (!ac) throw new Error('no audio engine');
  if (ac.state === 'suspended') await ac.resume();
  const nodes = ensureAudio(clip);
  if (!nodes || !nodes.src) throw new Error('cannot tap this clip');
  const dest = ac.createMediaStreamDestination();
  nodes.src.connect(dest);
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const rec = new MediaRecorder(dest.stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const el = nodes.el || elFor(clip);
  const prevRate = el.playbackRate;
  try {
    el.playbackRate = 1;
    el.muted = false;
    el.currentTime = clip.inPoint;
    rec.start(200);
    await el.play().catch(() => {});
    const need = Math.min(clip.dur * clip.speed, maxSeconds || 1e9);
    await new Promise((res) => {
      const iv = setInterval(() => {
        const done = el.currentTime - clip.inPoint;
        if (onProgress) onProgress(clamp(done / need, 0, 1));
        if (done >= need - 0.08 || el.ended || el.paused) {
          clearInterval(iv);
          res();
        }
      }, 120);
      setTimeout(() => {
        clearInterval(iv);
        res();
      }, (need + 3) * 1000);
    });
    el.pause();
  } finally {
    try {
      el.playbackRate = prevRate || 1;
    } catch (e) {}
    if (rec.state !== 'inactive') rec.stop();
    await new Promise((r) => (rec.onstop = r));
    try {
      nodes.src.disconnect(dest);
    } catch (e) {}
  }
  if (!chunks.length) throw new Error('nothing was captured');
  return decodeBlobAudio(new Blob(chunks, { type: 'audio/webm' }));
}

/* Every AI feature needs the clip's sound as 16 kHz mono floats. This tries the
   fast decoder first and falls back to a real-time capture, then refuses to
   hand silence to a speech model (silence is what makes Whisper invent text). */
async function audioFromClip(clip, onNote) {
  const m = media[clip.mediaId];
  if (!m || !m.blob) throw new Error('that clip has no media');
  let audio = null;
  try {
    const buf = await decodeBlobAudio(m.blob);
    audio = trimMix16k(buf, clip.inPoint, clip.dur, clip.speed);
  } catch (e) {
    audio = null;
  }
  if (!audio || rmsOf(audio) < 2e-4) {
    // The platform decoder gave us silence. Before spending a real-time pass on
    // the whole clip, listen to the first 15 s to see whether there is sound at all.
    if (onNote) onNote('re-reading the audio track…');
    try {
      const probeBuf = await captureClipAudio(clip, null, 15);
      const probe = trimMix16k(probeBuf, 0, Math.min(clip.dur * clip.speed, 15), 1);
      if (rmsOf(probe) < 2e-4) throw new Error('NO_AUDIO');
      if (clip.dur * clip.speed <= 15.5) {
        audio = probe;
      } else {
        const cap = await captureClipAudio(clip, (p) => onNote && onNote('reading audio ' + Math.round(p * 100) + '%'));
        audio = trimMix16k(cap, 0, clip.dur * clip.speed, 1);
      }
    } catch (e) {
      if (e && e.message === 'NO_AUDIO') throw e;
    }
  }
  if (!audio || !audio.length) throw new Error('NO_AUDIO');
  if (rmsOf(audio) < 2e-4) throw new Error('NO_AUDIO');
  return { audio, sampleRate: 16000, offset: clip.inPoint };
}

function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ------------------------------------------------------- spectral denoiser
   Real noise removal, not a tone control: STFT -> per-bin noise floor
   estimate (20th percentile over time) -> spectral subtraction with a
   residual floor and gain smoothing -> inverse STFT overlap-add. */

function makeFFT(n) {
  const levels = Math.round(Math.log(n) / Math.LN2);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i,
      r = 0;
    for (let j = 0; j < levels; j++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }
  const cos = new Float32Array(n / 2),
    sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return function (re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1,
        step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cos[k],
            s = inverse ? sin[k] : -sin[k];
          const tre = re[j + half] * c - im[j + half] * s;
          const tim = re[j + half] * s + im[j + half] * c;
          re[j + half] = re[j] - tre;
          im[j + half] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  };
}

function spectralDenoise(x, strength) {
  const N = 1024,
    H = 256,
    half = N / 2 + 1;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const fft = makeFFT(N);
  const frames = Math.max(1, Math.floor((x.length - N) / H) + 1);
  const mags = new Float32Array(frames * half);
  const phases = new Float32Array(frames * half);
  const re = new Float32Array(N),
    im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const off = f * H;
    for (let i = 0; i < N; i++) {
      const s = off + i < x.length ? x[off + i] : 0;
      re[i] = s * win[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let k = 0; k < half; k++) {
      mags[f * half + k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      phases[f * half + k] = Math.atan2(im[k], re[k]);
    }
  }
  // per-bin noise floor: 20th percentile across time
  const noise = new Float32Array(half);
  const col = new Float32Array(frames);
  for (let k = 0; k < half; k++) {
    for (let f = 0; f < frames; f++) col[f] = mags[f * half + k];
    const sorted = Array.prototype.slice.call(col).sort((p, q) => p - q);
    noise[k] = sorted[Math.floor(frames * 0.2)] || 0;
  }
  // gains with over-subtraction, a residual floor, and smoothing
  const floor = 0.06;
  const over = 1.4;
  const prevG = new Float32Array(half).fill(1);
  const g = new Float32Array(half);
  const out = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < half; k++) {
      const m = mags[f * half + k];
      const n = noise[k] * over;
      let gain = m > 1e-9 ? 1 - (strength * n) / m : floor;
      if (gain < floor) gain = floor;
      if (gain > 1) gain = 1;
      g[k] = gain;
    }
    // smooth across frequency, then blend with the previous frame in time
    for (let k = 0; k < half; k++) {
      const a = g[Math.max(0, k - 1)],
        b = g[k],
        c = g[Math.min(half - 1, k + 1)];
      const sm = (a + 2 * b + c) / 4;
      g[k] = 0.65 * prevG[k] + 0.35 * sm;
      prevG[k] = g[k];
    }
    const off = f * H;
    for (let k = 0; k < half; k++) {
      const mag = mags[f * half + k] * g[k];
      const ph = phases[f * half + k];
      re[k] = mag * Math.cos(ph);
      im[k] = mag * Math.sin(ph);
      if (k > 0 && k < N - k) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) {
      const idx = off + i;
      if (idx >= x.length) break;
      out[idx] += re[i] * win[i];
      norm[idx] += win[i] * win[i];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  return out;
}

function installCleanAudio(clip, clean, sr) {
  const rate = sr || 16000;
  const wav = encodeWav(clean, rate);
  const id = uid();
  media[id] = {
    id,
    kind: 'audio',
    name: (clip.name || 'clip') + ' (clean)',
    url: URL.createObjectURL(wav),
    blob: wav,
    duration: clean.length / rate,
    w: 0,
    h: 0,
  };
  if (clip.cleanMediaId) removeCleanAudio(clip);
  clip.cleanMediaId = id;
  delete clip._nodes;
  if (ac) ensureAudio(clip);
  return id;
}

async function denoiseClip(clip, strength, onNote) {
  const { audio } = await audioFromClip(clip, onNote);
  if (onNote) onNote('estimating the noise floor\u2026');
  await new Promise((r) => setTimeout(r, 30));
  const clean = spectralDenoise(audio, strength);
  const before = rmsOf(audio);
  const after = rmsOf(clean);
  installCleanAudio(clip, clean);
  return { before, after };
}

/* ------------------------------------------------------- studio noise removal
   Sends the clip audio to the denoise service (Demucs / DeepFilterNet /
   spectral), polls the job, and installs whatever comes back. */

const DENOISE = { checked: false, ok: false, backends: null };

async function denoiseService() {
  if (DENOISE.checked) return DENOISE;
  DENOISE.checked = true;
  try {
    const r = await fetch('api/denoise', { headers: { accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    DENOISE.ok = r.ok && j && j.ok === true;
    DENOISE.backends = (j && j.backends) || null;
  } catch (e) {
    DENOISE.ok = false;
  }
  return DENOISE;
}

function bestBackendLabel(b) {
  if (!b) return 'AI model';
  if (b.demucs) return 'Demucs';
  if (b.dfn) return 'DeepFilterNet';
  return 'spectral';
}

async function denoiseStudio(clip, strength, onProgress) {
  const { audio } = await audioFromClip(clip, null);
  const wav = encodeWav(audio, 16000);
  const fd = new FormData();
  fd.append('file', new File([wav], 'clip.wav', { type: 'audio/wav' }));
  fd.append('backend', 'auto');
  fd.append('strength', String(strength));
  const r = await fetch('api/denoise', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.job_id) throw new Error(j.error || j.detail || 'could not start the job');
  const id = j.job_id;
  let finished = false;
  for (let i = 0; i < 300; i++) {
    await wait(1200);
    let s = {};
    try {
      s = await (await fetch('api/denoise/' + id)).json();
    } catch (e) {}
    if (s.status === 'failed' || (s.error && s.status !== 'done')) throw new Error(s.error || 'the job failed');
    if (onProgress) onProgress(s.progress || 0, s.elapsed);
    if (s.status === 'done') {
      finished = true;
      break;
    }
  }
  if (!finished) throw new Error('timed out waiting for the service');
  const res = await fetch('api/denoise/' + id + '/result');
  if (!res.ok) throw new Error('could not fetch the cleaned file');
  const blob = await res.blob();
  const buf = await decodeBlobAudio(blob);
  return trimMix16k(buf, 0, buf.duration, 1);
}

function removeCleanAudio(clip) {
  if (clip.cleanMediaId && media[clip.cleanMediaId]) {
    try {
      URL.revokeObjectURL(media[clip.cleanMediaId].url);
    } catch (e) {}
    delete media[clip.cleanMediaId];
  }
  delete clip.cleanMediaId;
  if (clip._cleanEl) {
    try {
      clip._cleanEl.remove();
    } catch (e) {}
    delete clip._cleanEl;
  }
  delete clip._nodes;
  if (clip._el) clip._el.muted = !ac;
  if (ac) ensureAudio(clip);
}

/* ------------------------------------------------------------- AI settings */

const AI = {
  mode: 'device',
  provider: 'groq',
  baseUrl: '',
  keys: {},
  load() {
    try {
      this.mode = localStorage.getItem('capedit.ai.mode') || 'device';
      this.provider = localStorage.getItem('capedit.ai.provider') || 'groq';
      this.baseUrl = localStorage.getItem('capedit.ai.baseUrl') || '';
      this.keys = JSON.parse(localStorage.getItem('capedit.ai.keys') || '{}');
    } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem('capedit.ai.mode', this.mode);
      localStorage.setItem('capedit.ai.provider', this.provider);
      localStorage.setItem('capedit.ai.baseUrl', this.baseUrl);
      localStorage.setItem('capedit.ai.keys', JSON.stringify(this.keys));
    } catch (e) {}
  },
  key() {
    return (this.keys[this.provider] || '').trim();
  },
};

const STT_PROVIDERS = {
  groq: {
    label: 'Groq · whisper-large-v3-turbo',
    kind: 'openai',
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3-turbo',
    signup: 'console.groq.com (free tier)',
  },
  openai: {
    label: 'OpenAI · whisper-1',
    kind: 'openai',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1',
    signup: 'platform.openai.com',
  },
  deepgram: {
    label: 'Deepgram · nova-2',
    kind: 'deepgram',
    url: 'https://api.deepgram.com/v1/listen',
    model: 'nova-2',
    signup: 'console.deepgram.com (free credit)',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    url: '',
    model: 'whisper-1',
    signup: 'your own faster-whisper / vLLM server',
  },
};

/* ------------------------------------------------------- transcription paths */

async function transcribeOffline(clip, lang, onNote) {
  const pipe = await ensureASR();
  const { audio, offset } = await audioFromClip(clip, onNote);
  if (onNote) onNote('listening… ' + Math.round(audio.length / 16000) + 's of audio');
  const opts = {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    task: 'transcribe',
    condition_on_previous_text: false,
  };
  if (lang && lang !== 'auto') opts.language = lang;
  const res = await pipe(audio, opts);
  const words = [];
  for (const ch of res.chunks || []) {
    const ts = ch.timestamp || [0, 0];
    const txt = String(ch.text || '').trim();
    if (!txt) continue;
    const s = (ts[0] == null ? 0 : ts[0]) + offset;
    const e = (ts[1] == null ? s + 0.35 : ts[1]) + offset;
    words.push({ w: txt, s, e: Math.max(e, s + 0.08) });
  }
  return words;
}

async function transcribeCloud(clip, lang, onNote) {
  const p = STT_PROVIDERS[AI.provider];
  if (!p) throw new Error('pick a provider');
  const key = AI.key();
  if (!key) throw new Error('add your ' + p.label.split('·')[0].trim() + ' API key first');
  const url = AI.provider === 'custom' ? AI.baseUrl.trim() : p.url;
  if (!url) throw new Error('set the endpoint URL for the custom provider');
  const { audio, offset } = await audioFromClip(clip, onNote);
  const wav = encodeWav(audio, 16000);
  if (wav.size > 24 * 1024 * 1024) throw new Error('that clip is too long for one upload — split it under ~12 minutes');
  if (onNote) onNote('uploading ' + (wav.size / 1048576).toFixed(1) + ' MB…');

  let words = [];
  if (p.kind === 'deepgram') {
    const q = new URLSearchParams({ model: p.model, smart_format: 'true', punctuate: 'true' });
    if (lang && lang !== 'auto') q.set('language', lang);
    const r = await fetch(url + '?' + q.toString(), {
      method: 'POST',
      headers: { Authorization: 'Token ' + key, 'Content-Type': 'audio/wav' },
      body: wav,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(cloudErr(r.status, j));
    const alt = (((j.results || {}).channels || [{}])[0].alternatives || [{}])[0];
    for (const w of alt.words || []) {
      const txt = (w.punctuated_word || w.word || '').trim();
      if (txt) words.push({ w: txt, s: w.start + offset, e: w.end + offset });
    }
  } else {
    const fd = new FormData();
    fd.append('file', new File([wav], 'audio.wav', { type: 'audio/wav' }));
    fd.append('model', p.model);
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    if (lang && lang !== 'auto') fd.append('language', lang);
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(cloudErr(r.status, j));
    if (Array.isArray(j.words) && j.words.length) {
      for (const w of j.words) {
        const txt = String(w.word || '').trim();
        if (txt) words.push({ w: txt, s: w.start + offset, e: w.end + offset });
      }
    } else if (Array.isArray(j.segments)) {
      for (const sg of j.segments) {
        const parts = String(sg.text || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) continue;
        const step = (sg.end - sg.start) / parts.length;
        parts.forEach((txt, k) =>
          words.push({ w: txt, s: offset + sg.start + k * step, e: offset + sg.start + (k + 1) * step })
        );
      }
    } else if (typeof j.text === 'string' && j.text.trim()) {
      const parts = j.text.trim().split(/\s+/);
      const step = (clip.dur * clip.speed) / parts.length;
      parts.forEach((txt, k) =>
        words.push({ w: txt, s: offset + k * step, e: offset + (k + 1) * step })
      );
    }
  }
  if (!words.length) throw new Error('the service returned no words');
  return words;
}

function cloudErr(status, j) {
  const msg = (j && (j.error && (j.error.message || j.error)) ) || (j && j.message) || '';
  if (status === 401 || status === 403) return 'key rejected (' + status + ') — check the API key';
  if (status === 429) return 'rate limited — wait a moment or check your plan';
  if (status === 413) return 'audio too long for one request';
  return 'service error ' + status + (msg ? ': ' + msg : '');
}

/* ------------------------------------------------------------ caption build */

function buildCaptionSegments(words, clip) {
  const segs = [];
  let cur = null;
  const MAXW = 6;
  const MAXD = 3.4;
  const clipEnd = clip.start + clip.dur;
  for (const w of words) {
    const ts = clamp(clip.start + (w.s - clip.inPoint) / clip.speed, clip.start, clipEnd);
    const te = clamp(clip.start + (w.e - clip.inPoint) / clip.speed, ts + 0.08, clipEnd);
    const item = { w: w.w, s: ts, e: te };
    const prev = cur && cur.words[cur.words.length - 1];
    const gap = prev ? ts - prev.e : 0;
    if (!cur || cur.words.length >= MAXW || ts - cur.start > MAXD || gap > 0.7) {
      cur = { start: ts, end: te, words: [] };
      segs.push(cur);
    }
    cur.words.push(item);
    cur.end = te;
    if (/[.!?।]$/.test(w.w) && cur.words.length >= 3) cur = null;
  }
  return segs;
}

function applyCaptionSegments(segs, style) {
  state.clips = state.clips.filter((c) => !c.caption);
  const st = style || {};
  for (const sg of segs) {
    state.clips.push({
      id: uid(),
      trackId: 'T1',
      kind: 'text',
      caption: true,
      mediaId: null,
      name: 'Caption',
      start: sg.start,
      dur: Math.max(0.45, sg.end - sg.start + 0.12),
      inPoint: 0,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      filter: 'none',
      adj: { b: 1, c: 1, s: 1, h: 0 },
      x: 0,
      y: 0.3,
      scale: 1,
      rotate: 0,
      opacity: 1,
      flipH: false,
      noise: false,
      words: sg.words,
      text: {
        str: sg.words.map((w) => w.w).join(' '),
        size: st.size || 54,
        color: '#ffffff',
        font: 'sans',
        bg: st.bg || 'rgba(0,0,0,0.45)',
        stroke: true,
        anim: 'none',
        align: 'center',
        hlBg: st.hlBg || '#2ee6a8',
        hlColor: '#04120d',
      },
    });
  }
}

const BYOK = /(^|[?&])byok=1/.test(location.search);
const SVC = { checked: false, ok: false };

async function serviceAvailable() {
  if (SVC.checked) return SVC.ok;
  SVC.checked = true;
  try {
    const r = await fetch('api/transcribe', { method: 'GET', headers: { accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    SVC.ok = r.ok && j && j.ok === true;
  } catch (e) {
    SVC.ok = false;
  }
  return SVC.ok;
}

async function transcribeViaService(clip, lang, onNote) {
  const { audio, offset } = await audioFromClip(clip, onNote);
  const wav = encodeWav(audio, 16000);
  if (wav.size > 24 * 1024 * 1024) throw new Error('that clip is too long for one request — split it first');
  if (onNote) onNote('transcribing…');
  const fd = new FormData();
  fd.append('audio', new File([wav], 'audio.wav', { type: 'audio/wav' }));
  if (lang && lang !== 'auto') fd.append('language', lang);
  const r = await fetch('api/transcribe', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'transcription service error ' + r.status);
  const words = (j.words || []).map((w) => ({ w: w.w, s: w.s + offset, e: w.e + offset }));
  if (!words.length) throw new Error('no speech found');
  return words;
}

async function autoCaption(lang) {
  const targets = state.clips.filter((c) => (c.kind === 'video' || c.kind === 'audio') && c.mediaId);
  if (!targets.length) return toast('Add a video or audio clip first');
  const sel = getClip(selectedId);
  const clip = sel && (sel.kind === 'video' || sel.kind === 'audio') ? sel : targets[0];
  pause();
  showBusy('Auto caption', 'reading the audio in this clip');
  try {
    let words = null;
    if (await serviceAvailable()) {
      words = await transcribeViaService(clip, lang, (n) => setBusy(null, n));
    } else if (BYOK && AI.key()) {
      words = await transcribeCloud(clip, lang, (n) => setBusy(null, n));
    } else {
      await ensureASR((p) => {
        if (p && p.status === 'progress' && p.progress != null) setBusy(p.progress, 'preparing the speech engine');
        else if (p && p.status) setBusy(null, 'preparing the speech engine');
      });
      words = await transcribeOffline(clip, lang, (n) => setBusy(null, n));
    }
    if (!words || !words.length) {
      hideBusy();
      return toast('No speech detected in that clip');
    }
    const segs = buildCaptionSegments(words, clip);
    applyCaptionSegments(segs);
    pushHistory();
    renderAll();
    hideBusy();
    setTab('captions');
    toast(segs.length + ' caption lines ready to edit');
  } catch (e) {
    hideBusy();
    const msg = e && e.message ? e.message : String(e);
    if (msg === 'NO_AUDIO') toast('That clip has no usable audio track');
    else {
      console.error(e);
      toast('Caption failed: ' + msg);
    }
  }
}

/* ----------------------------------------------------------------- export */

function pickMime() {
  const cands = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const c of cands) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function blobToBase64(b) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = rej;
    fr.readAsDataURL(b);
  });
}

/* On Android (CapEdit APK) exports go straight into Movies/CapEdit via a native
   bridge; in a plain browser we fall back to a normal file download. */
async function download(blob, name) {
  const bridge = window.CapEditAndroid;
  if (bridge && bridge.startFile) {
    try {
      if (!bridge.startFile(name, blob.type || 'application/octet-stream')) {
        toast('Could not create the output file');
        return;
      }
      const CH = 256 * 1024;
      for (let off = 0; off < blob.size; off += CH) {
        const b64 = await blobToBase64(blob.slice(off, off + CH));
        if (!bridge.saveChunk(b64)) throw new Error('write failed');
      }
      const path = bridge.finishFile();
      toast(path ? 'Saved to ' + path : 'Saved to gallery');
      return;
    } catch (e) {
      toast('Save failed: ' + e.message);
      return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 10000);
}

async function exportVideo() {
  if (!state.clips.length) return toast('Timeline is empty');
  if (!window.MediaRecorder) return toast('This browser cannot record video. Use Chrome.');
  pause();
  ensureAudioCtx();
  if (ac && ac.state === 'suspended') await ac.resume();
  exportMode = true;
  resizeCanvas();
  for (const c of state.clips) {
    if (c.kind === 'video' || c.kind === 'audio') {
      elFor(c);
      ensureAudio(c);
    } else if (c.kind === 'image') elFor(c);
  }
  await wait(400);
  seek(0);

  const vs = canvas.captureStream(30);
  const at = streamDest ? streamDest.stream.getAudioTracks()[0] : null;
  const stream = new MediaStream(at ? [vs.getVideoTracks()[0], at] : [vs.getVideoTracks()[0]]);
  const mime = pickMime();
  let rec;
  try {
    rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 9000000, audioBitsPerSecond: 128000 });
  } catch (e) {
    exportMode = false;
    resizeCanvas();
    return toast('Recorder unavailable on this browser');
  }
  const chunks = [];
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);

  const done = new Promise((resolve) => {
    rec.onstop = () => {
      const type = mime.includes('mp4') ? 'video/mp4' : 'video/webm';
      const blob = new Blob(chunks, { type });
      const ext = type === 'video/mp4' ? 'mp4' : 'webm';
      exportMode = false;
      resizeCanvas();
      resolve({ blob, ext });
    };
  });

  $('#exportWrap').classList.add('show');
  $('#exportPct').style.width = '0%';
  $('#exportNote').textContent = 'Recording in real time — keep this screen open';

  rec.start(250);
  play();
  const total = projectDuration();
  const tick = setInterval(() => {
    $('#exportPct').style.width = Math.min(100, (t / total) * 100) + '%';
  }, 200);
  onEndCallback = () => {
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), 300);
  };
  if (playing) {
    // safety: if playback never ends (e.g. tab throttled), stop after duration*1.6
    setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
    }, (total + 3) * 1000);
  }
  const { blob, ext } = await done;
  clearInterval(tick);
  $('#exportPct').style.width = '100%';
  $('#exportNote').textContent = `Done — ${(blob.size / 1048576).toFixed(1)} MB .${ext}`;
  const name = (state.name || 'capedit').replace(/[^\w\-]+/g, '-').toLowerCase();
  download(blob, `${name}.${ext}`);
  setTimeout(() => $('#exportWrap').classList.remove('show'), 1400);
  renderAll();
}

/* ---------------------------------------------------------- project files */

function saveProject() {
  const data = { app: 'CapEdit', version: 1, state: { aspect: state.aspect, clips: state.clips, tracks: state.tracks, name: state.name } };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), (state.name || 'project') + '.capedit.json');
}

async function loadProject(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.state) throw new Error('bad file');
  state.aspect = data.state.aspect || '9:16';
  state.name = data.state.name || 'Project';
  state.tracks = data.state.tracks;
  state.clips = data.state.clips.map((c) => {
    delete c._el;
    delete c._nodes;
    return c;
  });
  $('#aspectSel').value = state.aspect;
  resizeCanvas();
  renderAll();
  toast('Project loaded — re-import the media files to relink');
}

/* -------------------------------------------------------------- app wiring */

function wire() {
  const pn = $('#projName');
  if (pn)
    pn.addEventListener('change', () => {
      state.name = pn.value.trim() || 'Untitled project';
      pushHistory();
    });
  $('#fileInput').addEventListener('change', (e) => {
    importFiles(e.target.files);
    e.target.value = '';
  });
  $('#btnPlay').addEventListener('click', togglePlay);
  $('#btnSplit').addEventListener('click', splitAtPlayhead);
  $('#btnDel').addEventListener('click', deleteSelected);
  $('#btnDup').addEventListener('click', duplicateSelected);
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnExport').addEventListener('click', exportVideo);
  $('#btnSave').addEventListener('click', saveProject);
  $('#projFile').addEventListener('change', (e) => {
    if (e.target.files[0]) loadProject(e.target.files[0]).catch(() => toast('Could not read that project file'));
  });
  $('#aspectSel').addEventListener('change', (e) => {
    state.aspect = e.target.value;
    $('#aspectBadge').textContent = state.aspect;
    exportMode = false;
    resizeCanvas();
    renderFrame(t);
    pushHistory();
  });
  $('#zoomIn').addEventListener('click', () => {
    pps = clamp(pps * 1.3, 25, 320);
    renderTimeline();
  });
  $('#zoomOut').addEventListener('click', () => {
    pps = clamp(pps / 1.3, 25, 320);
    renderTimeline();
  });
  $$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // click / drag on the ruler and lanes to scrub
  const scroll = $('#tlScroll');
  const scrub = (e) => {
    const r = $('#tlTracks').getBoundingClientRect();
    seek((e.clientX - r.left) / pps);
  };
  scroll.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.clip')) return;
    scrub(e);
    const move = (ev) => scrub(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // keyboard (desktop convenience)
  window.addEventListener('keydown', (e) => {
    if (/input|textarea/i.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
    if (e.key === 's') splitAtPlayhead();
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'ArrowRight') seek(t + 1 / 30);
    if (e.key === 'ArrowLeft') seek(t - 1 / 30);
  });

  window.addEventListener('resize', () => {
    layoutStage();
    if (isMobileLayout()) hostPanel();
    renderPanel();
  });
  window.addEventListener('orientationchange', () => setTimeout(layoutStage, 120));
  watchStage();
  // delegate panel buttons that live outside the panel
  document.addEventListener('click', (e) => {
    const t1 = e.target;
    if (t1.id === 'btnImport') $('#fileInput').click();
    if (t1.id === 'btnAddText') addTextClip('Your text');
    if (t1.id === 'btnVoice') recordVoiceover();
    if (t1.closest && t1.closest('[data-sp]')) {
      const c = getClip(selectedId);
      if (c) {
        c.speed = +t1.closest('[data-sp]').dataset.sp;
        renderPanel();
        renderTimeline();
        pushHistory();
      }
    }
  });
}

async function recordVoiceover() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('Microphone not available');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const file = new File([blob], 'voiceover.webm', { type: 'audio/webm' });
      const id = await addMediaFromFile(file);
      if (id) {
        const c = addClipFromMedia(id, 'A1');
        c.start = t;
        pushHistory();
        renderAll();
        toast('Voiceover added');
      }
    };
    rec.start();
    toast('Recording… tap Voiceover again to stop');
    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn primary';
    stopBtn.textContent = '■ Stop recording';
    stopBtn.style.position = 'fixed';
    stopBtn.style.left = '50%';
    stopBtn.style.bottom = '40%';
    stopBtn.style.transform = 'translateX(-50%)';
    stopBtn.style.zIndex = 99;
    stopBtn.onclick = () => {
      rec.stop();
      stopBtn.remove();
    };
    document.body.appendChild(stopBtn);
  } catch (e) {
    toast('Mic permission denied');
  }
}

/* ------------------------------------------------------------------- boot */

function boot() {
  AI.load();
  if (isMobileLayout()) hostPanel();
  resizeCanvas();
  wire();
  renderAll();
  if ($('#projName')) $('#projName').value = state.name;
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === (LEFT_TABS.indexOf(b.dataset.tab) >= 0 ? leftTab : rightTab)));
  curSnap = snapshot();
  requestAnimationFrame(loop);
  if (!window.MediaRecorder) toast('Recording needs Chrome or Firefox');
  // offline install when hosted over http(s); harmless inside the APK
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
