import React, { useEffect, useMemo, useState } from "react";
import AlphaKeyboardModal from "../common/AlphaKeyboardModal";
import NumKeypad from "../common/NumKeypad";

function toDateInputValue(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function createDefaultReservation() {
  const checkInDate = new Date();
  const checkOutDate = new Date(checkInDate);
  checkOutDate.setDate(checkOutDate.getDate() + 1);

  return {
    guestName: "",
    guestPhone: "",
    checkInDate: toDateInputValue(checkInDate),
    checkOutDate: toDateInputValue(checkOutDate),
    notes: "",
  };
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/[^0-9]/g, "").slice(0, 11);
}

function formatMobileNumber(value) {
  const digits = normalizePhoneDigits(value);
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 11)]
    .filter(Boolean)
    .join(" ");
}

export default function RoomReservationModal({ product, initialReservation, onClose, onConfirm }) {
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [checkInDate, setCheckInDate] = useState("");
  const [checkOutDate, setCheckOutDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [activeTextField, setActiveTextField] = useState(null);
  const [showPhoneKeypad, setShowPhoneKeypad] = useState(false);

  const defaults = useMemo(() => createDefaultReservation(), []);

  const TEXT_FIELD_CONFIG = {
    guestName: {
      label: "Guest Name",
      placeholder: "Guest full name",
      value: guestName,
      setValue: setGuestName,
    },
    notes: {
      label: "Booking Notes",
      placeholder: "Arrival time, special requests, or booking notes",
      value: notes,
      setValue: setNotes,
    },
  };

  const activeTextConfig = activeTextField ? TEXT_FIELD_CONFIG[activeTextField] : null;

  useEffect(() => {
    if (!product) return;

    setGuestName(initialReservation?.guestName || defaults.guestName);
    setGuestPhone(normalizePhoneDigits(initialReservation?.guestPhone || defaults.guestPhone));
    setCheckInDate(toDateInputValue(initialReservation?.checkInAt) || defaults.checkInDate);
    setCheckOutDate(toDateInputValue(initialReservation?.checkOutAt) || defaults.checkOutDate);
    setNotes(initialReservation?.notes || defaults.notes);
    setError("");
    setActiveTextField(null);
    setShowPhoneKeypad(false);
  }, [defaults, initialReservation, product]);

  if (!product) return null;

  const openTextKeyboard = (fieldName) => {
    setActiveTextField(fieldName);
    setError("");
  };

  const updateTextField = (value) => {
    if (!activeTextConfig) return;
    activeTextConfig.setValue(value);
    if (error) setError("");
  };

  const handlePhoneChange = (value) => {
    setGuestPhone(normalizePhoneDigits(value));
    if (error) setError("");
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const trimmedGuestName = guestName.trim();
    if (!trimmedGuestName) {
      setError("Guest name is required for a room booking.");
      return;
    }

    if (!checkInDate || !checkOutDate) {
      setError("Check-in and check-out dates are required.");
      return;
    }

    const checkInAt = new Date(checkInDate);
    const checkOutAt = new Date(checkOutDate);
    if (
      Number.isNaN(checkInAt.getTime()) ||
      Number.isNaN(checkOutAt.getTime()) ||
      checkOutAt <= checkInAt
    ) {
      setError("Check-out date must be after check-in date.");
      return;
    }

    onConfirm({
      guestName: trimmedGuestName,
      guestPhone: guestPhone.trim(),
      checkInAt: checkInAt.toISOString(),
      checkOutAt: checkOutAt.toISOString(),
      notes: notes.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white shadow-2xl overflow-hidden">
        <div className="border-b border-neutral-200 bg-gradient-to-r from-cyan-600 to-cyan-700 px-5 py-4 text-white">
          <div className="text-lg font-bold">Book Room</div>
          <div className="text-sm text-cyan-100 mt-1">{product.name} · ₦{Math.round(product.salePriceIncTax || 0).toLocaleString()}</div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-semibold text-neutral-700 mb-1">Guest Name</span>
              <input
                type="text"
                readOnly
                value={guestName}
                onClick={() => openTextKeyboard("guestName")}
                onFocus={() => openTextKeyboard("guestName")}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                placeholder="Guest full name"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-neutral-700 mb-1">Phone</span>
              <input
                type="text"
                readOnly
                value={formatMobileNumber(guestPhone)}
                onClick={() => {
                  setShowPhoneKeypad(true);
                  setError("");
                }}
                onFocus={() => {
                  setShowPhoneKeypad(true);
                  setError("");
                }}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                placeholder="Guest phone number"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-neutral-700 mb-1">Check-In</span>
              <input
                type="date"
                value={checkInDate}
                onChange={(event) => setCheckInDate(event.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-neutral-700 mb-1">Check-Out</span>
              <input
                type="date"
                value={checkOutDate}
                onChange={(event) => setCheckOutDate(event.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-sm font-semibold text-neutral-700 mb-1">Booking Notes</span>
            <textarea
              readOnly
              value={notes}
              onClick={() => openTextKeyboard("notes")}
              onFocus={() => openTextKeyboard("notes")}
              className="min-h-[100px] w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              placeholder="Arrival time, special requests, or booking notes"
            />
          </label>

          <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            Room bookings stay at a fixed quantity of 1 and save guest details with the transaction.
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-700"
            >
              Save Booking
            </button>
          </div>
        </form>
      </div>

      <AlphaKeyboardModal
        isOpen={Boolean(activeTextConfig)}
        value={activeTextConfig?.value || ""}
        title={activeTextConfig ? `Enter ${activeTextConfig.label}` : "Enter Text"}
        placeholder={activeTextConfig?.placeholder || "Type here..."}
        valueLabel={activeTextConfig?.label || "Input Text"}
        submitLabel="APPLY"
        onChange={updateTextField}
        onClose={() => setActiveTextField(null)}
        onSubmit={() => setActiveTextField(null)}
      />

      {showPhoneKeypad && (
        <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center p-2 sm:p-4">
          <div className="w-full max-w-md rounded-2xl border border-cyan-300/40 bg-white shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200 bg-gradient-to-r from-cyan-700 to-cyan-800 text-white">
              <div className="font-bold text-sm sm:text-base">Enter Phone Number</div>
              <div className="text-[11px] sm:text-xs text-cyan-100">Use the keypad to enter the guest phone number</div>
            </div>

            <div className="p-4 space-y-4">
              <NumKeypad
                value={guestPhone}
                displayValue={formatMobileNumber(guestPhone)}
                onChange={handlePhoneChange}
                placeholder="Phone Number"
              />

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowPhoneKeypad(false)}
                  className="rounded-lg bg-neutral-200 hover:bg-neutral-300 text-neutral-800 font-bold py-3 transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setShowPhoneKeypad(false)}
                  className="rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 transition"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}