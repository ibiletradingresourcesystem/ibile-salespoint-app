/**
 * Server-only: Windows printer queues for direct (USB) receipt printing.
 * Works when the POS server runs on the Windows till computer the printer is installed on.
 *
 * Receipts are sent as RAW bytes through the Windows spooler (winspool OpenPrinter/WritePrinter),
 * so the thermal printer receives the ESC/POS commands untouched.
 */
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export function isHostedOnline() {
  return Boolean(process.env.VERCEL);
}

export function canUseWindowsPrinters() {
  return process.platform === 'win32' && !isHostedOnline();
}

const ERROR_PREFIX = 'POS_PRINTER_ERROR:';

function runPowerShell(script, env = {}, timeout = 15000) {
  // Errors are caught in the script and written as plain text; PowerShell's own error output is CLIXML
  const wrapped = `$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
${script}
} catch {
  $message = $_.Exception.Message
  if ($_.Exception.InnerException) { $message = $_.Exception.InnerException.Message }
  Write-Output ('${ERROR_PREFIX}' + $message)
  exit 1
}`;

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(wrapped, 'utf16le').toString('base64')],
      { env: { ...process.env, ...env }, timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const output = String(stdout || '').trim();
        if (error) {
          const scriptError = output.split(/\r?\n/).find((line) => line.startsWith(ERROR_PREFIX));
          const message = scriptError
            ? scriptError.slice(ERROR_PREFIX.length).trim()
            : error.killed ? 'Windows took too long to respond' : 'Windows could not run the printer command';
          reject(new Error(message));
          return;
        }
        resolve(output);
      }
    );
  });
}

/** Installed printers: [{ name, offline, port, driver }] */
export async function listWindowsPrinters() {
  const output = await runPowerShell(
    "Get-Printer | Select-Object Name, WorkOffline, PortName, DriverName | ConvertTo-Json -Compress"
  );
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((printer) => ({
    name: printer.Name,
    offline: printer.WorkOffline === true,
    port: printer.PortName || '',
    driver: printer.DriverName || '',
  }));
}

const RAW_PRINT_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string DocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string OutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

  public static void Send(string printerName, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Printer '" + printerName + "' was not found on this computer");
    try {
      if (StartDocPrinter(handle, 1, new DocInfo { DocName = "POS Receipt", DataType = "RAW" }) == 0)
        throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(handle);
        int written;
        if (!WritePrinter(handle, data, data.Length, out written) || written != data.Length)
          throw new Win32Exception(Marshal.GetLastWin32Error());
        EndPagePrinter(handle);
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      ClosePrinter(handle);
    }
  }
}
'@
[PosRawPrinter]::Send($env:POS_PRINTER_NAME, [System.IO.File]::ReadAllBytes($env:POS_RAW_FILE))
'OK'
`;

/** Send RAW bytes to an installed Windows printer queue. */
export async function sendRawToWindowsPrinter(printerName, bytes) {
  const filePath = path.join(os.tmpdir(), `pos-receipt-${process.pid}-${Date.now()}.bin`);
  await fs.writeFile(filePath, Buffer.from(bytes));
  try {
    // Printer name and file go through environment variables, never into the script text
    await runPowerShell(RAW_PRINT_SCRIPT, { POS_PRINTER_NAME: printerName, POS_RAW_FILE: filePath }, 30000);
  } finally {
    fs.unlink(filePath).catch(() => {});
  }
}
