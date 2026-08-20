/**
 * Numeric Keypad Component
 * 
 * Reusable numeric keypad for inputting amounts with optional calculator
 * Used in: OpenTillModal, CloseTillModal, tender input forms
 */

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBackspace, faTimes } from '@fortawesome/free-solid-svg-icons';

export default function NumKeypad({ value, onChange, placeholder = "0.00", disabled = false, displayValue, showCalc = false }) {
  const [calcExpr, setCalcExpr] = useState('');
  const [calcMode, setCalcMode] = useState(false);

  const handleKeyPress = (key) => {
    if (disabled) return;

    if (showCalc && calcMode) {
      handleCalcKey(key);
      return;
    }

    let newValue = value.toString();

    if (key === 'CLEAR') {
      onChange('');
    } else if (key === 'BACKSPACE') {
      onChange(newValue.slice(0, -1));
    } else if (key === '.') {
      if (!newValue.includes('.')) {
        onChange(newValue + '.');
      }
    } else {
      onChange(newValue + key);
    }
  };

  const handleCalcKey = (key) => {
    if (key === 'CLEAR') {
      setCalcExpr('');
    } else if (key === 'BACKSPACE') {
      setCalcExpr(prev => prev.slice(0, -1));
    } else if (key === '=') {
      try {
        const sanitized = calcExpr.replace(/[^0-9+\-*/.() ]/g, '');
        const result = Function('"use strict"; return (' + sanitized + ')')();
        const rounded = Math.round(result * 100) / 100;
        setCalcExpr(String(rounded));
        onChange(String(rounded));
        setCalcMode(false);
      } catch {
        setCalcExpr('Error');
        setTimeout(() => setCalcExpr(''), 1000);
      }
    } else {
      setCalcExpr(prev => prev + key);
    }
  };

  const calcButtons = [
    ['7', '8', '9', '+'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '×'],
    ['.', '0', '=', '÷'],
  ];
  const opMap = { '×': '*', '÷': '/' };

  return (
    <div className="space-y-2">
      {/* Display */}
      <div className="bg-gray-100 border-2 border-gray-300 rounded-lg p-2.5 text-right shadow-sm">
        <div className="text-[10px] text-gray-500 mb-1">{calcMode ? 'Calculator' : placeholder}</div>
        <div className="text-2xl font-bold text-gray-800 truncate">
          {calcMode ? (calcExpr || '0') : (displayValue || value || '0')}
        </div>
      </div>

      {showCalc && (
        <button
          onClick={() => { setCalcMode(!calcMode); setCalcExpr(''); }}
          className={`w-full py-1.5 rounded text-xs font-bold transition-all ${calcMode ? 'bg-cyan-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
        >
          {calcMode ? '← Back to Input' : '🧮 Calculator'}
        </button>
      )}

      {calcMode ? (
        <div className="grid grid-cols-4 gap-1.5">
          {calcButtons.map((row, ri) => row.map((key) => {
            const isOp = ['+', '-', '×', '÷'].includes(key);
            const isEq = key === '=';
            return (
              <button
                key={`${ri}-${key}`}
                onClick={() => handleCalcKey(isOp ? (opMap[key] || key) : key)}
                disabled={disabled}
                className={`rounded-lg py-2.5 font-bold text-base transition-all active:scale-95 ${
                  isEq ? 'bg-green-500 hover:bg-green-600 text-white' :
                  isOp ? 'bg-cyan-500 hover:bg-cyan-600 text-white' :
                  'bg-white border-2 border-gray-300 hover:bg-gray-50 text-gray-800'
                }`}
              >
                {key}
              </button>
            );
          }))}
          <button onClick={() => handleCalcKey('BACKSPACE')} disabled={disabled} className="col-span-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg py-2.5 font-bold text-sm active:scale-95">
            <FontAwesomeIcon icon={faBackspace} className="w-4 h-4 mr-1" /> BACK
          </button>
          <button onClick={() => handleCalcKey('CLEAR')} disabled={disabled} className="col-span-2 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2.5 font-bold text-sm active:scale-95">
            CLEAR
          </button>
        </div>
      ) : (
      <>
      {/* Keypad Grid */}
      <div className="grid grid-cols-4 gap-1.5">
        {/* Row 1: 7 8 9 C */}
        {[7, 8, 9].map(n => (
          <button key={n} onClick={() => handleKeyPress(String(n))} disabled={disabled}
            className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-2.5 font-bold text-lg transition-all shadow-sm">{n}</button>
        ))}
        <button onClick={() => handleKeyPress('CLEAR')} disabled={disabled}
          className="bg-red-500 hover:bg-red-600 active:scale-95 disabled:opacity-50 text-white rounded-lg py-2.5 font-bold text-lg shadow-md">C</button>

        {/* Row 2: 4 5 6 BS */}
        {[4, 5, 6].map(n => (
          <button key={n} onClick={() => handleKeyPress(String(n))} disabled={disabled}
            className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-2.5 font-bold text-lg transition-all shadow-sm">{n}</button>
        ))}
        <button onClick={() => handleKeyPress('BACKSPACE')} disabled={disabled}
          className="bg-orange-500 hover:bg-orange-600 active:scale-95 disabled:opacity-50 text-white rounded-lg py-2.5 font-bold text-lg shadow-md flex items-center justify-center">
          <FontAwesomeIcon icon={faBackspace} className="w-5 h-5" />
        </button>

        {/* Row 3: 1 2 3 . */}
        {[1, 2, 3].map(n => (
          <button key={n} onClick={() => handleKeyPress(String(n))} disabled={disabled}
            className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-2.5 font-bold text-lg transition-all shadow-sm">{n}</button>
        ))}
        <button onClick={() => handleKeyPress('.')} disabled={disabled}
          className="bg-blue-500 hover:bg-blue-600 active:scale-95 disabled:opacity-50 text-white rounded-lg py-2.5 font-bold text-lg shadow-md">.</button>

        {/* Row 4: 0 00 X */}
        <button onClick={() => handleKeyPress('0')} disabled={disabled}
          className="col-span-2 bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-2.5 font-bold text-lg shadow-sm">0</button>
        <button onClick={() => handleKeyPress('00')} disabled={disabled}
          className="bg-white border-2 border-gray-300 hover:bg-gray-50 active:bg-gray-200 active:scale-95 disabled:opacity-50 rounded-lg py-2.5 font-bold text-lg shadow-sm">00</button>
        <button onClick={() => handleKeyPress('CLEAR')} disabled={disabled}
          className="bg-gray-400 hover:bg-gray-500 active:scale-95 disabled:opacity-50 text-white rounded-lg py-2.5 font-bold text-lg shadow-md flex items-center justify-center">
          <FontAwesomeIcon icon={faTimes} className="w-5 h-5" />
        </button>
      </div>
      </>
      )}
    </div>
  );
}
