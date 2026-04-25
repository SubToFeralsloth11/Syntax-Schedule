const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function writeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuf, data]);
  const crc = crc32(combined);
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size) {
  const px = new Uint8Array(size * size * 4);
  const bg = [79, 70, 229]; // #4f46e5
  const white = [255, 255, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = bg[0];
      px[i+1] = bg[1];
      px[i+2] = bg[2];
      px[i+3] = 255;
    }
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;
  const r2 = r * r;

  // Draw clock circle outline (white ring)
  const ringThick = Math.max(2, size * 0.025);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d2 = dx*dx + dy*dy;
      const d = Math.sqrt(d2);
      if (d >= r - ringThick && d <= r + ringThick) {
        const i = (y * size + x) * 4;
        px[i] = white[0]; px[i+1] = white[1]; px[i+2] = white[2];
      }
    }
  }

  // Helper: draw thick line
  function drawLine(x1, y1, x2, y2, thick) {
    const len = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const lx = x1 + (x2 - x1) * t;
      const ly = y1 + (y2 - y1) * t;
      for (let dy = -thick; dy <= thick; dy++) {
        for (let dx = -thick; dx <= thick; dx++) {
          const pxX = Math.round(lx + dx);
          const pxY = Math.round(ly + dy);
          if (pxX >= 0 && pxX < size && pxY >= 0 && pxY < size) {
            const i = (pxY * size + pxX) * 4;
            px[i] = white[0]; px[i+1] = white[1]; px[i+2] = white[2];
          }
        }
      }
    }
  }

  // Hour hand (pointing up-left-ish, 10 o'clock)
  const hLen = size * 0.18;
  const hAngle = -Math.PI / 3; // 10 o'clock
  drawLine(cx, cy, cx + Math.cos(hAngle)*hLen, cy + Math.sin(hAngle)*hLen, Math.max(1, size*0.018));

  // Minute hand (pointing right, 3 o'clock)
  const mLen = size * 0.24;
  const mAngle = 0;
  drawLine(cx, cy, cx + Math.cos(mAngle)*mLen, cy + Math.sin(mAngle)*mLen, Math.max(1, size*0.014));

  // Center dot
  const dotR = Math.max(2, size * 0.025);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx*dx + dy*dy <= dotR*dotR) {
        const i = (y * size + x) * 4;
        px[i] = white[0]; px[i+1] = white[1]; px[i+2] = white[2];
      }
    }
  }

  // Build raw image rows with filter byte 0
  const rowSize = 1 + size * 4;
  const raw = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * rowSize + 1 + x * 4;
      raw[dst] = px[src];     // R
      raw[dst+1] = px[src+1]; // G
      raw[dst+2] = px[src+2]; // B
      raw[dst+3] = px[src+3]; // A
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace

  const ihdr = writeChunk('IHDR', ihdrData);
  const idat = writeChunk('IDAT', compressed);
  const iend = writeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

fs.writeFileSync('icon-192.png', makePNG(192));
fs.writeFileSync('icon-512.png', makePNG(512));
fs.writeFileSync('apple-touch-icon.png', makePNG(180));
console.log('Generated icon-192.png, icon-512.png, apple-touch-icon.png');
