/**
 * Printer Settings Page
 *
 * This till's receipt printer: how receipts print, paper size / print area, and the printer
 * connection (see PrinterSettingsPanel). Receipt design comes from the management app's Receipt Settings.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPrint } from '@fortawesome/free-solid-svg-icons';
import { useStaff } from '@/src/context/StaffContext';
import { hasPosPermission } from '@/src/lib/posPermissions';
import PrinterSettingsPanel from '@/src/components/printer/PrinterSettingsPanel';

export default function PrinterSettings() {
  const router = useRouter();
  const { staff, location } = useStaff();
  const canAccessPrinterSettings = hasPosPermission(staff, 'printerSettingsAccess');

  useEffect(() => {
    if (staff && !canAccessPrinterSettings) router.replace('/');
  }, [canAccessPrinterSettings, router, staff]);

  if (staff && !canAccessPrinterSettings) {
    return <div className="max-w-3xl mx-auto p-6 text-center text-gray-600">You do not have permission to access printer settings.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-sm py-2 -mx-6 px-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
        >
          <FontAwesomeIcon icon={faArrowLeft} className="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-lg">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-t-lg">
          {/* text-white on the heading itself: the global h1 colour would otherwise win */}
          <h1 className="text-3xl font-bold flex items-center gap-3 text-white">
            <FontAwesomeIcon icon={faPrint} className="w-7 h-7 text-white" />
            Printer Settings
          </h1>
          <p className="text-blue-100 mt-2">
            How this till prints receipts. The receipt design (logo, company details, font, QR code and messages)
            is set in the management app under Setup → Receipt Settings.
          </p>
        </div>

        <PrinterSettingsPanel staff={staff} location={location} />
      </div>
    </div>
  );
}
