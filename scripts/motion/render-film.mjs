// Film de présentation Savora — rendu image par image + mixage de la voix off.
//
//   node scripts/motion/render-film.mjs                  -> motion/savora-film.mp4
//   node scripts/motion/render-film.mjs --still 12,22,34 -> motion/qa/still-12.png ...
//   node scripts/motion/render-film.mjs --fps 25         -> cadence personnalisée
//
// Prérequis : @napi-rs/canvas, ffmpeg dans le PATH (ou FFMPEG_PATH),
// voix off générée par generate-voiceover.ps1 et nappe par generate-bed.mjs.

import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = 1920;
const H = 1080;
const FPS = Number(readArg('--fps') || 30);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const TAU = Math.PI * 2;
const SERIF = 'SavoraSerif';
const SANS = 'SavoraSans';
const SANS_BOLD = 'SavoraSansBold';
const SANS_SEMI = 'SavoraSansSemibold';

const INK = '#f6efe4';
const MUTED = '#a89f92';
const EMBER = '#ff6a2b';
const AMBER = '#f0b45b';
const CREAM = '#e7d6bd';

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

GlobalFonts.registerFromPath('C:/Windows/Fonts/georgia.ttf', SERIF);
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeui.ttf', SANS);
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', SANS_BOLD);
GlobalFonts.registerFromPath('C:/Windows/Fonts/seguisb.ttf', SANS_SEMI);

const timing = JSON.parse(readFileSync(join(ROOT, 'motion', 'timing.json'), 'utf8'));

const STORY = [
  {
    id: 'ouverture',
    kicker: 'MAISON SAVORA · LOMÉ',
    title: ['Savora'],
    lead: '',
    note: '',
    caption: 'Savora. Restaurant et grill, au cœur de Lomé. Bienvenue à table.',
  },
  {
    id: 'feu',
    kicker: '02 — LE FEU',
    title: ['Tout commence', 'par le feu.'],
    lead: "Des braises vives, des viandes choisies, et ce goût fumé qu'on ne fabrique pas.",
    note: 'CUISSON À LA BRAISE',
    caption:
      "Tout commence par le feu. Des braises vives, des viandes choisies, et ce goût fumé qu'on ne fabrique pas.",
  },
  {
    id: 'carte',
    kicker: '03 — LA CARTE',
    title: ['Court, franc,', 'généreux.'],
    lead: 'Produits frais, recettes maison, carte du jour. Rien d’inutile.',
    note: 'MISE À JOUR EN DIRECT',
    caption:
      "Chaque jour, une carte courte et franche. Produits frais, recettes maison, saveurs généreuses. Rien d'inutile.",
  },
  {
    id: 'commande',
    kicker: '04 — COMMANDER',
    title: ['Trois façons', 'de passer à table.'],
    lead: 'Sur place, à emporter ou livré chez vous. Confirmation immédiate sur WhatsApp.',
    note: '',
    caption:
      "Choisissez vos plats, commandez en quelques secondes. Sur place, à emporter, ou livrés chez vous. Et la confirmation arrive aussitôt sur WhatsApp.",
  },
  {
    id: 'gestion',
    kicker: '05 — GESTION',
    title: ['Le service,', 'sous contrôle.'],
    lead: 'Menu, commandes, stocks : un tableau de bord clair, pensé pour le service.',
    note: 'ESPACE RESTAURATEUR',
    caption:
      'Et côté cuisine, tout est sous contrôle. Menu, commandes, stocks : un tableau de bord clair, pensé pour le service.',
  },
  {
    id: 'signature',
    kicker: 'SIGNATURE',
    title: ['À très vite', 'chez Savora.'],
    lead: 'Commandez en ligne, la confirmation arrive sur WhatsApp.',
    note: '',
    caption: 'Savora. La cuisine du feu, simplement. Commandez maintenant.',
  },
];

const SCENES = timing.scenes.map((item, index) => ({ ...item, ...STORY[index] }));
const TOTAL = timing.total;

/* ---------------------------------------------------------------- utils */

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t) => {
  const x = clamp(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const fadeIn = (t, duration, delay = 0) => easeOut(clamp((t - delay) / duration));
const fadeOut = (t, start, duration) => 1 - clamp((t - start) / duration);
const window = (t, start, end, inDur = 0.35, outDur = 0.35) =>
  Math.min(fadeIn(t, inDur, start), fadeOut(t, end - outDur, outDur));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function font(size, weight = '400', family = SERIF) {
  return `${weight} ${size}px ${family}`;
}

function measureTracked(ctx, text, tracking) {
  let width = 0;
  for (const char of text) width += ctx.measureText(char).width + tracking;
  return width - (text.length > 0 ? tracking : 0);
}

function drawTracked(ctx, text, x, y, { size = 20, weight = '600', family = SANS_BOLD, tracking = 4, color = INK, alpha = 1, align = 'left' } = {}) {
  ctx.save();
  ctx.font = font(size, weight, family);
  const width = measureTracked(ctx, text, tracking);
  let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  ctx.fillStyle = color;
  ctx.globalAlpha *= alpha;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + tracking;
  }
  ctx.restore();
}

function wrapLines(ctx, text, maxWidth, textFont) {
  ctx.save();
  ctx.font = textFont;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

function drawParagraph(ctx, text, x, y, { maxWidth = 640, size = 27, lineHeight = 42, color = '#c6bcae', alpha = 1, weight = '400', family = SANS } = {}) {
  const lines = wrapLines(ctx, text, maxWidth, font(size, weight, family));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.font = font(size, weight, family);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  ctx.restore();
  return lines.length;
}

function drawRevealLine(ctx, text, x, baseline, { size, alpha = 1, progress = 1, gradient, color = INK, family = SERIF, weight = '400', align = 'left' }) {
  ctx.save();
  ctx.font = font(size, weight, family);
  const width = ctx.measureText(text).width;
  const left = align === 'center' ? x - width / 2 : x;
  const height = size * 1.08;
  const top = baseline - size * 0.92;

  ctx.beginPath();
  ctx.rect(left - 12, top, width + 24, height * progress + 4);
  ctx.clip();

  const offset = (1 - progress) * height * 0.9;
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = gradient || color;
  ctx.fillText(text, left, baseline + offset);
  ctx.restore();
}

/* --------------------------------------------------------------- assets */

const logoImage = await loadImage(join(ROOT, 'public', 'logo-savora-sm.png'));
const dishImages = {
  pizza: await loadImage(join(ROOT, 'motion', 'assets', 'dishes', 'pizza.jpg')),
  pate: await loadImage(join(ROOT, 'motion', 'assets', 'dishes', 'pate.jpg')),
  limonade: await loadImage(join(ROOT, 'motion', 'assets', 'dishes', 'limonade.jpg')),
};

const DISHES = [
  { key: 'pizza', category: 'FOUR À PIERRE', name: 'Pizza', price: '1 500 XOF', rotate: -0.12, dx: -272, dy: 44, scale: 0.94 },
  { key: 'pate', category: 'PLAT DU JOUR', name: 'Pâte & ebessessi', price: '1 000 XOF', rotate: 0.12, dx: 272, dy: 44, scale: 0.94 },
  {
    key: 'limonade',
    category: 'BOISSON FRAÎCHE',
    name: 'Limonade maison',
    price: '1 000 XOF',
    rotate: 0,
    dx: 0,
    dy: -6,
    scale: 1,
  },
];

function drawImageCover(ctx, image, x, y, w, h) {
  const ratio = Math.max(w / image.width, h / image.height);
  const dw = image.width * ratio;
  const dh = image.height * ratio;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Sprite de braise (une seule fois, réutilisé chaque frame)
const emberSprite = (() => {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 226, 190, 1)');
  gradient.addColorStop(0.25, 'rgba(255, 150, 80, 0.85)');
  gradient.addColorStop(0.6, 'rgba(230, 80, 20, 0.28)');
  gradient.addColorStop(1, 'rgba(230, 80, 20, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
})();

// Grain argentique
const grainPattern = (() => {
  const size = 192;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(size, size);
  const random = mulberry32(1337);
  for (let i = 0; i < data.data.length; i += 4) {
    const value = 60 + random() * 150;
    data.data[i] = value;
    data.data[i + 1] = value;
    data.data[i + 2] = value;
    data.data[i + 3] = 26;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
})();

const EMBERS = Array.from({ length: 64 }, (_, index) => {
  const random = mulberry32(index * 977 + 13);
  return {
    x: random() * W,
    y: random() * H,
    size: 3 + random() * 9,
    speed: 14 + random() * 42,
    drift: -30 + random() * 60,
    phase: random() * TAU,
    alpha: 0.16 + random() * 0.5,
    warm: random(),
  };
});

/* ------------------------------------------------------------- drawing */

function drawBackdrop(ctx, sceneId, t) {
  ctx.fillStyle = '#0b0908';
  ctx.fillRect(0, 0, W, H);

  const pulse = 0.5 + 0.5 * Math.sin(t * 0.35);

  const glows = {
    ouverture: [
      [W * 0.5, H * 0.78, 820, 0.3],
      [W * 0.14, H * 0.1, 520, 0.1],
    ],
    feu: [
      [W * 0.76, H * 0.46, 760, 0.34 + pulse * 0.05],
      [W * 0.1, H * 0.86, 560, 0.14],
    ],
    carte: [
      [W * 0.8, H * 0.4, 700, 0.2],
      [W * 0.08, H * 0.9, 520, 0.13],
    ],
    commande: [
      [W * 0.74, H * 0.48, 660, 0.24],
      [W * 0.16, H * 0.12, 520, 0.09],
    ],
    gestion: [
      [W * 0.8, H * 0.32, 620, 0.16],
      [W * 0.1, H * 0.88, 620, 0.16],
    ],
    signature: [
      [W * 0.5, H * 0.46, 900, 0.28 + pulse * 0.04],
      [W * 0.5, H * 1.02, 700, 0.16],
    ],
  }[sceneId];

  for (const [x, y, radius, strength] of glows) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(194, 65, 12, ${strength})`);
    gradient.addColorStop(0.55, `rgba(150, 55, 16, ${strength * 0.35})`);
    gradient.addColorStop(1, 'rgba(120, 40, 12, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  }

  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.95);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

function drawEmbers(ctx, t, intensity = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const ember of EMBERS) {
    const travel = (t * ember.speed + ember.y) % (H + 220);
    const y = H + 60 - travel;
    const x = ember.x + Math.sin(t * 0.6 + ember.phase) * 26 + ember.drift * (travel / (H + 220));
    const alpha = ember.alpha * intensity * clamp(1 - travel / (H + 200)) * (0.6 + 0.4 * Math.sin(t * 2 + ember.phase));
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    const size = ember.size * (ember.warm > 0.75 ? 1.7 : 1);
    ctx.drawImage(emberSprite, x - size / 2, y - size / 2, size, size);
  }
  ctx.restore();
}

function drawGrain(ctx, frame) {
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.globalCompositeOperation = 'overlay';
  const offsetX = (frame * 37) % 192;
  const offsetY = (frame * 61) % 192;
  ctx.translate(-offsetX, -offsetY);
  ctx.fillStyle = ctx.createPattern(grainPattern, 'repeat');
  ctx.fillRect(0, 0, W + 192, H + 192);
  ctx.restore();
}

function drawFlare(ctx, progress) {
  if (progress <= 0 || progress >= 1) return;
  const alpha = Math.sin(progress * Math.PI);
  const width = lerp(60, W * 0.9, easeOut(progress));
  const y = H * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gradient = ctx.createLinearGradient(W / 2 - width / 2, 0, W / 2 + width / 2, 0);
  gradient.addColorStop(0, 'rgba(255, 106, 43, 0)');
  gradient.addColorStop(0.5, `rgba(255, 150, 90, ${0.5 * alpha})`);
  gradient.addColorStop(1, 'rgba(255, 106, 43, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(W / 2 - width / 2, y - 1, width, 2);
  ctx.shadowColor = 'rgba(255, 120, 60, 0.8)';
  ctx.shadowBlur = 30;
  ctx.fillRect(W / 2 - width / 2, y - 1, width, 2);
  ctx.restore();
}

function drawKicker(ctx, text, x, y, alpha, align = 'left') {
  drawTracked(ctx, text, x, y, {
    size: 21,
    tracking: 7,
    color: AMBER,
    alpha,
    align,
  });
}

function drawTitle(ctx, scene, t, x, y, { size = 96, lineHeight = 104, align = 'left' }) {
  const gradient = ctx.createLinearGradient(0, y - size * 1.6, 0, y + 20);
  gradient.addColorStop(0, '#fdf6ea');
  gradient.addColorStop(1, '#e8c365');
  scene.title.forEach((line, index) => {
    const progress = easeOut(clamp((t - 0.35 - index * 0.13) / 0.85));
    if (progress <= 0) return;
    drawRevealLine(ctx, line, x, y + index * lineHeight, {
      size,
      progress,
      gradient,
      align,
    });
  });
}

function drawCaption(ctx, text, globalTime, scene) {
  const local = globalTime - scene.start;
  const alpha = Math.min(fadeIn(local, 0.35, 0.45), 1 - clamp((local - scene.voice) / 0.3));
  if (alpha <= 0.01) return;

  const maxWidth = 1240;
  const lines = wrapLines(ctx, text, maxWidth, font(28, '400', SANS));
  const size = 28;
  const lineHeight = 40;
  const paddingX = 30;
  const paddingY = 18;
  let widest = 0;
  ctx.save();
  ctx.font = font(size, '400', SANS);
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
  ctx.restore();

  const boxWidth = widest + paddingX * 2;
  const boxHeight = lines.length * lineHeight + paddingY * 2 - 6;
  const x = (W - boxWidth) / 2;
  const y = H - 92 - boxHeight;

  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x, y, boxWidth, boxHeight, 14);
  ctx.fillStyle = 'rgba(8, 7, 6, 0.58)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.09)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#ece3d6';
  ctx.font = font(size, '400', SANS);
  ctx.textAlign = 'center';
  lines.forEach((line, index) => {
    ctx.fillText(line, W / 2, y + paddingY + size * 0.92 + index * lineHeight);
  });
  ctx.restore();
}

/* -------------------------------------------------------------- scènes */

function sceneOuverture(ctx, t) {
  const alpha = 1;
  drawEmbers(ctx, t + 2, 1);

  ctx.save();
  ctx.globalAlpha = alpha;

  drawKicker(ctx, 'MAISON SAVORA · LOMÉ', W / 2, 322, fadeIn(t, 0.8, 0.45), 'center');

  const wordmark = ctx.createLinearGradient(0, 300, 0, 700);
  wordmark.addColorStop(0, '#fff8ee');
  wordmark.addColorStop(0.5, '#f4d3a4');
  wordmark.addColorStop(1, '#cf6527');
  drawRevealLine(ctx, 'Savora', W / 2, 640, {
    size: 330,
    progress: easeOut(clamp((t - 0.55) / 1.35)),
    gradient: wordmark,
    align: 'center',
  });

  const ruleWidth = 460 * easeInOut(clamp((t - 1.45) / 1));
  if (ruleWidth > 1) {
    const rule = ctx.createLinearGradient(W / 2 - ruleWidth / 2, 0, W / 2 + ruleWidth / 2, 0);
    rule.addColorStop(0, 'rgba(240, 180, 91, 0)');
    rule.addColorStop(0.5, 'rgba(240, 180, 91, 0.8)');
    rule.addColorStop(1, 'rgba(240, 180, 91, 0)');
    ctx.fillStyle = rule;
    ctx.fillRect(W / 2 - ruleWidth / 2, 700, ruleWidth, 1.5);
  }

  drawTracked(ctx, 'RESTAURANT & GRILL', W / 2, 770, {
    size: 30,
    tracking: 13,
    color: CREAM,
    alpha: fadeIn(t, 0.8, 1.8),
    align: 'center',
  });

  drawTracked(ctx, 'BOULEVARD DU 13 JANVIER · LOMÉ', W / 2, 818, {
    size: 16,
    tracking: 6,
    color: MUTED,
    alpha: fadeIn(t, 0.8, 2.15),
    align: 'center',
  });

  ctx.restore();
}

function sceneFeu(ctx, t, duration) {
  const alpha = 1; // les transitions sont gérées par le fondu enchaîné global
  drawEmbers(ctx, t + 9, 0.9);

  const pulse = 1 + Math.sin(t * 1.5) * 0.018;
  const cx = 1445;
  const cy = 512;
  const radius = 205;

  // halo
  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 2.7);
  halo.addColorStop(0, 'rgba(255, 106, 43, 0.3)');
  halo.addColorStop(0.55, 'rgba(194, 65, 12, 0.12)');
  halo.addColorStop(1, 'rgba(194, 65, 12, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - radius * 3, cy - radius * 3, radius * 6, radius * 6);

  // disque de braise
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse, pulse);
  const disc = ctx.createRadialGradient(-radius * 0.2, -radius * 0.25, radius * 0.05, 0, 0, radius);
  disc.addColorStop(0, '#ffe0b0');
  disc.addColorStop(0.22, '#ff9a4d');
  disc.addColorStop(0.5, '#d7500f');
  disc.addColorStop(0.78, '#732407');
  disc.addColorStop(1, 'rgba(48, 16, 5, 0)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.restore();

  // grille
  const grateIn = easeOut(clamp((t - 0.5) / 0.9));
  for (let i = 0; i < 5; i += 1) {
    const x = cx - 195 + i * 97;
    const barAlpha = clamp((t - 0.5 - i * 0.07) / 0.5);
    ctx.globalAlpha = alpha * barAlpha;
    const bar = ctx.createLinearGradient(0, cy - 215, 0, cy + 215);
    bar.addColorStop(0, 'rgba(18, 13, 10, 0)');
    bar.addColorStop(0.18, 'rgba(14, 10, 8, 0.94)');
    bar.addColorStop(0.82, 'rgba(14, 10, 8, 0.94)');
    bar.addColorStop(1, 'rgba(18, 13, 10, 0)');
    ctx.fillStyle = bar;
    ctx.fillRect(x, cy - 215 * grateIn, 13, 430 * grateIn);
  }

  // vapeur
  ctx.globalAlpha = alpha * 0.75;
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.28)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    const ox = cx - 90 + i * 90;
    const progress = ((t * 0.22 + i * 0.31) % 1);
    ctx.save();
    ctx.globalAlpha = alpha * 0.5 * Math.sin(progress * Math.PI);
    ctx.beginPath();
    ctx.moveTo(ox, cy + 40);
    ctx.bezierCurveTo(ox - 46, cy - 40, ox + 46, cy - 120, ox - 12, cy - 250);
    ctx.stroke();
    ctx.restore();
  }

  drawTracked(ctx, 'BRAISE VIVE', cx, cy + 310, {
    size: 15,
    tracking: 6,
    color: MUTED,
    alpha: fadeIn(t, 0.7, 1.3),
    align: 'center',
  });
  ctx.restore();

  // texte
  ctx.save();
  ctx.globalAlpha = alpha;
  const x = 160;
  drawKicker(ctx, '02 — LE FEU', x, 318, fadeIn(t, 0.6, 0.25));
  drawTitle(ctx, STORY[1], t, x, 448, { size: 92, lineHeight: 102 });
  drawParagraph(ctx, STORY[1].lead, x, 654, {
    maxWidth: 660,
    alpha: fadeIn(t, 0.8, 0.95),
  });
  drawNote(ctx, STORY[1].note, x, 760, fadeIn(t, 0.8, 1.3));
  ctx.restore();
}

function drawNote(ctx, text, x, y, alpha) {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = font(16, '600', SANS_BOLD);
  const width = measureTracked(ctx, text, 3.4) + 52;
  roundRect(ctx, x, y - 22, width, 44, 22);
  ctx.fillStyle = 'rgba(246, 239, 228, 0.03)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.16)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = EMBER;
  ctx.beginPath();
  ctx.arc(x + 24, y, 3.5, 0, TAU);
  ctx.fill();

  drawTracked(ctx, text, x + 38, y + 6, {
    size: 16,
    tracking: 3.4,
    color: '#d9cfc1',
    alpha: 1,
  });
  ctx.restore();
}

function sceneCarte(ctx, t, duration) {
  const alpha = 1; // les transitions sont gérées par le fondu enchaîné global
  drawEmbers(ctx, t + 21, 0.45);

  ctx.save();
  ctx.globalAlpha = alpha;

  // halo derrière les cartes
  const halo = ctx.createRadialGradient(1440, 540, 60, 1440, 540, 520);
  halo.addColorStop(0, 'rgba(255, 140, 70, 0.16)');
  halo.addColorStop(1, 'rgba(255, 140, 70, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(900, 40, 1000, 1000);

  DISHES.forEach((dish, index) => {
    const appear = easeOut(clamp((t - 0.35 - index * 0.17) / 0.95));
    if (appear <= 0) return;
    const cardWidth = 270 * dish.scale;
    const cardHeight = 384 * dish.scale;
    const cx = 1440 + dish.dx;
    const cy = 530 + dish.dy + (1 - appear) * 46;
    const rotation = dish.rotate * appear + (1 - appear) * 0.06;

    ctx.save();
    ctx.globalAlpha = alpha * appear;
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    // ombre portée
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 26;
    roundRect(ctx, -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 20);
    ctx.fillStyle = '#17130f';
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, -cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 20);
    ctx.clip();

    const mediaHeight = 214 * dish.scale;
    drawImageCover(ctx, dishImages[dish.key], -cardWidth / 2, -cardHeight / 2, cardWidth, mediaHeight);
    const shade = ctx.createLinearGradient(0, -cardHeight / 2, 0, -cardHeight / 2 + mediaHeight);
    shade.addColorStop(0, 'rgba(20, 12, 8, 0.1)');
    shade.addColorStop(0.55, 'rgba(20, 12, 8, 0.05)');
    shade.addColorStop(1, 'rgba(18, 12, 9, 0.92)');
    ctx.fillStyle = shade;
    ctx.fillRect(-cardWidth / 2, -cardHeight / 2, cardWidth, mediaHeight);

    ctx.fillStyle = '#17130f';
    ctx.fillRect(-cardWidth / 2, -cardHeight / 2 + mediaHeight, cardWidth, cardHeight - mediaHeight);

    const bodyTop = -cardHeight / 2 + mediaHeight + 26 * dish.scale;
    drawTracked(ctx, dish.category, -cardWidth / 2 + 22 * dish.scale, bodyTop, {
      size: 11 * dish.scale,
      tracking: 2.4,
      color: AMBER,
      alpha: 0.95,
    });

    ctx.fillStyle = INK;
    ctx.font = font(27 * dish.scale, '400', SERIF);
    const nameLines = wrapLines(ctx, dish.name, cardWidth - 44 * dish.scale, font(27 * dish.scale, '400', SERIF));
    nameLines.slice(0, 2).forEach((line, lineIndex) => {
      ctx.fillText(line, -cardWidth / 2 + 22 * dish.scale, bodyTop + 38 * dish.scale + lineIndex * 30 * dish.scale);
    });

    ctx.fillStyle = '#d9cfc1';
    ctx.font = font(18 * dish.scale, '600', SANS_SEMI);
    ctx.fillText(dish.price, -cardWidth / 2 + 22 * dish.scale, cardHeight / 2 - 24 * dish.scale);

    ctx.restore();
    ctx.restore();
  });

  // texte
  const x = 160;
  drawKicker(ctx, '03 — LA CARTE', x, 318, fadeIn(t, 0.6, 0.25));
  drawTitle(ctx, STORY[2], t, x, 448, { size: 92, lineHeight: 102 });
  drawParagraph(ctx, STORY[2].lead, x, 654, { maxWidth: 620, alpha: fadeIn(t, 0.8, 0.95) });
  drawNote(ctx, STORY[2].note, x, 760, fadeIn(t, 0.8, 1.3));
  ctx.restore();
}

function drawPhone(ctx, t, sceneAlpha) {
  const appear = easeOut(clamp((t - 0.2) / 1));
  const cx = 1440;
  const cy = 520 + (1 - appear) * 60;
  const width = 340;
  const height = 646;

  ctx.save();
  ctx.globalAlpha = sceneAlpha * appear;
  ctx.translate(cx, cy);
  ctx.rotate((1 - appear) * 0.04);

  const glow = ctx.createRadialGradient(0, 0, 60, 0, 0, 480);
  glow.addColorStop(0, 'rgba(255, 120, 60, 0.16)');
  glow.addColorStop(1, 'rgba(255, 120, 60, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-480, -480, 960, 960);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 30;
  roundRect(ctx, -width / 2, -height / 2, width, height, 42);
  const frame = ctx.createLinearGradient(-width / 2, -height / 2, width / 2, height / 2);
  frame.addColorStop(0, '#33291f');
  frame.addColorStop(0.55, '#171310');
  frame.addColorStop(1, '#241d16');
  ctx.fillStyle = frame;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, -width / 2, -height / 2, width, height, 42);
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const inset = 11;
  const screenW = width - inset * 2;
  const screenH = height - inset * 2;
  roundRect(ctx, -screenW / 2, -screenH / 2, screenW, screenH, 33);
  ctx.fillStyle = '#faf7f2';
  ctx.fill();

  ctx.save();
  roundRect(ctx, -screenW / 2, -screenH / 2, screenW, screenH, 33);
  ctx.clip();

  ctx.fillStyle = 'rgba(28, 25, 23, 0.18)';
  roundRect(ctx, -36, -screenH / 2 + 15, 72, 6, 3);
  ctx.fill();

  const left = -screenW / 2 + 26;
  const right = screenW / 2 - 26;

  ctx.fillStyle = '#1c1917';
  ctx.font = font(32, '400', SERIF);
  ctx.fillText('Savora', left, -screenH / 2 + 96);

  drawTracked(ctx, 'PANIER', right, -screenH / 2 + 90, {
    size: 12,
    tracking: 2.4,
    color: '#c2410c',
    align: 'right',
  });

  ctx.strokeStyle = 'rgba(28, 25, 23, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, -screenH / 2 + 118);
  ctx.lineTo(right, -screenH / 2 + 118);
  ctx.stroke();

  const rows = [
    ['Pizza', '1 500 XOF'],
    ['Limonade', '1 000 XOF'],
  ];
  rows.forEach(([label, price], index) => {
    const rowAlpha = fadeIn(t, 0.5, 0.85 + index * 0.2);
    const y = -screenH / 2 + 186 + index * 82;
    ctx.save();
    ctx.globalAlpha *= rowAlpha;
    ctx.fillStyle = '#57534e';
    ctx.font = font(19, '400', SANS);
    ctx.fillText(label, left, y);
    ctx.fillStyle = '#1c1917';
    ctx.font = font(19, '600', SANS_SEMI);
    ctx.textAlign = 'right';
    ctx.fillText(price, right, y);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(28, 25, 23, 0.07)';
    ctx.beginPath();
    ctx.moveTo(left, y + 30);
    ctx.lineTo(right, y + 24);
    ctx.stroke();
    ctx.restore();
  });

  const totalY = -screenH / 2 + 386;
  ctx.save();
  ctx.globalAlpha *= fadeIn(t, 0.6, 1.15);
  ctx.fillStyle = '#78716c';
  ctx.font = font(17, '400', SANS);
  ctx.fillText('Total', left, totalY);
  ctx.fillStyle = '#1c1917';
  ctx.font = font(24, '600', SANS_SEMI);
  ctx.textAlign = 'right';
  ctx.fillText('2 500 XOF', right, totalY);
  ctx.textAlign = 'left';
  ctx.restore();

  // bouton
  ctx.save();
  ctx.globalAlpha *= fadeIn(t, 0.6, 1.4);
  const ctaY = -screenH / 2 + 430;
  const tap = 1 - 0.03 * Math.max(0, Math.sin((t - 1.9) * 2.2)) ** 12;
  ctx.translate(0, ctaY + 26);
  ctx.scale(tap, tap);
  roundRect(ctx, -screenW / 2 + 24, -26, screenW - 48, 52, 12);
  ctx.fillStyle = '#c2410c';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = font(19, '700', SANS_BOLD);
  ctx.textAlign = 'center';
  ctx.fillText('Commander  →', 0, 7);
  ctx.textAlign = 'left';
  ctx.restore();

  // toast WhatsApp
  const toastProgress = easeOut(clamp((t - 2.45) / 0.6));
  if (toastProgress > 0) {
    ctx.save();
    ctx.globalAlpha *= toastProgress;
    const toastY = -screenH / 2 + 500 + (1 - toastProgress) * 26;
    roundRect(ctx, -screenW / 2 + 24, toastY, screenW - 48, 52, 11);
    ctx.fillStyle = '#ecfdf5';
    ctx.fill();
    ctx.strokeStyle = '#a7f3d0';
    ctx.stroke();

    // pastille de confirmation dessinée (évite les glyphes manquants)
    const checkX = -screenW / 2 + 48;
    const checkY = toastY + 26;
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(checkX, checkY, 10, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(checkX - 4.5, checkY);
    ctx.lineTo(checkX - 1, checkY + 4);
    ctx.lineTo(checkX + 5, checkY - 4);
    ctx.stroke();

    ctx.fillStyle = '#047857';
    ctx.font = font(15, '600', SANS_SEMI);
    ctx.textAlign = 'left';
    ctx.fillText('Commande confirmée', checkX + 18, toastY + 32);
    ctx.restore();
  }

  ctx.restore();
  ctx.restore();
}

function sceneCommande(ctx, t, duration) {
  const alpha = 1; // les transitions sont gérées par le fondu enchaîné global
  drawEmbers(ctx, t + 33, 0.4);
  drawPhone(ctx, t, alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  const x = 160;
  drawKicker(ctx, '04 — COMMANDER', x, 318, fadeIn(t, 0.6, 0.25));
  drawTitle(ctx, STORY[3], t, x, 448, { size: 92, lineHeight: 102 });
  drawParagraph(ctx, STORY[3].lead, x, 654, { maxWidth: 680, alpha: fadeIn(t, 0.8, 0.95) });

  const chips = ['SUR PLACE', 'À EMPORTER', 'LIVRAISON'];
  chips.forEach((chip, index) => {
    const chipAlpha = fadeIn(t, 0.5, 1.2 + index * 0.12);
    if (chipAlpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= chipAlpha;
    ctx.font = font(15, '600', SANS_BOLD);
    const chipWidth = measureTracked(ctx, chip, 2.6) + 40;
    const offsetX = chips.slice(0, index).reduce((total, item) => {
      ctx.font = font(15, '600', SANS_BOLD);
      return total + measureTracked(ctx, item, 2.6) + 40 + 12;
    }, x);
    const live = index === 2;
    roundRect(ctx, offsetX, 754, chipWidth, 42, 21);
    ctx.fillStyle = live ? 'rgba(194, 65, 12, 0.18)' : 'rgba(246, 239, 228, 0.03)';
    ctx.fill();
    ctx.strokeStyle = live ? 'rgba(255, 106, 43, 0.55)' : 'rgba(246, 239, 228, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    drawTracked(ctx, chip, offsetX + 20, 780, {
      size: 15,
      tracking: 2.6,
      color: live ? '#ffd2b8' : '#d9cfc1',
    });
    ctx.restore();
  });

  ctx.restore();
}

function sceneGestion(ctx, t, duration) {
  const alpha = 1; // les transitions sont gérées par le fondu enchaîné global
  drawEmbers(ctx, t + 45, 0.35);

  const appear = easeOut(clamp((t - 0.2) / 1));
  const cx = 1420;
  const cy = 528;
  const width = 560;
  const height = 516;

  ctx.save();
  ctx.globalAlpha = alpha * appear;
  ctx.translate(cx, cy + (1 - appear) * 40);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 70;
  ctx.shadowOffsetY = 28;
  roundRect(ctx, -width / 2, -height / 2, width, height, 24);
  const panel = ctx.createLinearGradient(0, -height / 2, 0, height / 2);
  panel.addColorStop(0, '#241d17');
  panel.addColorStop(1, '#100d0b');
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, -width / 2, -height / 2, width, height, 24);
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.14)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const left = -width / 2 + 30;
  const right = width / 2 - 30;

  drawTracked(ctx, 'TABLEAU DE BORD', left, -height / 2 + 52, {
    size: 15,
    tracking: 3.4,
    color: INK,
  });
  drawTracked(ctx, 'SERVICE DU SOIR', right, -height / 2 + 52, {
    size: 12,
    tracking: 2.6,
    color: MUTED,
    align: 'right',
  });

  const rows = [
    ['Commande · sur place', 'En cuisine', 'EN PRÉPARATION', '#f0b45b', 'rgba(240, 180, 91, 0.14)', 'rgba(240, 180, 91, 0.3)'],
    ['Commande · à emporter', 'Prête au comptoir', 'PRÊTE', '#6ee7b7', 'rgba(52, 211, 153, 0.13)', 'rgba(52, 211, 153, 0.28)'],
    ['Commande · livraison', 'Remise au livreur', 'LIVRÉE', '#cbd5e1', 'rgba(148, 163, 184, 0.12)', 'rgba(148, 163, 184, 0.24)'],
  ];

  rows.forEach(([label, sub, status, color, fill, stroke], index) => {
    const rowAlpha = fadeIn(t, 0.6, 0.75 + index * 0.16);
    const rowY = -height / 2 + 92 + index * 82;
    ctx.save();
    ctx.globalAlpha *= rowAlpha;
    ctx.translate((1 - rowAlpha) * -18, 0);

    roundRect(ctx, left, rowY, right - left, 68, 12);
    ctx.fillStyle = 'rgba(246, 239, 228, 0.045)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(246, 239, 228, 0.07)';
    ctx.stroke();

    ctx.fillStyle = '#d9cfc1';
    ctx.font = font(18, '400', SANS);
    ctx.fillText(label, left + 18, rowY + 30);
    ctx.fillStyle = '#8b8175';
    ctx.font = font(13, '400', SANS);
    ctx.fillText(sub, left + 18, rowY + 52);

    ctx.font = font(12, '600', SANS_BOLD);
    const badgeWidth = measureTracked(ctx, status, 1.6) + 24;
    roundRect(ctx, right - badgeWidth - 16, rowY + 19, badgeWidth, 30, 15);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    drawTracked(ctx, status, right - badgeWidth - 16 + 12, rowY + 39, {
      size: 12,
      tracking: 1.6,
      color,
    });

    ctx.restore();
  });

  // graphique
  const chartY = -height / 2 + 342;
  const chartH = 112;
  roundRect(ctx, left, chartY, right - left, chartH, 12);
  ctx.fillStyle = 'rgba(246, 239, 228, 0.035)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.06)';
  ctx.stroke();

  drawTracked(ctx, 'RYTHME DU SERVICE', left + 16, chartY + 28, {
    size: 11,
    tracking: 2.4,
    color: '#8b8175',
  });

  const bars = [0.38, 0.52, 0.46, 0.68, 0.58, 0.84, 0.72];
  const barSpace = (right - left - 34) / bars.length;
  bars.forEach((value, index) => {
    const grow = easeOut(clamp((t - 1.05 - index * 0.07) / 0.6));
    if (grow <= 0) return;
    const barW = barSpace * 0.5;
    const barH = (chartH - 48) * value * grow;
    const x = left + 17 + index * barSpace;
    const barGradient = ctx.createLinearGradient(0, chartY + chartH - 10 - barH, 0, chartY + chartH - 10);
    barGradient.addColorStop(0, '#ff8a4c');
    barGradient.addColorStop(1, '#b93f0e');
    ctx.fillStyle = barGradient;
    roundRect(ctx, x, chartY + chartH - 10 - barH, barW, barH, 3);
    ctx.fill();
  });

  // pied
  ctx.fillStyle = '#c6bcae';
  ctx.font = font(15, '400', SANS);
  ctx.fillText('Carte du jour publiée', left, height / 2 - 32);

  roundRect(ctx, right - 52, height / 2 - 44, 52, 26, 13);
  ctx.fillStyle = EMBER;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(right - 17, height / 2 - 31, 9, 0, TAU);
  ctx.fill();

  ctx.restore();

  // texte
  ctx.save();
  ctx.globalAlpha = alpha;
  const x = 160;
  drawKicker(ctx, '05 — GESTION', x, 318, fadeIn(t, 0.6, 0.25));
  drawTitle(ctx, STORY[4], t, x, 448, { size: 92, lineHeight: 102 });
  drawParagraph(ctx, STORY[4].lead, x, 654, { maxWidth: 660, alpha: fadeIn(t, 0.8, 0.95) });
  drawNote(ctx, STORY[4].note, x, 760, fadeIn(t, 0.8, 1.3));
  ctx.restore();
}

function sceneSignature(ctx, t) {
  const alpha = 1;
  drawEmbers(ctx, t + 57, 0.8);

  ctx.save();
  ctx.globalAlpha = alpha;
  const appear = easeOut(clamp((t - 0.15) / 0.9));

  // logo sur tuile crème (le fichier est prévu pour fond clair)
  ctx.save();
  ctx.globalAlpha *= appear;
  ctx.translate(W / 2, 248);
  ctx.scale(lerp(0.86, 1, appear), lerp(0.86, 1, appear));
  ctx.shadowColor = 'rgba(255, 106, 43, 0.3)';
  ctx.shadowBlur = 55;
  roundRect(ctx, -64, -64, 128, 128, 26);
  ctx.fillStyle = '#fdfaf5';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  roundRect(ctx, -64, -64, 128, 128, 26);
  ctx.clip();
  ctx.drawImage(logoImage, -64, -64, 128, 128);
  ctx.restore();
  ctx.restore();

  drawKicker(ctx, 'SIGNATURE', W / 2, 392, fadeIn(t, 0.6, 0.45), 'center');

  const gradient = ctx.createLinearGradient(0, 380, 0, 600);
  gradient.addColorStop(0, '#fdf6ea');
  gradient.addColorStop(1, '#e8c365');
  STORY[5].title.forEach((line, index) => {
    drawRevealLine(ctx, line, W / 2, 500 + index * 88, {
      size: 82,
      progress: easeOut(clamp((t - 0.45 - index * 0.12) / 0.85)),
      gradient,
      align: 'center',
    });
  });

  drawTracked(ctx, 'BOULEVARD DU 13 JANVIER · LOMÉ', W / 2, 692, {
    size: 16,
    tracking: 5,
    color: MUTED,
    alpha: fadeIn(t, 0.7, 1.2),
    align: 'center',
  });

  // bouton
  const buttonAlpha = fadeIn(t, 0.7, 1.35);
  if (buttonAlpha > 0) {
    ctx.save();
    ctx.globalAlpha *= buttonAlpha;
    ctx.font = font(18, '700', SANS_BOLD);
    const label = 'COMMANDER EN LIGNE';
    const width = measureTracked(ctx, label, 2.4) + 76;
    roundRect(ctx, W / 2 - width / 2, 742, width, 56, 12);
    ctx.fillStyle = EMBER;
    ctx.fill();
    drawTracked(ctx, label, W / 2, 777, {
      size: 18,
      tracking: 2.4,
      color: '#1a0e07',
      align: 'center',
    });
    ctx.restore();
  }

  drawTracked(ctx, '+228 70 30 97 44  ·  CONTACT@SAVORA.RESTAURANT', W / 2, 844, {
    size: 14,
    tracking: 3,
    color: '#8b8175',
    alpha: fadeIn(t, 0.7, 1.6),
    align: 'center',
  });

  ctx.restore();
}

const SCENE_RENDERERS = {
  ouverture: sceneOuverture,
  feu: sceneFeu,
  carte: sceneCarte,
  commande: sceneCommande,
  gestion: sceneGestion,
  signature: sceneSignature,
};

function findScene(time) {
  let found = SCENES[SCENES.length - 1];
  for (const scene of SCENES) {
    if (time < scene.start + scene.scene) {
      found = scene;
      break;
    }
  }
  return found;
}

const CROSSFADE = 0.38;

// Rendu complet d'une scène (fond + contenu + flare d'entrée) sur un contexte donné.
function drawSceneFrame(target, scene, local, frame) {
  target.save();
  drawBackdrop(target, scene.id, local);
  SCENE_RENDERERS[scene.id](target, local, scene.scene);
  target.restore();
  drawFlare(target, clamp(local / 0.5));
}

const sceneBuffer = createCanvas(W, H);
const sceneBufferCtx = sceneBuffer.getContext('2d');

function renderFrame(ctx, time, frame) {
  const scene = findScene(time);
  const index = SCENES.indexOf(scene);
  const local = time - scene.start;

  if (index > 0 && local < CROSSFADE) {
    // Fondu enchaîné : la scène précédente reste affichée en plein, la nouvelle apparaît par-dessus.
    const previous = SCENES[index - 1];
    drawSceneFrame(sceneBufferCtx, previous, time - previous.start, frame);
    ctx.drawImage(sceneBuffer, 0, 0);

    ctx.save();
    ctx.globalAlpha = easeInOut(clamp(local / CROSSFADE));
    drawSceneFrame(ctx, scene, local, frame);
    ctx.restore();
  } else {
    drawSceneFrame(ctx, scene, local, frame);
  }

  // ouverture depuis le noir
  if (time < 0.7) {
    ctx.fillStyle = `rgba(7, 6, 5, ${1 - clamp(time / 0.7)})`;
    ctx.fillRect(0, 0, W, H);
  }

  drawCaption(ctx, STORY[index].caption, time, scene);
  drawGrain(ctx, frame);

  // fondu de fin
  if (time > TOTAL - 0.9) {
    ctx.fillStyle = `rgba(7, 6, 5, ${clamp((time - (TOTAL - 0.9)) / 0.9)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/* ---------------------------------------------------------------- audio */

function readWav(path) {
  const buffer = readFileSync(path);
  let offset = 12;
  let sampleRate = 44100;
  let channels = 1;
  let dataStart = 0;
  let dataLength = 0;

  while (offset < buffer.length - 8) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readInt32LE(offset + 4);
    if (id === 'fmt ') {
      sampleRate = buffer.readUInt32LE(offset + 12);
      channels = buffer.readUInt16LE(offset + 10);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  const frames = Math.floor(dataLength / 2 / channels);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += buffer.readInt16LE(dataStart + (i * channels + c) * 2) / 32768;
    }
    samples[i] = sum / channels;
  }
  return { sampleRate, samples };
}

function writeWav(path, samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

function buildMix() {
  const sampleRate = 44100;
  const totalSamples = Math.ceil((TOTAL + 0.4) * sampleRate);
  const mix = new Float32Array(totalSamples);

  for (const scene of SCENES) {
    const { samples } = readWav(join(ROOT, 'motion', 'audio', `voix-${scene.id}.wav`));
    const start = Math.round(scene.start * sampleRate);
    for (let i = 0; i < samples.length && start + i < totalSamples; i += 1) {
      mix[start + i] += samples[i];
    }
  }

  const { samples: bed } = readWav(join(ROOT, 'motion', 'audio', 'nappe.wav'));
  const bedGain = 0.4;
  const fadeInSamples = Math.round(2 * sampleRate);
  const fadeOutSamples = Math.round(3 * sampleRate);
  for (let i = 0; i < totalSamples; i += 1) {
    const bedValue = bed[i % bed.length];
    const fadeIn = clamp(i / fadeInSamples);
    const fadeOut = clamp((totalSamples - i) / fadeOutSamples);
    mix[i] += bedValue * bedGain * Math.min(fadeIn, fadeOut);
  }

  let peak = 0;
  for (let i = 0; i < totalSamples; i += 1) peak = Math.max(peak, Math.abs(mix[i]));
  const scale = peak > 0 ? 0.94 / peak : 1;
  for (let i = 0; i < totalSamples; i += 1) mix[i] *= scale;

  const path = join(ROOT, 'motion', 'audio', 'mix-final.wav');
  writeWav(path, mix, sampleRate);
  console.log(`Mixage : ${path} (pic ${(20 * Math.log10(scale * peak)).toFixed(1)} dBFS)`);
  return path;
}

/* --------------------------------------------------------------- render */

const stillArg = readArg('--still');
const outPath = join(ROOT, 'motion', readArg('--out') || 'savora-film.mp4');

if (stillArg) {
  const qaDir = join(ROOT, 'motion', 'qa');
  mkdirSync(qaDir, { recursive: true });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (const value of stillArg.split(',')) {
    const time = Number(value);
    renderFrame(ctx, time, Math.round(time * FPS));
    const file = join(qaDir, `still-${String(time).replace('.', '_')}.png`);
    writeFileSync(file, canvas.toBuffer('image/png'));
    console.log(`Image : motion/qa/still-${String(time).replace('.', '_')}.png`);
  }
  process.exit(0);
}

const mixPath = buildMix();
const frames = Math.round(TOTAL * FPS);

console.log(`Rendu : ${W}x${H} · ${FPS} i/s · ${frames} images · ${TOTAL.toFixed(2)}s`);

const ffmpeg = spawn(
  FFMPEG,
  [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${W}x${H}`,
    '-r', String(FPS),
    '-i', '-',
    '-i', mixPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-level', '4.2',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outPath,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);

ffmpeg.on('error', (error) => {
  console.error('ffmpeg introuvable. Installez-le ou définissez FFMPEG_PATH.', error.message);
  process.exit(1);
});

ffmpeg.on('close', (code) => {
  if (code === 0) {
    console.log(`\nFilm prêt : ${outPath}`);
  } else {
    console.error(`ffmpeg a échoué (code ${code}).`);
    process.exitCode = 1;
  }
});

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const startedAt = Date.now();

for (let frame = 0; frame < frames; frame += 1) {
  const time = frame / FPS;
  renderFrame(ctx, time, frame);
  const pixels = ctx.getImageData(0, 0, W, H).data;

  if (!ffmpeg.stdin.write(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))) {
    await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
  }

  if (frame % 60 === 0) {
    const elapsed = (Date.now() - startedAt) / 1000;
    const speed = frame > 0 ? (frame / elapsed).toFixed(1) : '—';
    console.log(`  ${frame}/${frames} images · ${speed} i/s · ${elapsed.toFixed(0)}s`);
  }
}

ffmpeg.stdin.end();
await new Promise((resolve) => ffmpeg.on('close', resolve));
