/**
 * Numeric Keypad Component
 *
 * Reusable numeric keypad for inputting amounts with an optional calculator.
 * Used in: OpenTillModal, CloseTillModal, cart quantity editor
 */

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faBackspace, faCalculator } from '@fortawesome/free-solid-svg-icons';

const OPERATORS = ['+', '-', '*', '/'];
const OPERATOR_LABELS = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** "1234567.5" → "1,234,567.5" (keeps a trailing "." while typing) */
function formatNumberText(text) {
  return String(text).replace(/\d+(\.\d*)?/g, (match) => {
    const [whole, fraction] = match.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction !== undefined ? `${grouped}.${fraction}` : grouped;
  });
}

function formatExpression(expr) {
  return formatNumberText(expr)
    .replace(/[+\-*/]/g, (op, offset) => (offset === 0 && op === '-' ? '−' : ` ${OPERATOR_LABELS[op]} `))
    .trim();
}

/** Shrink the display text as it grows so long values stay fully visible */
function displaySizeClass(text, baseClass) {
  const length = String(text).length;
  if (length > 22) return 'text-sm';
  if (length > 16) return 'text-base';
  if (length > 12) return 'text-lg';
  if (length > 9) return 'text-xl';
  return baseClass;
}

export default function NumKeypad({ value, onChange, placeholder = "0.00", disabled = false, displayValue, showCalc = false, size = 'standard' }) {
  const [calcExpr, setCalcExpr] = useState('');
  const [calcMode, setCalcMode] = useState(false);
  const [calcError, setCalcError] = useState('');

  const btnClass = {
    compact: 'py-2.5 text-base',
    standard: 'py-3 text-lg',
    large: 'py-4 text-xl',
  }[size] || 'py-3 text-lg';

  const displayClass = {
    compact: 'text-xl',
    standard: 'text-2xl',
    large: 'text-3xl',
  }[size] || 'text-2xl';

  const currentValue = value === undefined || value === null ? '' : String(value);

  const handleKeyPress = (key) => {
    if (disabled) return;
    if (key === 'CLEAR') {
      onChange('');
    } else if (key === 'BACKSPACE') {
      onChange(currentValue.slice(0, -1));
    } else if (key === '.') {
      if (!currentValue.includes('.')) onChange(`${currentValue || '0'}.`);
    } else {
      onChange(currentValue + key);
    }
  };

  const evaluate = () => {
    const expr = calcExpr.replace(/[+\-*/.]+$/, '');
    if (!expr) return;
    if (!/^-?\d*\.?\d+([+\-*/]\d*\.?\d+)*$/.test(expr)) {
      setCalcError('Check the calculation');
      return;
    }
    const result = Function(`"use strict"; return (${expr})`)();
    if (!Number.isFinite(result)) {
      setCalcError('Cannot divide by zero');
      return;
    }
    const rounded = Math.round(result * 100) / 100;
    onChange(String(rounded));
    setCalcExpr('');
    setCalcMode(false);
  };

  const handleCalcKey = (key) => {
    if (disabled) return;
    setCalcError('');
    if (key === 'CLEAR') {
      setCalcExpr('');
    } else if (key === 'BACKSPACE') {
      setCalcExpr((prev) => prev.slice(0, -1));
    } else if (key === '=') {
      evaluate();
    } else if (OPERATORS.includes(key)) {
      setCalcExpr((prev) => {
        if (!prev) return key === '-' ? '-' : prev;
        // Pressing another operator replaces the last one
        return OPERATORS.includes(prev.slice(-1)) ? prev.slice(0, -1) + key : prev + key;
      });
    } else if (key === '.') {
      setCalcExpr((prev) => {
        const lastNumber = prev.split(/[+\-*/]/).pop();
        if (lastNumber.includes('.')) return prev;
        return prev + (lastNumber ? '.' : '0.');
      });
    } else {
      setCalcExpr((prev) => prev + key);
    }
  };

  const toggleCalculator = () => {
    setCalcError('');
    // Start the calculation from the amount already entered
    setCalcExpr(calcMode ? '' : currentValue.replace(/\.$/, ''));
    setCalcMode(!calcMode);
  };

  const shownText = calcMode
    ? (calcError || formatExpression(calcExpr) || '0')
    : (displayValue || formatNumberText(currentValue) || '0');

  const keyBase = 'rounded-md font-semibold transition-colors active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed';
  const numberKey = `${keyBase} bg-white border border-neutral-300 text-neutral-800 hover:bg-neutral-50 active:bg-neutral-100`;
  const neutralKey = `${keyBase} bg-neutral-100 border border-neutral-300 text-neutral-700 hover:bg-neutral-200`;
  const clearKey = `${keyBase} bg-red-50 border border-red-200 text-red-700 hover:bg-red-100`;
  const operatorKey = `${keyBase} bg-primary-50 border border-primary-200 text-primary-700 hover:bg-primary-100`;
  const equalsKey = `${keyBase} bg-primary-600 border border-primary-600 text-white hover:bg-primary-700`;

  return (
    <div className="space-y-2">
      {/* Display */}
      <div className="bg-white border border-neutral-300 rounded-md px-3 py-2.5 text-right">
        <div className="text-[11px] font-medium text-neutral-500 mb-0.5">{calcMode ? 'Calculator' : placeholder}</div>
        <div
          className={`font-bold leading-tight break-all ${calcError ? 'text-red-600 text-base' : `text-neutral-900 ${displaySizeClass(shownText, displayClass)}`}`}
          aria-live="polite"
        >
          {shownText}
        </div>
      </div>

      {showCalc && (
        <button
          type="button"
          onClick={toggleCalculator}
          disabled={disabled}
          className={`w-full py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-2 border transition-colors disabled:opacity-50 ${
            calcMode
              ? 'bg-primary-600 border-primary-600 text-white hover:bg-primary-700'
              : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-50'
          }`}
        >
          <FontAwesomeIcon icon={calcMode ? faArrowLeft : faCalculator} className="w-3.5 h-3.5" />
          {calcMode ? 'Back to amount' : 'Calculator'}
        </button>
      )}

      {calcMode ? (
        <div className="grid grid-cols-4 gap-1.5">
          {[
            ['7', '8', '9', '/'],
            ['4', '5', '6', '*'],
            ['1', '2', '3', '-'],
            ['.', '0', '=', '+'],
          ].flat().map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleCalcKey(key)}
              disabled={disabled}
              className={`${key === '=' ? equalsKey : OPERATORS.includes(key) ? operatorKey : numberKey} ${btnClass}`}
            >
              {OPERATOR_LABELS[key] || key}
            </button>
          ))}
          <button type="button" onClick={() => handleCalcKey('BACKSPACE')} disabled={disabled} className={`col-span-2 ${neutralKey} ${btnClass} flex items-center justify-center`} aria-label="Backspace">
            <FontAwesomeIcon icon={faBackspace} className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => handleCalcKey('CLEAR')} disabled={disabled} className={`col-span-2 ${clearKey} ${btnClass}`}>
            Clear
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {['7', '8', '9'].map((n) => (
            <button key={n} type="button" onClick={() => handleKeyPress(n)} disabled={disabled} className={`${numberKey} ${btnClass}`}>{n}</button>
          ))}
          <button type="button" onClick={() => handleKeyPress('CLEAR')} disabled={disabled} className={`${clearKey} ${btnClass}`}>C</button>

          {['4', '5', '6'].map((n) => (
            <button key={n} type="button" onClick={() => handleKeyPress(n)} disabled={disabled} className={`${numberKey} ${btnClass}`}>{n}</button>
          ))}
          <button type="button" onClick={() => handleKeyPress('BACKSPACE')} disabled={disabled} className={`${neutralKey} ${btnClass} flex items-center justify-center`} aria-label="Backspace">
            <FontAwesomeIcon icon={faBackspace} className="w-5 h-5" />
          </button>

          {['1', '2', '3'].map((n) => (
            <button key={n} type="button" onClick={() => handleKeyPress(n)} disabled={disabled} className={`${numberKey} ${btnClass}`}>{n}</button>
          ))}
          <button type="button" onClick={() => handleKeyPress('.')} disabled={disabled} className={`${neutralKey} ${btnClass}`}>.</button>

          <button type="button" onClick={() => handleKeyPress('0')} disabled={disabled} className={`col-span-2 ${numberKey} ${btnClass}`}>0</button>
          <button type="button" onClick={() => handleKeyPress('00')} disabled={disabled} className={`col-span-2 ${numberKey} ${btnClass}`}>00</button>
        </div>
      )}
    </div>
  );
}
