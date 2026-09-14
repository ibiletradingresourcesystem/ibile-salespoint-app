/**
 * Server-only: network thermal printers (raw TCP, usually port 9100).
 */
import net from 'net';

// Receipt printers live on the shop's local network; only private IPv4 addresses are accepted
export function isLocalNetworkAddress(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isValidPort(port) {
  const value = Number(port);
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function connect(ip, port, timeout, onConnect) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeout, () => fail(new Error(`No response from ${ip}:${port}`)));
    socket.once('error', (error) => fail(new Error(`${ip}:${port} — ${error.code || error.message}`)));
    socket.connect(Number(port), ip, () => onConnect(socket, resolve, fail));
  });
}

export function checkNetworkPrinter(ip, port, timeout = 3000) {
  return connect(ip, port, timeout, (socket, resolve) => {
    socket.end();
    resolve(true);
  });
}

/** Write the bytes and wait until the printer has received them. */
export function sendToNetworkPrinter(ip, port, bytes, timeout = 5000) {
  return connect(ip, port, timeout, (socket, resolve, fail) => {
    socket.end(Buffer.from(bytes), () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', fail);
  });
}
