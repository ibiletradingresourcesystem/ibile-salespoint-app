/**
 * ESC/POS Printer Utility
 * 
 * Generates ESC/POS commands for Xprinter XP-D200N and compatible thermal printers
 * Supports:
 * - Text formatting (bold, alignment, size)
 * - Barcode and QR code
 * - Images
 * - Line breaks and separators
 * - Cut commands
 */

// ESC/POS Command codes
const ESC = '\x1B';
const GS = '\x1D';
const LF = '\x0A';
const CR = '\x0D';

class ESCPOSPrinter {
  constructor() {
    this.buffer = [];
  }

  // Add raw command to buffer
  addCommand(command) {
    this.buffer.push(command);
    return this;
  }

  // Initialize printer
  init() {
    this.addCommand(ESC + '@');
    return this;
  }

  // Set text size (width x height multiplier: 1-8)
  setSize(width = 1, height = 1) {
    const sizeCode = (width & 0x0F) << 4 | (height & 0x0F);
    this.addCommand(GS + '!' + String.fromCharCode(sizeCode));
    return this;
  }

  // Set text alignment (0=left, 1=center, 2=right)
  setAlignment(alignment = 0) {
    this.addCommand(ESC + 'a' + String.fromCharCode(alignment));
    return this;
  }

  // Set bold on/off
  setBold(bold = true) {
    this.addCommand(ESC + 'E' + (bold ? '\x01' : '\x00'));
    return this;
  }

  // Add text
  text(str) {
    this.addCommand(str + LF);
    return this;
  }

  // Add line break
  newLine(count = 1) {
    for (let i = 0; i < count; i++) {
      this.addCommand(LF);
    }
    return this;
  }

  // Add separator line
  separator(char = '─', width = 32) {
    this.text(char.repeat(width));
    return this;
  }

  // Print barcode
  barcode(code, bcType = 'CODE128', height = 50, width = 2) {
    // GS k m [d1 d2 ... dn] NUL
    const typeCode = this.getBarcodeType(bcType);
    this.addCommand(GS + 'k' + String.fromCharCode(typeCode));
    this.addCommand(code + '\x00');
    return this;
  }

  // Print QR code
  qrcode(data, size = 3) {
    // GS ( k pL pH cn [d1 d2 ... dn]
    const encodedData = new TextEncoder().encode(data);
    const dataLength = encodedData.length + 3;
    const pL = dataLength & 0xFF;
    const pH = (dataLength >> 8) & 0xFF;

    this.addCommand(GS + '(k' + String.fromCharCode(pL, pH, 49, 80, 48));
    this.buffer.push(encodedData);

    // Set QR code size
    this.addCommand(GS + '(k' + String.fromCharCode(3, 0, 49, 67, size));

    // Print QR code
    this.addCommand(GS + '(k' + String.fromCharCode(3, 0, 49, 81, 48));

    return this;
  }

  // Get barcode type code
  getBarcodeType(bcType) {
    const types = {
      'UPCA': 0,
      'UPCE': 1,
      'EAN13': 2,
      'EAN8': 3,
      'CODE39': 4,
      'ITF': 5,
      'CODABAR': 6,
      'CODE128': 73,
    };
    return types[bcType] || 73; // Default to CODE128
  }

  // Partial cut
  partialCut() {
    this.addCommand(GS + 'V' + String.fromCharCode(1));
    return this;
  }

  // Full cut
  fullCut() {
    this.addCommand(GS + 'V' + String.fromCharCode(0));
    return this;
  }

  // Get buffer as string
  getBuffer() {
    return this.buffer.join('');
  }

  // Get buffer as Uint8Array (for binary transmission)
  getByteArray() {
    const str = this.getBuffer();
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i);
    }
    return bytes;
  }

  // Reset buffer
  reset() {
    this.buffer = [];
    return this;
  }
}

export default ESCPOSPrinter;
