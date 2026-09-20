/**
 * Store logo as a black-and-white bitmap for direct (ESC/POS) thermal printing.
 *
 * Thermal printers have no fonts for pictures: a logo has to be sent as dots. The POS server builds
 * the receipt, but it cannot decode a PNG, JPEG or WebP, so the page — which already has the logo on
 * screen — draws it to a canvas here and sends the dots with the print job.
 *
 * The result is the same size as on a browser receipt (up to 30 x 12 mm) at the printer's 203 dpi.
 */

const DOTS_PER_MM = 8; // 203 dpi
const MAX_WIDTH_MM = 30;
const MAX_HEIGHT_MM = 12;

// Printable dots across the roll, so a logo never asks for more than the head can print
const PAPER_DOTS = { 80: 576, 58: 384 };

// 4x4 ordered dither: photographs keep their shading, flat logos stay solid
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

let sameOriginLogo = null; // data URI from the POS server, fetched at most once per page load

/** A logo in cloud storage taints the canvas; the POS server hands back the same image as data. */
async function loadThroughServer() {
  if (sameOriginLogo !== null) return sameOriginLogo;
  try {
    const response = await fetch('/api/store/logo-data');
    const body = await response.json();
    sameOriginLogo = String(body?.dataUrl || '');
  } catch {
    sameOriginLogo = '';
  }
  return sameOriginLogo;
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The logo could not be loaded'));
    image.src = src;
  });

/**
 * { width, height, data } with `data` a base64 1-bit bitmap, row by row, 1 = black dot.
 * Returns null when there is no logo, it cannot be read (a cross-origin image taints the canvas),
 * or the browser has no canvas — the receipt then prints without it, as before.
 */
export async function buildReceiptLogoRaster(src, { paperWidth = 80 } = {}) {
  if (!src || typeof document === 'undefined') return null;
  const direct = await rasterise(src, paperWidth);
  if (direct) return direct;
  // Reading the pixels failed — most likely a logo held on another origin
  const viaServer = await loadThroughServer();
  return viaServer && viaServer !== src ? rasterise(viaServer, paperWidth) : null;
}

async function rasterise(src, paperWidth) {
  try {
    const image = await loadImage(src);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) return null;

    const maxWidth = Math.min(MAX_WIDTH_MM * DOTS_PER_MM, PAPER_DOTS[paperWidth] || PAPER_DOTS[80]);
    const maxHeight = MAX_HEIGHT_MM * DOTS_PER_MM;
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
    // Whole bytes across, so every row starts on a byte boundary as the printer expects
    const width = Math.max(8, Math.floor((naturalWidth * scale) / 8) * 8);
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const { data: pixels } = context.getImageData(0, 0, width, height);
    const bytesPerRow = width / 8;
    const bitmap = new Uint8Array(bytesPerRow * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = pixels[offset + 3] / 255;
        // Anything see-through counts as paper, not ink
        const luminance =
          255 - alpha * (255 - (0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]));
        const threshold = ((BAYER[y % 4][x % 4] + 0.5) / 16) * 255;
        if (luminance < threshold) bitmap[y * bytesPerRow + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }

    if (!bitmap.some((byte) => byte !== 0)) return null; // nothing but white

    let binary = '';
    for (const byte of bitmap) binary += String.fromCharCode(byte);
    return { width, height, data: btoa(binary) };
  } catch {
    return null; // no logo on this printout rather than no printout
  }
}
