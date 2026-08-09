import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const size = 256;

await writeFile(
  resolve(root, "plugins/google-workspace/assets/icon.png"),
  makePng(workspacePixel),
);
await writeFile(
  resolve(root, "plugins/gmail/assets/icon.png"),
  makePng(gmailPixel),
);

function workspacePixel(x, y) {
  const inset = x > 30 && x < 226 && y > 30 && y < 226;
  if (!inset) return [255, 255, 255, 0];
  if (x < 126 && y < 126) return [66, 133, 244, 255];
  if (x >= 130 && y < 126) return [52, 168, 83, 255];
  if (x < 126 && y >= 130) return [251, 188, 5, 255];
  if (x >= 130 && y >= 130) return [234, 67, 53, 255];
  return [255, 255, 255, 255];
}

function gmailPixel(x, y) {
  const inside = x >= 24 && x <= 232 && y >= 54 && y <= 206;
  if (!inside) return [255, 255, 255, 0];
  const border = x < 44 || x > 212 || y < 74 || y > 186;
  const diagonal = Math.abs(y - (66 + Math.abs(x - 128) * 0.72)) < 10;
  if (border || diagonal) return [234, 67, 53, 255];
  return [255, 255, 255, 255];
}

function makePng(pixel) {
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    scanlines[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const rgba = pixel(x, y);
      scanlines.set(rgba, row + 1 + x * 4);
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
