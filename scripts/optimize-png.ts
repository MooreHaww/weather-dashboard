// PNG shrinker for the README screenshots (no dependencies): decodes an 8-bit,
// non-interlaced RGB/RGBA PNG, drops the alpha channel when it is fully opaque, optionally
// rounds each colour channel to fewer levels (the gradient backgrounds carry a lot of
// near-invisible noise), picks the best filter for every row and deflates at the maximum level.

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** `step`: round every colour channel to a multiple of this (1 = lossless, 2 or 3 are invisible on these screenshots). */
export function optimizePng(png: Buffer, step = 1): Buffer {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  for (let pos = 8; pos < png.length; ) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9]!;
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error('Unsupported PNG (need 8-bit RGB/RGBA, not interlaced)');
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      px[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
    }
  }

  // Drop an alpha channel that is fully opaque.
  let out = px;
  let outBpp = bpp;
  if (bpp === 4) {
    let opaque = true;
    for (let i = 3; i < px.length && opaque; i += 4) opaque = px[i] === 255;
    if (opaque) {
      out = Buffer.alloc(width * height * 3);
      for (let i = 0, j = 0; i < px.length; i += 4) {
        out[j++] = px[i]!;
        out[j++] = px[i + 1]!;
        out[j++] = px[i + 2]!;
      }
      outBpp = 3;
    }
  }

  if (step > 1) {
    for (let i = 0; i < out.length; i++) {
      if (outBpp === 4 && i % 4 === 3) continue; // keep alpha as it is
      out[i] = Math.min(255, Math.round(out[i]! / step) * step);
    }
  }

  // Filter each row five ways and keep the one whose bytes look smallest (min sum of absolute values).
  const rowStride = width * outBpp;
  const filtered = Buffer.alloc((rowStride + 1) * height);
  const candidate = Buffer.alloc(rowStride);
  for (let y = 0; y < height; y++) {
    let best = -1;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let x = 0; x < rowStride; x++) {
        const v = out[y * rowStride + x]!;
        const a = x >= outBpp ? out[y * rowStride + x - outBpp]! : 0;
        const b = y > 0 ? out[(y - 1) * rowStride + x]! : 0;
        const c = x >= outBpp && y > 0 ? out[(y - 1) * rowStride + x - outBpp]! : 0;
        const d = (v - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
        candidate[x] = d;
        score += d < 128 ? d : 256 - d;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
        candidate.copy(filtered, y * (rowStride + 1) + 1);
      }
    }
    filtered[y * (rowStride + 1)] = best;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = outBpp === 4 ? 6 : 2;
  const result = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return result.length < png.length ? result : png;
}
