import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBackspace,
  faSearch,
  faTimes,
  faKeyboard,
} from "@fortawesome/free-solid-svg-icons";

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

export default function AlphaKeyboardModal({
  isOpen = false,
  value = "",
  title = "Search",
  placeholder = "Type here...",
  valueLabel = "Search Text",
  submitLabel = "SEARCH",
  onChange = () => {},
  onClose = () => {},
  onSubmit = () => {},
}) {
  if (!isOpen) return null;

  const append = (next) => onChange(`${value || ""}${next}`);
  const backspace = () => onChange((value || "").slice(0, -1));
  const clear = () => onChange("");

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-4xl bg-gradient-to-br from-cyan-700 via-cyan-800 to-cyan-900 text-white rounded-2xl shadow-2xl border border-cyan-400/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-cyan-400/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faKeyboard} className="w-4 h-4 text-cyan-200" />
            <div>
              <div className="font-bold text-sm sm:text-base">{title}</div>
              <div className="text-[11px] sm:text-xs text-cyan-200">{placeholder}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center justify-center"
          >
            <FontAwesomeIcon icon={faTimes} className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 sm:p-4 space-y-3">
          <div className="bg-white/10 border border-cyan-300/30 rounded-xl p-3 min-h-[74px]">
            <div className="text-[11px] uppercase tracking-wide text-cyan-200 mb-1">{valueLabel}</div>
            <div className="text-lg sm:text-2xl font-bold break-words min-h-[32px]">
              {value || <span className="text-cyan-200/70">{placeholder}</span>}
            </div>
          </div>

          <div className="space-y-2">
            {KEY_ROWS.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className={`grid gap-2 ${rowIndex === 1 ? "grid-cols-9 px-3 sm:px-8" : rowIndex === 2 ? "grid-cols-7 px-8 sm:px-16" : "grid-cols-10"}`}
              >
                {row.map((key) => (
                  <button
                    key={key}
                    onClick={() => append(key)}
                    className="bg-white border border-cyan-200/60 text-cyan-900 hover:bg-cyan-50 rounded-lg py-3 sm:py-4 font-bold text-sm sm:text-lg shadow-sm transition active:scale-95"
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-12 gap-2">
            <button
              onClick={clear}
              className="col-span-3 sm:col-span-2 bg-red-500 hover:bg-red-600 rounded-lg py-3 font-bold text-xs sm:text-sm transition active:scale-95"
            >
              CLEAR
            </button>
            <button
              onClick={() => append(" ")}
              className="col-span-5 sm:col-span-6 bg-white border border-cyan-200/60 text-cyan-900 hover:bg-cyan-50 rounded-lg py-3 font-bold text-xs sm:text-sm transition active:scale-95"
            >
              SPACE
            </button>
            <button
              onClick={backspace}
              className="col-span-4 sm:col-span-2 bg-orange-500 hover:bg-orange-600 rounded-lg py-3 font-bold text-xs sm:text-sm transition active:scale-95 flex items-center justify-center gap-2"
            >
              <FontAwesomeIcon icon={faBackspace} className="w-4 h-4" />
              <span>BACK</span>
            </button>
            <button
              onClick={onSubmit}
              className="col-span-12 sm:col-span-2 bg-green-500 hover:bg-green-600 rounded-lg py-3 font-bold text-sm transition active:scale-95 flex items-center justify-center gap-2"
            >
              <FontAwesomeIcon icon={faSearch} className="w-4 h-4" />
              <span>{submitLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
