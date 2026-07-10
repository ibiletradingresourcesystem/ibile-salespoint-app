/**
 * Printer Configuration Utility
 * 
 * Manages printer settings including connection mode, IP, port, and print method
 */

// Get printer settings from localStorage
export function getPrinterSettings() {
  try {
    const settings = localStorage.getItem('printerSettings');
    return settings ? JSON.parse(settings) : getDefaultPrinterSettings();
  } catch (error) {
    console.warn('Failed to load printer settings:', error);
    return getDefaultPrinterSettings();
  }
}

// Set printer settings
export function setPrinterSettings(settings) {
  try {
    localStorage.setItem('printerSettings', JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Failed to save printer settings:', error);
    return false;
  }
}

// Default printer settings
export function getDefaultPrinterSettings() {
  return {
    enabled: true,
    type: 'xprinter', // xprinter, generic, network
    connectionMode: 'usb', // usb, network
    model: 'XP-D200N',
    ip: '192.168.1.100',
    port: 9100,
    printMethod: 'both', // browser, direct, both
    autoPrint: false, // Auto print without dialog
    paperWidth: 58, // mm
    paperSize: 'receipt', // receipt, label, custom
  };
}

// Test printer connection
export async function testPrinterConnection(settings) {
  if (!settings.ip || !settings.port) {
    return {
      success: false,
      message: 'Printer IP and port required',
    };
  }

  try {
    const response = await fetch('/api/printer/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: settings.ip,
        port: settings.port,
        connectionMode: settings.connectionMode || 'network',
      }),
    });

    const data = await response.json();
    return {
      success: data.available === true,
      message: data.message || (data.available ? 'Printer reachable' : 'Printer unavailable'),
      ...data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
}

// Send direct print command
export async function sendDirectPrint(transaction, receiptSettings, printerSettings) {
  try {
    const response = await fetch('/api/printer/print-direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'receipt',
        transaction,
        receiptSettings,
        connectionMode: printerSettings.connectionMode,
        printerIp: printerSettings.connectionMode === 'network' ? printerSettings.ip : null,
        printerPort: printerSettings.port,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending to printer:', error);
    return {
      success: false,
      message: error.message,
    };
  }
}

// Get printer status
export async function getPrinterStatus(settings) {
  try {
    const response = await fetch('/api/printer/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: settings.ip,
        port: settings.port,
        connectionMode: settings.connectionMode,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      available: false,
      status: 'offline',
      message: error.message,
    };
  }
}

// Simple function to check if printer is available (returns boolean)
export async function checkPrinterAvailable(settings = null) {
  try {
    const printerSettings = settings || getPrinterSettings();
    
    if (!printerSettings.enabled) {
      return false;
    }

    const status = await getPrinterStatus(printerSettings);
    return status.available === true;
  } catch (error) {
    console.warn('Printer availability check failed:', error);
    return false;
  }
}
