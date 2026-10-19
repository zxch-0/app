'use strict';

/**
 * Genere l'icone de l'application, sans aucune dependance externe.
 *
 * Produit :
 *   build/icon.png  (256x256)  -> utilise par electron-builder pour Windows
 *   build/icon.ico  (multi-tailles) -> icone Windows complete
 *
 * Encodeur PNG maison (zlib natif + CRC32) et assembleur ICO maison.
 * Necessaire car electron-builder echoue en LGHT0094 sur la cible MSI
 * quand aucune icone applicative n'est definie.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');
const PNG_PATH = path.join(OUT_DIR, 'icon.png');
const ICO_PATH = path.join(OUT_DIR, 'icon.ico');

const PNG_SIZE = 256;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS_SMALL = 4;
const SS_LARGE = 3;

/* ------------------------------------------------------------------ */
/* Encodeur PNG                                                        */
/* ------------------------------------------------------------------ */

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}

function crc32(buffer) {
  const table = crcTable();
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    c = table[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ */
/* Rendu de l'icone                                                    */
/* ------------------------------------------------------------------ */

const CONIC = [
  [0.345, 0.396, 0.949],
  [0.545, 0.361, 0.965],
  [1.0, 0.812, 0.361]
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function conicColor(u) {
  const count = CONIC.length;
  const position = u * count;
  const index = Math.floor(position) % count;
  const next = (index + 1) % count;
  const t = position - Math.floor(position);
  const a = CONIC[index];
  const b = CONIC[next];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function shadeAt(x, y) {
  const radius = 0.44;
  const dx = Math.max(Math.abs(x) - (1 - radius), 0);
  const dy = Math.max(Math.abs(y) - (1 - radius), 0);
  const corner = Math.sqrt(dx * dx + dy * dy);
  if (corner > radius) return [0, 0, 0, 0];

  const t = clamp((x + y + 2) / 4, 0, 1);
  let r = lerp(0.035, 0.098, t);
  let g = lerp(0.035, 0.094, t);
  let b = lerp(0.086, 0.212, t);

  const haloDistance = Math.sqrt(x * x + (y - 0.02) * (y - 0.02));
  const halo = clamp(1 - haloDistance / 1.15, 0, 1);
  const haloFalloff = halo * halo;
  r += 0.1 * haloFalloff;
  g += 0.11 * haloFalloff;
  b += 0.3 * haloFalloff;

  const ox = x;
  const oy = y - 0.02;
  const orbDistance = Math.sqrt(ox * ox + oy * oy);
  const orbRadius = 0.55;

  if (orbDistance <= orbRadius) {
    const nx = ox / orbRadius;
    const ny = oy / orbRadius;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));

    const angle = (Math.atan2(ny, nx) + Math.PI) / (2 * Math.PI);
    const base = conicColor(angle);

    const lightX = -0.48;
    const lightY = -0.56;
    const lightZ = 0.675;
    const diffuse = Math.max(0, nx * lightX + ny * lightY + nz * lightZ);

    const halfX = -0.28;
    const halfY = -0.34;
    const halfZ = 0.9;
    const specular = Math.pow(Math.max(0, nx * halfX + ny * halfY + nz * halfZ), 26);

    const fresnel = Math.pow(1 - nz, 3.2);

    const intensity = 0.42 + 0.9 * diffuse;
    r = base[0] * intensity + specular * 0.95 + fresnel * 0.35;
    g = base[1] * intensity + specular * 0.95 + fresnel * 0.22;
    b = base[2] * intensity + specular * 0.95 + fresnel * 0.85;

    const rim = clamp((orbDistance - orbRadius * 0.86) / (orbRadius * 0.14), 0, 1);
    const rimFactor = 1 - 0.25 * rim;
    r *= rimFactor;
    g *= rimFactor;
    b *= rimFactor;
  }

  const ringInner = orbRadius * 1.16;
  const ringOuter = orbRadius * 1.23;
  if (orbDistance >= ringInner && orbDistance <= ringOuter) {
    r = lerp(r, 0.6, 0.5);
    g = lerp(g, 0.45, 0.5);
    b = lerp(b, 0.98, 0.5);
  }

  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1), 1];
}

function render(size, supersample) {
  const width = size * supersample;
  const inverse = 1 / width;
  const output = Buffer.alloc(size * size * 4);
  const samples = supersample * supersample;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const x = (px * supersample + sx + 0.5) * inverse * 2 - 1;
          const y = (py * supersample + sy + 0.5) * inverse * 2 - 1;
          const color = shadeAt(x, y);
          accR += color[0] * color[3];
          accG += color[1] * color[3];
          accB += color[2] * color[3];
          accA += color[3];
        }
      }

      const index = (py * size + px) * 4;
      if (accA > 0) {
        output[index] = Math.round(clamp(accR / accA, 0, 1) * 255);
        output[index + 1] = Math.round(clamp(accG / accA, 0, 1) * 255);
        output[index + 2] = Math.round(clamp(accB / accA, 0, 1) * 255);
      }
      output[index + 3] = Math.round(clamp(accA / samples, 0, 1) * 255);
    }
  }

  return output;
}

/* ------------------------------------------------------------------ */
/* Assembleur ICO                                                      */
/* ------------------------------------------------------------------ */

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directories = [];

  for (const entry of entries) {
    const directory = Buffer.alloc(16);
    directory[0] = entry.size >= 256 ? 0 : entry.size;
    directory[1] = entry.size >= 256 ? 0 : entry.size;
    directory[2] = 0;
    directory[3] = 0;
    directory.writeUInt16LE(1, 4);
    directory.writeUInt16LE(32, 6);
    directory.writeUInt32LE(entry.png.length, 8);
    directory.writeUInt32LE(offset, 12);
    offset += entry.png.length;
    directories.push(directory);
  }

  return Buffer.concat([header, ...directories, ...entries.map((entry) => entry.png)]);
}

/* ------------------------------------------------------------------ */
/* Point d'entree                                                      */
/* ------------------------------------------------------------------ */

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const png = encodePng(PNG_SIZE, render(PNG_SIZE, SS_LARGE));
  fs.writeFileSync(PNG_PATH, png);
  console.log('[make-icon] ' + path.relative(ROOT, PNG_PATH) + ' (' + PNG_SIZE + 'x' + PNG_SIZE + ')');

  const entries = ICO_SIZES.map((size) => ({
    size,
    png: encodePng(size, render(size, size <= 64 ? SS_SMALL : SS_LARGE))
  }));
  fs.writeFileSync(ICO_PATH, buildIco(entries));
  console.log('[make-icon] ' + path.relative(ROOT, ICO_PATH) + ' (' + ICO_SIZES.join(', ') + ')');
}

main();
