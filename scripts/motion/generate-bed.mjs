// Nappe sonore du motion design Savora (boucle parfaite de 30 s).
// Synthèse additive douce : ré mineur add9, souffle chaud, aucune dépendance.
// Usage : node scripts/motion/generate-bed.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const DURATION = 30; // secondes — toutes les fréquences sont des multiples de 1/30 Hz
const TAU = Math.PI * 2;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'motion', 'audio');
mkdirSync(outDir, { recursive: true });

const total = SAMPLE_RATE * DURATION;
const buffer = new Float32Array(total);

const partials = [
  { hz: 2202 / 30, gain: 0.3, lfo: 30, phase: 0 },
  { hz: 3300 / 30, gain: 0.2, lfo: 15, phase: 1.1 },
  { hz: 4405 / 30, gain: 0.16, lfo: 10, phase: 2.3 },
  { hz: 5238 / 30, gain: 0.12, lfo: 7.5, phase: 0.6 },
  { hz: 4944 / 30, gain: 0.07, lfo: 6, phase: 3.4 },
  { hz: 6600 / 30, gain: 0.05, lfo: 5, phase: 2.0 },
  { hz: 17620 / 30, gain: 0.012, lfo: 3.75, phase: 1.6 },
];

for (const part of partials) {
  // Léger battement stéréo simulé par un second partiel désaccordé (période entière sur 30 s).
  const detune = 1 / DURATION;
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const modulation = 0.72 + 0.28 * Math.sin((TAU * t) / part.lfo + part.phase);
    const wave =
      Math.sin(TAU * part.hz * t) * 0.62 +
      Math.sin(TAU * (part.hz + detune) * t + 0.7) * 0.38;
    buffer[i] += wave * part.gain * modulation;
  }
}

// Souffle très doux (bruit filtré), rendu bouclable par fondu croisé des extrémités.
let previous = 0;
for (let i = 0; i < total; i += 1) {
  const noise = Math.random() * 2 - 1;
  previous = previous + (noise - previous) * 0.015; // passe-bas une pôle
  buffer[i] += previous * 0.05;
}

const crossfade = Math.floor(SAMPLE_RATE * 1.5);
for (let i = 0; i < crossfade; i += 1) {
  const ratio = i / crossfade;
  const tail = buffer[total - crossfade + i];
  buffer[i] = buffer[i] * ratio + tail * (1 - ratio);
}

// Normalisation douce
let peak = 0;
for (let i = 0; i < total; i += 1) peak = Math.max(peak, Math.abs(buffer[i]));
const scale = 0.62 / (peak || 1);

const data = Buffer.alloc(total * 2);
for (let i = 0; i < total; i += 1) {
  const value = Math.max(-1, Math.min(1, buffer[i] * scale));
  data.writeInt16LE(Math.round(value * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const file = join(outDir, 'nappe.wav');
writeFileSync(file, Buffer.concat([header, data]));
console.log(`Nappe écrite : ${file} (${DURATION}s, ${(data.length / 1024 / 1024).toFixed(2)} Mo)`);
