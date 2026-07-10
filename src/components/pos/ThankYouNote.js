/**
 * Thank You Note Modal
 *
 * Displays a polished post-payment customer message that matches the
 * upgraded receipt styling.
 */

import React from 'react';
import Image from 'next/image';
import { getStoreLogo } from '../../lib/logoCache';

function ContactPill({ label, value }) {
  if (!value) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-left shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}

export default function ThankYouNote({
  isOpen = false,
  onClose = () => {},
  receiptSettings = {},
  companyLogo,
}) {
  const logoSrc = companyLogo || getStoreLogo();
  const {
    companyDisplayName = 'Store',
    storePhone = '',
    email = '',
    website = '',
    qrUrl = '',
    qrDescription = '',
    receiptMessage = '',
    refundDays = 0,
  } = receiptSettings;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(180deg,#f9fafb_0%,#f3f4f6_55%,#eef6ff_100%)] shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-r from-cyan-600 via-sky-500 to-emerald-500" />

        <div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
          <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white/70 bg-white shadow-lg">
            <Image
              src={logoSrc}
              alt="Company Logo"
              width={80}
              height={80}
              className="object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = '/images/placeholder.jpg';
              }}
              unoptimized
            />
          </div>

          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-700">
              Receipt Complete
            </div>
            <h1
              className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              Thank you
            </h1>
            <div className="mt-3 text-xl font-semibold text-slate-800 sm:text-2xl">{companyDisplayName}</div>
          </div>

          {receiptMessage && (
            <div className="mt-6 rounded-[28px] border border-white/70 bg-white/80 px-5 py-5 text-center shadow-sm">
              <p className="whitespace-pre-line text-base leading-7 text-slate-700">{receiptMessage}</p>
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <ContactPill label="Phone" value={storePhone} />
            <ContactPill label="Email" value={email} />
            <ContactPill label="Website" value={website} />
          </div>

          {(refundDays > 0 || qrUrl) && (
            <div className="mt-6 rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm">
              {refundDays > 0 && (
                <div className="text-center text-sm font-medium text-slate-600">
                  Keep this receipt for returns within <span className="font-bold text-slate-900">{refundDays} days</span>.
                </div>
              )}

              {qrUrl && (
                <div className="mt-4 flex flex-col items-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                    {qrDescription}
                  </div>
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                    <Image
                      src={qrUrl}
                      alt="QR Code"
                      width={104}
                      height={104}
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 text-center text-sm text-slate-600">
            We look forward to serving you again soon.
          </div>

          <button
            onClick={onClose}
            className="mt-7 w-full rounded-2xl bg-slate-900 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-slate-800"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
