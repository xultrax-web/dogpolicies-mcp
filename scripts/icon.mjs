#!/usr/bin/env node
// Writes assets/icon.png (256x256) with no dependencies: a rounded green
// square with a white paw print. Run once; the PNG is committed. Replace the
// file with designed artwork whenever one exists; the manifest only needs
// a PNG at that path.
//
//   node scripts/icon.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 256;
const BG = [0x1f, 0x5a, 0x3a]; // DogPolicies green
const FG = [0xff, 0xff, 0xff];

const inRoundedSquare = (x, y, r = 56) => {
  const cx = Math.min(Math.max(x, r), SIZE - 1 - r);
  const cy = Math.min(Math.max(y, r), SIZE - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inEllipse = (x, y, cx, cy, rx, ry) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
// A paw: four toes over a pad.
const PAW = [
  [128, 168, 44, 36], // pad
  [84, 112, 18, 24],
  [116, 92, 18, 24],
  [148, 92, 18, 24],
  [180, 112, 18, 24],
];

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const i = y * (SIZE * 4 + 1) + 1 + x * 4;
    if (!inRoundedSquare(x, y)) {
      raw[i + 3] = 0;
      continue;
    }
    const paw = PAW.some(([cx, cy, rx, ry]) => inEllipse(x, y, cx, cy, rx, ry));
    const [r, g, b] = paw ? FG : BG;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
    raw[i + 3] = 255;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "icon.png",
);
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
