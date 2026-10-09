'use strict';

/**
 * What this computer's processor can do, as far as the local database cares.
 *
 * MongoDB 8.0 on Windows reads Snappy-compressed data with BMI2 (lib/mongo.js, BLOCK_COMPRESSOR).
 * Windows does not report BMI2 on its own, but it reports AVX2, and every processor with AVX2 has
 * BMI2 as well (both arrived with Intel Haswell and AMD Excavator); those without AVX2 — Celeron
 * J1900 and N-series, Pentium, older Core — mostly lack BMI2 too. So AVX2 present means the old data
 * is safe to read; absent means it has to be tried before the till relies on it.
 */

const { execFile } = require('child_process');

// IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE)
const PF_AVX2_INSTRUCTIONS_AVAILABLE = 40;

/** true / false, or null when Windows could not be asked (PowerShell blocked, not Windows). */
function hasAvx2() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script =
    "Add-Type -Namespace IbilePos -Name Cpu -MemberDefinition '[DllImport(\"kernel32.dll\")] " +
    "public static extern bool IsProcessorFeaturePresent(uint feature);'; " +
    `[IbilePos.Cpu]::IsProcessorFeaturePresent(${PF_AVX2_INSTRUCTIONS_AVAILABLE})`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20 * 1000, encoding: 'utf8' },
      (error, stdout) => {
        if (error) return resolve(null);
        const answer = String(stdout).trim();
        resolve(/^true$/i.test(answer) ? true : /^false$/i.test(answer) ? false : null);
      }
    );
  });
}

module.exports = { hasAvx2 };
