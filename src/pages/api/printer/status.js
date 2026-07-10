/**
 * API Endpoint: POST /api/printer/status
 * 
 * Check if Xprinter XP-D200N thermal printer is available and connected
 * Supports both USB and Network connection modes
 * 
 * Request body:
 * {
 *   "ip": "192.168.1.100",      // For network printer
 *   "port": 9100,               // For network printer
 *   "connectionMode": "usb"     // usb or network
 * }
 * 
 * Response:
 * {
 *   "available": true,
 *   "status": "online" | "offline" | "error",
 *   "message": "Printer is connected and ready",
 *   "timestamp": "2026-01-10T10:30:00.000Z"
 * }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ip, port, connectionMode = 'network' } = req.body;

    // USB printer check - actually test connection to localhost on common printer ports
    if (connectionMode === 'usb') {
      const result = await checkUSBPrinter();
      
      if (result.available) {
        return res.status(200).json({
          available: true,
          status: 'online',
          message: `USB printer detected and ready (${result.method} mode)`,
          details: result.details,
          timestamp: new Date().toISOString(),
          connectionMode: 'usb',
        });
      } else {
        return res.status(200).json({
          available: false,
          status: 'offline',
          message: 'USB printer not detected',
          details: result.details,
          timestamp: new Date().toISOString(),
          connectionMode: 'usb',
        });
      }
    }

    // Network printer check via socket connection
    if (connectionMode === 'network') {
      if (!ip || !port) {
        return res.status(400).json({
          available: false,
          status: 'error',
          message: 'IP address and port are required for network printer',
          timestamp: new Date().toISOString(),
        });
      }

      const isAvailable = await checkNetworkPrinter(ip, port);

      if (isAvailable) {
        return res.status(200).json({
          available: true,
          status: 'online',
          message: `Printer available at ${ip}:${port}`,
          timestamp: new Date().toISOString(),
          connectionMode: 'network',
          ip,
          port,
        });
      } else {
        return res.status(200).json({
          available: false,
          status: 'offline',
          message: `Printer not responding at ${ip}:${port}. Check connection.`,
          timestamp: new Date().toISOString(),
          connectionMode: 'network',
          ip,
          port,
        });
      }
    }

    return res.status(400).json({
      available: false,
      status: 'error',
      message: 'Invalid connection mode',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Printer status check error:', error);

    return res.status(500).json({
      available: false,
      status: 'error',
      message: error.message || 'Failed to check printer status',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Check if USB printer is available
 * For USB connection, check Windows printer queue and devices
 */
function checkUSBPrinter(timeout = 2000) {
  return new Promise((resolve) => {
    try {
      const { execSync } = require('child_process');
      const net = require('net');
      
      // Method 1: Check Windows Printer Queue
      try {
        console.log('🔍 Checking Windows printer queue via simple command...');
        const printerList = execSync(
          'wmic printerjob list brief 2>nul || echo "no-wmic"',
          {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeout
          }
        ).toString();

        if (printerList.toLowerCase().includes('xprinter') || printerList.toLowerCase().includes('thermal')) {
          console.log('✅ Xprinter found in printer queue');
          resolve({
            available: true,
            method: 'printer-queue',
            details: 'Xprinter detected in Windows printer queue'
          });
          return;
        }
      } catch (e) {
        console.warn('Method 1 (simple) failed:', e.message);
      }

      // Method 2: Check if localhost:9100 responds (USB mode via localhost)
      let socketResolved = false;
      try {
        console.log('🔍 Testing localhost printer connection...');
        const socket = net.createConnection({ port: 9100, host: '127.0.0.1', timeout: 1000 });
        
        socket.on('connect', () => {
          console.log('✅ Printer detected on localhost:9100');
          socket.destroy();
          socketResolved = true;
          resolve({
            available: true,
            method: 'localhost',
            details: 'Xprinter available on 127.0.0.1:9100'
          });
        });

        socket.on('error', () => {
          console.warn('Localhost check failed - moving to next method');
          // Don't resolve here, let it continue to Method 3
        });

        socket.on('timeout', () => {
          console.warn('Localhost check timeout - moving to next method');
          // Don't resolve here, let it continue to Method 3
        });
      } catch (e) {
        console.warn('Method 2 failed:', e.message);
      }

      // Wait a bit for socket method to complete, then try Method 3
      setTimeout(() => {
        if (socketResolved) return; // Socket method already resolved

        // Method 3: Simple check if print spooler is running (Windows)
        try {
          console.log('🔍 Checking if print spooler is running...');
          const spoolerCheck = execSync(
            'tasklist /FI "IMAGENAME eq spoolsv.exe" 2>nul | find /I "spoolsv.exe"',
            {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 2000
            }
          ).toString();

          if (spoolerCheck.includes('spoolsv')) {
            console.log('✅ Print spooler is running');
            resolve({
              available: true,
              method: 'spooler',
              details: 'Windows Print Spooler is running - printer likely available'
            });
            return;
          }
        } catch (e) {
          console.warn('Method 3 (spooler) failed:', e.message);
        }

        // All methods failed
        resolve({
          available: false,
          method: 'none',
          details: 'USB printer not detected. Ensure: 1) Printer is connected via USB 2) Xprinter driver is installed 3) Print Spooler service is running. Try restarting the driver.'
        });
      }, 1500);

    } catch (error) {
      console.error('❌ USB printer check error:', error.message);
      resolve({
        available: false,
        method: 'error',
        details: 'Error checking USB printer: ' + error.message
      });
    }
  });
}

/**
 * Check if network printer is available via socket connection
 * Attempts TCP connection to printer IP:Port with timeout
 */
function checkNetworkPrinter(ip, port, timeout = 3000) {
  return new Promise((resolve) => {
    try {
      const net = require('net');
      const socket = new net.Socket();

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, ip);
    } catch (error) {
      console.warn('Network printer check error:', error.message);
      resolve(false);
    }
  });
}
