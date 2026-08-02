/**
 * particles.js
 * ---------------------------------------------------------------
 * One shared canvas + render loop, configured per-theme via the "particles"
 * field in style/style.json. No per-theme JS — every theme is just a config
 * object read by the same handful of particle-type renderers below.
 *
 * Usage: import { initParticles } from './particles.js'; initParticles();
 * Call again (or call setEnabled) whenever the theme or the user's
 * "show background effects" setting changes.
 * ---------------------------------------------------------------
 */

let canvas = null;
let ctx = null;
let particles = [];
let rafId = null;
let themes = null;
let enabled = true;
let lastResizeW = 0;
let lastResizeH = 0;

const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resolveColor(token) {
  const styles = getComputedStyle(document.documentElement);
  switch (token) {
    case 'accent': return styles.getPropertyValue('--accent').trim() || '#ffffff';
    case 'text': return styles.getPropertyValue('--text').trim() || '#ffffff';
    case 'text-strong': return styles.getPropertyValue('--text-strong').trim() || '#ffffff';
    case 'text-muted': return styles.getPropertyValue('--text-muted').trim() || '#ffffff';
    default: return token || '#ffffff';
  }
}

/**
 * Parses either #rgb/#rrggbb hex or an rgb()/rgba() string into {r,g,b}.
 * The rgb()/rgba() branch matters specifically for browser-registered
 * `<color>` custom properties (e.g. Cosmic's --accent, animated via
 * @property) — computed-style reads of those serialize as rgb(...), not
 * hex, so a hex-only parser silently produced white for every particle
 * that was supposed to be colored with them.
 */
function parseColorToRgb(input) {
  const str = (input || '').trim();

  const rgbMatch = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgbMatch) {
    return {
      r: Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[1])))),
      g: Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[2])))),
      b: Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[3])))),
    };
  }

  const clean = str.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return { r: 255, g: 255, b: 255 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'waystone-particles';
  canvas.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;';
  document.body.prepend(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (enabled) start();
  });
}

function resize() {
  if (!canvas) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w === lastResizeW && h === lastResizeH) return;
  lastResizeW = w; lastResizeH = h;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

/* ---------- particle factories, one per "type" in style.json ---------- */

function spawnDriftLike(layer, w, h) {
  const rgb = parseColorToRgb(resolveColor(layer.color));
  return {
    kind: 'dot',
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * (layer.speed || 0.2),
    vy: (layer.type === 'snow' ? Math.abs(layer.speed || 0.2) : (Math.random() - 0.5) * (layer.speed || 0.2)),
    r: (layer.type === 'snow' ? 1 + Math.random() * 2 : 1 + Math.random() * 1.5),
    rgb,
    opacity: (layer.opacity?.[0] ?? 0.1) + Math.random() * ((layer.opacity?.[1] ?? 0.3) - (layer.opacity?.[0] ?? 0.1)),
    flicker: layer.type === 'firefly' || layer.type === 'spark',
    phase: Math.random() * Math.PI * 2,
  };
}

function spawnTwinkle(layer, w, h) {
  const rgb = parseColorToRgb(resolveColor(layer.color));
  return {
    kind: 'twinkle',
    x: Math.random() * w,
    y: Math.random() * h,
    r: 0.5 + Math.random() * 1.3,
    rgb,
    baseOpacity: (layer.opacity?.[0] ?? 0.1) + Math.random() * ((layer.opacity?.[1] ?? 0.5) - (layer.opacity?.[0] ?? 0.1)),
    phase: Math.random() * Math.PI * 2,
    speed: (layer.twinkleSpeed || 0.02) * (0.5 + Math.random()),
  };
}

function scheduleStreak(layer, w, h, list) {
  const [minMs, maxMs] = layer.frequency || [8000, 20000];
  const delay = minMs + Math.random() * (maxMs - minMs);
  setTimeout(() => {
    if (!enabled) { scheduleStreak(layer, w, h, list); return; }
    const rgb = parseColorToRgb(resolveColor(layer.color));
    const fromLeft = Math.random() > 0.5;
    const startX = fromLeft ? -20 : w + 20;
    const startY = Math.random() * h * 0.6;
    const angle = fromLeft ? Math.PI / 6 : Math.PI - Math.PI / 6;
    list.push({
      kind: 'streak',
      x: startX, y: startY,
      vx: Math.cos(angle) * (layer.speed || 8),
      vy: Math.sin(angle) * (layer.speed || 8) + 1.5,
      len: layer.length || 80,
      rgb,
      opacity: layer.opacity ?? 0.8,
      life: 1,
    });
    scheduleStreak(layer, w, h, list);
  }, delay);
}

/* ---------- build particle set from a theme's config ---------- */

function buildParticles(config) {
  const list = [];
  if (!config || !config.layers) return list;
  const w = window.innerWidth, h = window.innerHeight;
  for (const layer of config.layers) {
    if (layer.type === 'streak') { scheduleStreak(layer, w, h, list); continue; }
    const count = layer.count || 20;
    const factory = layer.type === 'twinkle' ? spawnTwinkle : spawnDriftLike;
    for (let i = 0; i < count; i++) list.push(factory(layer, w, h));
  }
  return list;
}

/* ---------- render loop ---------- */

function tick() {
  if (!enabled || !ctx) return;
  const w = window.innerWidth, h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    if (p.kind === 'dot') {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -5) p.x = w + 5; if (p.x > w + 5) p.x = -5;
      if (p.y < -5) p.y = h + 5; if (p.y > h + 5) p.y = -5;
      let op = p.opacity;
      if (p.flicker) { p.phase += 0.03; op *= 0.5 + 0.5 * Math.sin(p.phase); }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.rgb.r},${p.rgb.g},${p.rgb.b},${op})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'twinkle') {
      p.phase += p.speed;
      const op = p.baseOpacity * (0.4 + 0.6 * Math.abs(Math.sin(p.phase)));
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.rgb.r},${p.rgb.g},${p.rgb.b},${op})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'streak') {
      p.x += p.vx; p.y += p.vy; p.life -= 0.02;
      const tailX = p.x - p.vx * (p.len / Math.max(Math.hypot(p.vx, p.vy), 0.001)) * 0.4;
      const tailY = p.y - p.vy * (p.len / Math.max(Math.hypot(p.vx, p.vy), 0.001)) * 0.4;
      const grad = ctx.createLinearGradient(p.x, p.y, tailX, tailY);
      grad.addColorStop(0, `rgba(${p.rgb.r},${p.rgb.g},${p.rgb.b},${p.opacity * Math.max(p.life, 0)})`);
      grad.addColorStop(1, `rgba(${p.rgb.r},${p.rgb.g},${p.rgb.b},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      if (p.life <= 0 || p.x < -100 || p.x > w + 100 || p.y > h + 100) particles.splice(i, 1);
    }
  }

  rafId = requestAnimationFrame(tick);
}

function start() {
  if (rafId || !enabled || prefersReducedMotion()) return;
  rafId = requestAnimationFrame(tick);
}

function stop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

/* ---------- public API ---------- */

async function loadThemes() {
  if (themes) return themes;
  const res = await fetch('/style/style.json');
  themes = await res.json();
  return themes;
}

function currentThemeId() {
  try { return localStorage.getItem('waystone-preview-theme') || 'default'; } catch (e) { return 'default'; }
}

function particlesSettingOn() {
  try {
    const v = localStorage.getItem('waystone-particles-enabled');
    return v === null ? true : v === '1';
  } catch (e) { return true; }
}

export async function initParticles() {
  if (prefersReducedMotion() || !particlesSettingOn()) { enabled = false; return; }
  ensureCanvas();
  const list = await loadThemes();
  const theme = list.find(t => t.id === currentThemeId()) || list[0];
  particles = buildParticles(theme.particles);
  enabled = true;
  start();
}

export function setParticlesEnabled(value) {
  try { localStorage.setItem('waystone-particles-enabled', value ? '1' : '0'); } catch (e) {}
  if (value) { initParticles(); } else { enabled = false; stop(); if (canvas) ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

export function refreshParticlesForTheme() {
  if (!enabled) return;
  loadThemes().then(list => {
    const theme = list.find(t => t.id === currentThemeId()) || list[0];
    particles = buildParticles(theme.particles);
  });
}
