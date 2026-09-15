/**
 * 4-digit passcode keypad in the same style as the staff login screen.
 */

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBackspace } from '@fortawesome/free-solid-svg-icons';

const keyClass =
  'h-12 bg-cyan-800 border border-cyan-500/60 shadow-md hover:bg-cyan-600 text-white font-bold text-xl rounded-lg transition active:scale-95 disabled:opacity-50';

export default function PinPad({ value, onChange, disabled = false }) {
  const press = (digit) => {
    if (!disabled && value.length < 4) onChange(`${value}${digit}`);
  };

  return (
    <div className="w-full max-w-xs">
      <div className="flex items-center justify-center gap-4 h-10 mb-3" aria-label={`${value.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`w-4 h-4 rounded-full border-2 border-white transition-colors ${index < value.length ? 'bg-white' : 'bg-transparent opacity-50'}`}
          />
        ))}
      </div>
      <div className="w-full h-0.5 bg-white/30 mb-3" />
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button key={digit} type="button" disabled={disabled} onClick={() => press(String(digit))} className={keyClass}>
            {digit}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={() => press('0')} className={`col-span-2 ${keyClass}`}>
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(value.slice(0, -1))}
          aria-label="Backspace"
          className={`${keyClass} flex items-center justify-center`}
        >
          <FontAwesomeIcon icon={faBackspace} className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
