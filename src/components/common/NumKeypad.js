/**
 * Numeric Keypad Component
 * 
 * Reusable numeric keypad for inputting amounts
 * Used in: OpenTillModal, CloseTillModal, tender input forms
 */

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBackspace, faTimes } from '@fortawesome/free-solid-svg-icons';

export default function NumKeypad({ value, onChange, placeholder = "0.00", disabled = false, displayValue }) {
  const handleKeyPress = (key) => {
    if (disabled) return;

    let newValue = value.toString();

    if (key === 'CLEAR') {
      onChange('');
    } else if (key === 'BACKSPACE') {
      onChange(newValue.slice(0, -1));
    } else if (key === '.') {
      // Only allow one decimal point
      if (!newValue.includes('.')) {
        onChange(newValue + '.');
      }
    } else {
      // Add digit
      onChange(newValue + key);
    }
  };

  return (
    <div className="space-y-3">
      {/* Display */}
      <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-3 text-right shadow-sm">
        <div className="text-xs text-gray-500 mb-2">{placeholder}</div>
        <div className="text-3xl font-bold text-gray-800 truncate">
          {displayValue || value || '0'}
        </div>
      </div>

      {/* Keypad Grid */}
      <div className="grid grid-cols-4 gap-2">
        {/* Row 1: 7 8 9 C */}
        <button
          onClick={() => handleKeyPress('7')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          7
        </button>
        <button
          onClick={() => handleKeyPress('8')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          8
        </button>
        <button
          onClick={() => handleKeyPress('9')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          9
        </button>
        <button
          onClick={() => handleKeyPress('CLEAR')}
          disabled={disabled}
          className="bg-red-500 hover:bg-red-600 active:bg-red-700 active:scale-95 disabled:opacity-50 text-white rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-md"
        >
          C
        </button>

        {/* Row 2: 4 5 6 BS */}
        <button
          onClick={() => handleKeyPress('4')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          4
        </button>
        <button
          onClick={() => handleKeyPress('5')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          5
        </button>
        <button
          onClick={() => handleKeyPress('6')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          6
        </button>
        <button
          onClick={() => handleKeyPress('BACKSPACE')}
          disabled={disabled}
          className="bg-orange-500 hover:bg-orange-600 active:bg-orange-700 active:scale-95 disabled:opacity-50 text-white rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-md flex items-center justify-center"
        >
          <FontAwesomeIcon icon={faBackspace} className="w-5 h-5" />
        </button>

        {/* Row 3: 1 2 3 . */}
        <button
          onClick={() => handleKeyPress('1')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          1
        </button>
        <button
          onClick={() => handleKeyPress('2')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          2
        </button>
        <button
          onClick={() => handleKeyPress('3')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          3
        </button>
        <button
          onClick={() => handleKeyPress('.')}
          disabled={disabled}
          className="bg-blue-500 hover:bg-blue-600 active:bg-blue-700 active:scale-95 disabled:opacity-50 text-white rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-md"
        >
          .
        </button>

        {/* Row 4: 0 00 X */}
        <button
          onClick={() => handleKeyPress('0')}
          disabled={disabled}
          className="col-span-2 bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          0
        </button>
        <button
          onClick={() => handleKeyPress('00')}
          disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-sm"
        >
          00
        </button>
        <button
          onClick={() => handleKeyPress('CLEAR')}
          disabled={disabled}
          className="bg-gray-400 hover:bg-gray-500 active:bg-gray-600 active:scale-95 disabled:opacity-50 text-white rounded-lg py-3 px-2 font-bold text-lg transition-all duration-75 shadow-md flex items-center justify-center"
        >
          <FontAwesomeIcon icon={faTimes} className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
