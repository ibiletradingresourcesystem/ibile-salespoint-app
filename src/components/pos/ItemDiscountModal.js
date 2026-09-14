/**
 * ItemDiscountModal
 *
 * Discount one cart line by a percentage or by setting a new price, with a required reason.
 * Opened from the DISC button in the cart (admins and managers only).
 */

import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPercent, faTag, faTags, faTrashAlt, faXmark } from "@fortawesome/free-solid-svg-icons";
import NumKeypad from "../common/NumKeypad";
import {
  DISCOUNT_MODES,
  DISCOUNT_REASONS,
  QUICK_PERCENTAGES,
  calculateItemDiscount,
} from "../../lib/itemDiscount";

const formatNaira = (value) =>
  `₦${Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ItemDiscountModal({ item, staff, onApply, onRemove, onClose }) {
  const existing = item?.discountDetails || null;
  const [mode, setMode] = useState(existing?.mode || DISCOUNT_MODES.PERCENT);
  const [value, setValue] = useState(existing ? String(existing.value) : "");
  const [reason, setReason] = useState(existing?.reason || "");
  const [note, setNote] = useState(existing?.note || "");

  if (!item) return null;

  const result = calculateItemDiscount({ price: item.price, quantity: item.quantity, mode, value });
  const needsNote = reason === "Other";
  const reasonMissing = !reason || (needsNote && !note.trim());
  const canApply = result.valid && !reasonMissing;
  const hasDiscount = Boolean(existing) || Number(item.discount) > 0;
  const isPercent = mode === DISCOUNT_MODES.PERCENT;

  const changeMode = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setValue("");
  };

  const handleValueChange = (next) => {
    let text = String(next || "").replace(/[^0-9.]/g, "");
    const firstDot = text.indexOf(".");
    if (firstDot !== -1) text = text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, "");
    setValue(text);
  };

  const handleApply = () => {
    if (!canApply) return;
    onApply({
      mode,
      value: Number(value),
      reason,
      note: note.trim(),
      appliedBy: staff?.name || staff?.fullName || "",
      appliedById: staff?._id || null,
      appliedAt: new Date().toISOString(),
    });
  };

  const modeButton = (id, label, icon) => (
    <button
      type="button"
      onClick={() => changeMode(id)}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 text-sm font-semibold border transition-colors ${
        mode === id
          ? "bg-primary-600 border-primary-600 text-white"
          : "bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-50"
      } ${id === DISCOUNT_MODES.PERCENT ? "rounded-l-md" : "rounded-r-md -ml-px"}`}
      aria-pressed={mode === id}
    >
      <FontAwesomeIcon icon={icon} className="w-3.5 h-3.5" />
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-discount-title"
        className="bg-white border border-neutral-200 rounded-lg shadow-2xl w-full max-w-3xl max-h-[calc(100vh-1.5rem)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-primary-700 text-white px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="item-discount-title" className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
              <FontAwesomeIcon icon={faTag} className="w-3.5 h-3.5" />
              Apply discount
            </h2>
            <p className="text-xs text-primary-100 truncate mt-0.5">{item.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-md hover:bg-white/15 flex items-center justify-center transition-colors flex-shrink-0"
          >
            <FontAwesomeIcon icon={faXmark} className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto grid md:grid-cols-[1fr_300px]">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-3 border border-neutral-200 rounded-md divide-x divide-neutral-200">
              {[
                ["Price each", formatNaira(item.price)],
                ["Quantity", item.quantity],
                ["Line total", formatNaira(result.lineTotal)],
              ].map(([label, text]) => (
                <div key={label} className="px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
                  <p className="text-sm font-bold text-neutral-900 mt-0.5 whitespace-nowrap">{text}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">Discount by</p>
              <div className="flex">
                {modeButton(DISCOUNT_MODES.PERCENT, "Percentage off", faPercent)}
                {modeButton(DISCOUNT_MODES.PRICE, "Set new price", faTags)}
              </div>
              {isPercent && (
                <div className="grid grid-cols-6 gap-1.5 mt-2">
                  {QUICK_PERCENTAGES.map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => setValue(String(percent))}
                      className={`py-2 rounded-md border text-xs font-bold transition-colors ${
                        Number(value) === percent
                          ? "bg-primary-50 border-primary-500 text-primary-700"
                          : "bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                      }`}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="discount-reason" className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">
                Reason <span className="text-red-600">*</span>
              </label>
              <select
                id="discount-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full border border-neutral-300 rounded-md px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
              >
                <option value="">Select a reason…</option>
                {DISCOUNT_REASONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={120}
                placeholder={needsNote ? "Describe the reason (required)" : "Add a note (optional)"}
                className={`mt-2 w-full border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 ${
                  needsNote && !note.trim() ? "border-amber-400" : "border-neutral-300"
                }`}
              />
            </div>

            <div className="border border-neutral-200 rounded-md divide-y divide-neutral-200 text-sm">
              <div className="flex justify-between px-3 py-2">
                <span className="text-neutral-600">Was</span>
                <span className="font-semibold text-neutral-800">{formatNaira(result.lineTotal)}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-neutral-600">
                  Discount{result.valid ? ` (${result.percent}%)` : ""}
                </span>
                <span className="font-semibold text-green-700">
                  {result.valid ? `-${formatNaira(result.lineDiscount)}` : "—"}
                </span>
              </div>
              {result.valid && item.quantity > 1 && (
                <div className="flex justify-between px-3 py-2">
                  <span className="text-neutral-600">New price each</span>
                  <span className="font-semibold text-neutral-800">{formatNaira(result.newUnitPrice)}</span>
                </div>
              )}
              <div className="flex justify-between px-3 py-2.5 bg-primary-50">
                <span className="font-bold text-primary-800">New line total</span>
                <span className="font-bold text-primary-800">{formatNaira(result.valid ? result.newLineTotal : result.lineTotal)}</span>
              </div>
            </div>

            {value !== "" && !result.valid && (
              <p className="text-xs font-semibold text-red-600">{result.error}</p>
            )}
          </div>

          <div className="p-4 bg-neutral-50 border-t md:border-t-0 md:border-l border-neutral-200">
            <NumKeypad
              value={value}
              onChange={handleValueChange}
              placeholder={isPercent ? "Percentage off (%)" : "New price each (₦)"}
              displayValue={value === "" ? undefined : isPercent ? `${value}%` : `₦${Number(value || 0).toLocaleString("en-NG")}${value.endsWith(".") ? "." : ""}`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-200 px-4 py-3 flex flex-wrap items-center gap-2">
          {hasDiscount && (
            <button
              type="button"
              onClick={onRemove}
              className="px-4 py-2.5 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-semibold flex items-center gap-2 transition-colors"
            >
              <FontAwesomeIcon icon={faTrashAlt} className="w-3.5 h-3.5" />
              Remove discount
            </button>
          )}
          <p className="text-xs text-neutral-500 mr-auto">
            {staff?.name ? `Recorded against ${staff.name}` : ""}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-md border border-neutral-300 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply}
            title={!result.valid ? result.error : reasonMissing ? "Choose a reason" : undefined}
            className="px-5 py-2.5 rounded-md bg-primary-600 hover:bg-primary-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
          >
            Apply discount
          </button>
        </div>
      </div>
    </div>
  );
}
