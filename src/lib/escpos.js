/**
 * Minimal ESC/POS command builder for 58mm/80mm thermal receipt printers (Xprinter and compatible).
 * Everything is built as bytes; text is reduced to printable ASCII so no printer code page is needed.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Printer-safe text: ₦ → N, bullets → |, accents removed, anything else unprintable → ? */
export function toPrinterText(value) {
  return String(value ?? '')
    .replace(/₦/g, 'N')
    .replace(/[•·]/g, '|')
    .replace(/…/g, '...')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

export default class EscPosBuilder {
  constructor() {
    this.chunks = [];
  }

  bytes(...values) {
    this.chunks.push(Uint8Array.from(values));
    return this;
  }

  init() {
    return this.bytes(ESC, 0x40);
  }

  /** 0 = left, 1 = centre, 2 = right */
  align(position = 0) {
    return this.bytes(ESC, 0x61, position);
  }

  bold(on = true) {
    return this.bytes(ESC, 0x45, on ? 1 : 0);
  }

  /** Font A (12x24, default) or the smaller Font B (9x17) */
  font(small = false) {
    return this.bytes(ESC, 0x4d, small ? 1 : 0);
  }

  /** Character size multipliers 1-8 */
  size(width = 1, height = 1) {
    const w = Math.min(8, Math.max(1, width)) - 1;
    const h = Math.min(8, Math.max(1, height)) - 1;
    return this.bytes(GS, 0x21, (w << 4) | h);
  }

  text(line = '') {
    const text = toPrinterText(line);
    const bytes = new Uint8Array(text.length + 1);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
    bytes[text.length] = LF;
    this.chunks.push(bytes);
    return this;
  }

  feed(lines = 1) {
    return this.bytes(ESC, 0x64, Math.min(255, Math.max(0, lines)));
  }

  /**
   * Bitmap (GS v 0): `data` is a 1-bit image, row by row, 8 dots per byte, 1 = black dot.
   * `width` is in dots and must be a multiple of 8, as each row starts on a byte boundary.
   */
  raster({ width, height, data } = {}) {
    const bytesPerRow = Math.floor(Number(width) || 0) / 8;
    const rows = Math.floor(Number(height) || 0);
    if (!Number.isInteger(bytesPerRow) || bytesPerRow <= 0 || rows <= 0 || !data?.length) return this;
    this.bytes(GS, 0x76, 0x30, 0, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
    this.chunks.push(data instanceof Uint8Array ? data : Uint8Array.from(data));
    return this;
  }

  /** QR code (model 2) using GS ( k */
  qrCode(data, moduleSize = 4) {
    const payload = Uint8Array.from(toPrinterText(data), (char) => char.charCodeAt(0));
    const storeLength = payload.length + 3;
    this.bytes(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // model 2
    this.bytes(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.min(16, Math.max(1, moduleSize))); // module size
    this.bytes(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // error correction M
    this.bytes(GS, 0x28, 0x6b, storeLength & 0xff, (storeLength >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.chunks.push(payload);
    return this.bytes(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
  }

  /** Feed past the tear bar, leaving a little space below the text, and partially cut */
  cut() {
    return this.feed(5).bytes(GS, 0x56, 1);
  }

  toBytes() {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}
