/**
 * PaymentModal Component
 * 
 * Modal for collecting payment details:
 * - Fetches tender types assigned to the location
 * - Amount paid for each tender
 * - Change calculation
 * - Numeric keypad for amounts
 * - Confirm/Cancel buttons
 * - Uses Nigerian Naira (₦) currency
 */

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faCheckCircle, faTimes, faBackspace } from '@fortawesome/free-solid-svg-icons';
import { useStaff } from '@/src/context/StaffContext';
import { useLocationTenders } from '@/src/hooks/useLocationTenders';
import { getUiSettings } from '@/src/lib/uiSettings';
import { getStoreLogo } from '@/src/lib/logoCache';

const TENDER_COLOR_MAP = {
  'Cash': 'bg-green-500',
  'Card': 'bg-primary-500',
  'Transfer': 'bg-purple-500',
  'Cheque': 'bg-neutral-500',
  'Other': 'bg-indigo-500',
};

export default function PaymentModal({ total, onConfirm, onCancel, inline = false }) {
  const { location } = useStaff();
  const { tenders: locationTenders, loading: tendersLoading, error: tendersError } = useLocationTenders();
  
  const [availableTenders, setAvailableTenders] = useState([]);
  const [tenders, setTenders] = useState({});
  const [selectedTender, setSelectedTender] = useState(null);
  const [displayAmount, setDisplayAmount] = useState('0');
  const [currentAmount, setCurrentAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false); // Prevent double-click
  const [isMobile, setIsMobile] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(''); // Duplicate tender warning
  const lastAddRef = React.useRef({ tenderId: null, amount: 0, time: 0 });

  // Use pre-fetched location tenders from hook
  useEffect(() => {
    console.log('💳 PaymentModal: Using location tenders from hook');
    console.log('📍 Location:', location?.name);
    console.log('🏪 Location tenders:', locationTenders);
    console.log('📋 Tenders loading:', tendersLoading, 'Error:', tendersError);

    if (tendersLoading) {
      setLoading(true);
      return;
    }

    if (tendersError && locationTenders.length === 0) {
      console.warn('⚠️ Error loading tenders:', tendersError);
      setError(tendersError);
      setLoading(false);
      return;
    }

    if (locationTenders.length === 0) {
      console.warn('⚠️ No tenders available for location');
      setError(null);
      setAvailableTenders([]);
      setLoading(false);
      return;
    }

    // Tenders are already normalized from the hook
    setAvailableTenders(locationTenders);

    // Initialize tenders object
    const tendersObj = {};
    locationTenders.forEach(tender => {
      tendersObj[tender.id] = 0;
    });
    setTenders(tendersObj);

    // Set first tender as selected
    if (locationTenders.length > 0) {
      setSelectedTender(locationTenders[0].id);
    }

    setLoading(false);
  }, [locationTenders, tendersLoading, tendersError, location]);

  console.log('💳 PaymentModal opened with total:', total);
  console.log('📍 Location:', location);
  console.log('📍 Location._id:', location?._id);
  console.log('🏪 Available tenders:', availableTenders);

  // Calculate total paid and change
  const totalPaid = Object.values(tenders).reduce((sum, val) => sum + val, 0);
  const change = Math.max(0, totalPaid - total);
  const isPaymentComplete = totalPaid >= total;
  const [uiSettings, setUiSettings] = useState(getUiSettings());

  useEffect(() => {
    const handleSettingsUpdate = (event) => {
      if (event?.detail) {
        setUiSettings(event.detail);
      } else {
        setUiSettings(getUiSettings());
      }
    };

    handleSettingsUpdate();
    window.addEventListener('uiSettings:updated', handleSettingsUpdate);
    return () => window.removeEventListener('uiSettings:updated', handleSettingsUpdate);
  }, []);

  useEffect(() => {
    const updateIsMobile = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.matchMedia('(max-width: 640px)').matches);
    };
    updateIsMobile();
    window.addEventListener('resize', updateIsMobile);
    return () => window.removeEventListener('resize', updateIsMobile);
  }, []);

  const quickAmountSettings = uiSettings.payment?.quickAmounts || {};
  const paymentContentSize = uiSettings.payment?.contentSize || "standard";
  const keypadSize = uiSettings.payment?.keypadSize || "standard";
  const contentSizeClass = {
    compact: "text-[14px]",
    standard: "text-[16px]",
    large: "text-[18px]",
  }[paymentContentSize] || "text-[16px]";
  const keypadButtonClass = {
    compact: "text-lg py-2.5",
    standard: "text-2xl py-3.5",
    large: "text-3xl py-4.5",
  }[keypadSize] || "text-2xl py-3.5";

  // Format Nigerian Naira with comma separators
  const formatNaira = (amount) => {
    return `₦${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Handle numeric input
  const handleNumberClick = (num) => {
    const newAmount = currentAmount + num.toString();
    setCurrentAmount(newAmount);
    setDisplayAmount(newAmount || '0');
  };

  // Handle decimal point
  const handleDecimal = () => {
    if (!currentAmount.includes('.')) {
      const newAmount = currentAmount + '.';
      setCurrentAmount(newAmount);
      setDisplayAmount(newAmount);
    }
  };

  // Handle backspace
  const handleBackspace = () => {
    const newAmount = currentAmount.slice(0, -1);
    setCurrentAmount(newAmount);
    setDisplayAmount(newAmount || '0');
  };

  // Clear current amount
  const handleClear = () => {
    setCurrentAmount('');
    setDisplayAmount('0');
  };

  // Clear all tenders (Payment Breakdown)
  const handleClearAllTenders = () => {
    const clearedTenders = {};
    availableTenders.forEach(tender => {
      clearedTenders[tender.id] = 0;
    });
    setTenders(clearedTenders);
    handleClear();
  };

  // Add amount to selected tender
  const handleAdd = () => {
    const amount = parseFloat(currentAmount) || 0;
    if (amount > 0) {
      const now = Date.now();
      const last = lastAddRef.current;

      // Detect duplicate: same tender, same amount, within 10 seconds
      if (last.tenderId === selectedTender && last.amount === amount && (now - last.time) < 10000) {
        const tenderName = availableTenders.find(t => t.id === selectedTender)?.name || 'this tender';
        setDuplicateWarning(`${formatNaira(amount)} was already added to ${tenderName}. Added again.`);
        setTimeout(() => setDuplicateWarning(''), 4000);
      } else {
        setDuplicateWarning('');
      }

      lastAddRef.current = { tenderId: selectedTender, amount, time: now };

      setTenders(prev => ({
        ...prev,
        [selectedTender]: prev[selectedTender] + amount
      }));
      handleClear();
    }
  };

  // Remove last tender entry for selected type (simple undo)
  const handleRemoveLastTender = () => {
    setTenders(prev => ({
      ...prev,
      [selectedTender]: Math.max(0, prev[selectedTender] - (parseFloat(currentAmount) || 1))
    }));
  };

  // Handle confirm
  const handleConfirm = async () => {
    if (isPaymentComplete && !isProcessing) {
      setIsProcessing(true); // Prevent double-click
      try {
      // Find the selected tender object to get the name
      const selectedTenderObj = availableTenders.find(t => t.id === selectedTender || t._id === selectedTender);
      const tenderName = selectedTenderObj?.name || selectedTender;
      
      // Convert tenders object from ID keys to name keys
      const tendersWithNames = {};
      Object.entries(tenders).forEach(([tenderId, amount]) => {
        const tender = availableTenders.find(t => t.id === tenderId || t._id === tenderId);
        const name = tender?.name || tenderId;
        tendersWithNames[name] = amount;
      });
      
      console.log('💳 Payment confirmed with tenderType:', tenderName);
      console.log('💳 Tenders breakdown:', tendersWithNames);
      
      // NEW: Build split payment array for multiple tender support
      const tenderPayments = [];
      Object.entries(tenders).forEach(([tenderId, amount]) => {
        if (parseFloat(amount) > 0) {
          const tender = availableTenders.find(t => t.id === tenderId || t._id === tenderId);
          tenderPayments.push({
            tenderId: tender?.id || tenderId,
            tenderName: tender?.name || tenderId,
            amount: parseFloat(amount)
          });
        }
      });
      
      // If split payment is used, send tenderPayments; otherwise use legacy tenderType
      await Promise.resolve(onConfirm({
        tenderType: tenderName,           // Legacy: primary tender name
        tenderPayments: tenderPayments,    // New: array of split payments
        tenders: tendersWithNames,         // Breakdown by name
        totalPaid: totalPaid,
        change: change,
        amountPaid: totalPaid,
      }));
      } finally {
        setIsProcessing(false);
      }
    }
  };

  if (loading) {
    const loadingContent = (
      <div className="bg-gradient-to-br from-cyan-600 to-cyan-700 rounded-xl shadow-2xl p-8 text-center w-full max-w-md">
        {/* Logo */}
        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg overflow-hidden">
          <Image 
            src={getStoreLogo()} 
            alt="Store Logo" 
            width={72}
            height={72}
            className="object-contain"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = '/images/placeholder.jpg';
            }}
            unoptimized
          />
        </div>

        {/* Loading Text */}
        <p className="text-white font-bold text-lg mb-2">Loading Payment Methods</p>
        <p className="text-cyan-100 text-sm mb-6 font-medium">Fetching available tenders...</p>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-cyan-300 to-green-300 rounded-full animate-pulse shadow-lg"
              style={{ width: '60%' }}
            />
          </div>
        </div>
      </div>
    );

    return inline ? loadingContent : (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        {loadingContent}
      </div>
    );
  }

  if (error || availableTenders.length === 0) {
    // NOTE: Do NOT auto-redirect - let user close modal and handle login through Layout
    // The Layout component will show StaffLogin when staff is null

    const errorContent = (
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full p-6">
          {error && <p className="text-red-600 font-semibold mb-4">Error: {error}</p>}
          {!error && availableTenders.length === 0 && !loading && (
            <>
              <div className="flex items-start gap-3 mb-4">
                <span className="text-3xl">⚠️</span>
                <div>
                  <p className="text-red-600 font-semibold text-lg">No Payment Methods Configured</p>
                  <p className="text-gray-600 text-sm mt-1">
                    Location: <span className="font-medium">{location?.name || 'Unknown'}</span>
                  </p>
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
                <p className="text-blue-900 text-sm font-semibold mb-3">📋 To Enable Payment Methods:</p>
                <ol className="text-blue-800 text-sm list-decimal list-inside space-y-2">
                  <li>Go to <span className="bg-blue-100 px-2 py-1 rounded">Settings → Location Tenders & Categories</span></li>
                  <li>Select <span className="font-medium">&quot;{location?.name}&quot;</span> from the location dropdown</li>
                  <li>Check the payment methods you want to enable (Cash, Card, Mobile Money, etc.)</li>
                  <li>Return to POS and try processing a transaction again</li>
                </ol>
              </div>
              <p className="text-gray-600 text-xs">
                💡 Contact your inventory manager if you need help assigning payment methods to this location.
              </p>
            </>
          )}
          <button
            onClick={onCancel}
            className="mt-6 w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Close
          </button>
      </div>
    );

    return inline ? errorContent : (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        {errorContent}
      </div>
    );
  }

  const paymentContent = (
    <div className={`${inline ? 'bg-white rounded-xl border border-neutral-200 shadow-lg w-full' : 'bg-white rounded-xl shadow-2xl max-w-4xl w-full h-[calc(100vh-1rem)]'} flex flex-col overflow-hidden relative z-50 ${contentSizeClass}`}>

        {/* Main Content — 2 column: summary | numpad+tenders */}
        <div className="flex-1 p-2 sm:p-3 grid grid-cols-[minmax(160px,1fr)_2.2fr] gap-2 sm:gap-3 overflow-hidden">

          {/* LEFT: Payment Summary */}
          <div className="space-y-2 overflow-y-auto">
            {/* Total Due */}
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-2.5">
              <p className="text-[10px] text-gray-500 font-semibold uppercase">Total Due</p>
              <p className="text-lg font-black text-gray-800">{formatNaira(total)}</p>
            </div>

            {/* Amount Paid */}
            <div className={`rounded-lg p-2.5 border ${isPaymentComplete ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-300' : 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-300'}`}>
              <p className={`text-[10px] font-semibold uppercase ${isPaymentComplete ? 'text-green-600' : 'text-orange-600'}`}>Amount Paid</p>
              <p className={`text-lg font-black ${isPaymentComplete ? 'text-green-700' : 'text-orange-700'}`}>{formatNaira(totalPaid)}</p>
            </div>

            {/* Change or Remaining */}
            {isPaymentComplete ? (
              <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-300 rounded-lg p-2.5">
                <p className="text-[10px] text-cyan-600 font-semibold uppercase">Change Due</p>
                <p className="text-lg font-black text-cyan-700">{formatNaira(change)}</p>
              </div>
            ) : totalPaid > 0 ? (
              <div className="bg-gradient-to-br from-red-50 to-red-100 border border-red-300 rounded-lg p-2.5">
                <p className="text-[10px] text-red-600 font-semibold uppercase">Still Needed</p>
                <p className="text-lg font-black text-red-700">{formatNaira(total - totalPaid)}</p>
              </div>
            ) : null}

            {/* Payment Breakdown */}
            <div className="bg-white border border-gray-200 rounded-lg p-2.5">
              <div className="flex justify-between items-center mb-1.5">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Breakdown</p>
                {Object.values(tenders).some(v => v > 0) && (
                  <button onClick={handleClearAllTenders} className="text-[10px] px-1.5 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold rounded transition-all">
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {availableTenders.map(tender => (
                  tenders[tender.id] > 0 && (
                    <div key={tender.id} className="flex justify-between items-center text-xs">
                      <span className="text-gray-700 font-medium">{tender.name}</span>
                      <span className="font-bold text-cyan-700">{formatNaira(tenders[tender.id])}</span>
                    </div>
                  )
                ))}
                {Object.values(tenders).every(v => v === 0) && (
                  <p className="text-gray-400 text-[10px] text-center py-1">No payments yet</p>
                )}
              </div>
            </div>

            {/* Confirm / Cancel */}
            <div className="space-y-1.5 pt-1">
              <button
                onClick={handleConfirm}
                disabled={!isPaymentComplete || isProcessing}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all active:scale-[0.98] ${
                  isPaymentComplete && !isProcessing
                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg'
                    : 'bg-gray-200 cursor-not-allowed text-gray-400'
                }`}
              >
                <FontAwesomeIcon icon={faCheckCircle} className="w-4 h-4" />
                {isProcessing ? 'Processing...' : 'Confirm'}
              </button>
              {onCancel && (
                <button onClick={onCancel} className="w-full py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold text-xs text-gray-600 transition-all active:scale-[0.98]">
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* RIGHT: Numpad + Tenders */}
          <div className="flex flex-col gap-2 min-h-0">

            {/* Amount Display Row */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearAllTenders}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 transition-all active:scale-95 whitespace-nowrap"
              >
                Tenders
              </button>
              <div className="flex-1 bg-white border-2 border-gray-200 rounded-lg px-3 py-2 text-right">
                <p className="text-2xl sm:text-3xl font-black text-gray-800 font-mono tracking-tight">
                  ₦{Number(displayAmount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Duplicate Warning */}
            {duplicateWarning && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 flex items-center gap-2">
                <span className="text-amber-600 text-xs">⚠️</span>
                <p className="text-amber-700 text-[10px] font-semibold flex-1">{duplicateWarning}</p>
                <button onClick={() => setDuplicateWarning('')} className="text-amber-400 text-xs font-bold">✕</button>
              </div>
            )}

            {/* Numpad + Quick Amounts */}
            <div className="flex-1 grid grid-cols-[3fr_1fr] gap-1.5 min-h-0">
              {/* Numpad 3x4 */}
              <div className="grid grid-cols-3 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                  <button
                    key={num}
                    onClick={() => handleNumberClick(num)}
                    className={`bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg font-bold transition-all active:scale-95 active:bg-cyan-50 ${keypadButtonClass}`}
                  >
                    {num}
                  </button>
                ))}
                <button onClick={handleDecimal} className={`bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg font-bold transition-all active:scale-95 ${keypadButtonClass}`}>.</button>
                <button onClick={() => handleNumberClick(0)} className={`bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg font-bold transition-all active:scale-95 ${keypadButtonClass}`}>0</button>
                <button onClick={handleBackspace} className={`bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg font-bold transition-all active:scale-95 flex items-center justify-center ${keypadButtonClass}`}>
                  <FontAwesomeIcon icon={faBackspace} className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* Quick Amounts Column */}
              <div className="flex flex-col gap-1.5">
                {[500, 1000, 2000, 5000, 10000, 20000, 50000]
                  .filter(amount => quickAmountSettings[amount] !== false)
                  .slice(0, 4)
                  .map(amount => (
                  <button
                    key={amount}
                    onClick={() => { setCurrentAmount(amount.toString()); setDisplayAmount(amount.toString()); }}
                    className="flex-1 bg-white hover:bg-cyan-50 border-2 border-cyan-200 hover:border-cyan-400 rounded-lg text-xs sm:text-sm font-bold text-cyan-700 transition-all active:scale-95"
                  >
                    ₦{amount >= 1000 ? `${amount / 1000}K` : amount}
                  </button>
                ))}
              </div>
            </div>

            {/* Pay By — Tender Cards */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase">Pay By</p>
                <div className="flex-1 border-t border-gray-200"></div>
              </div>
              <div className="flex gap-2">
                {availableTenders.map(tender => {
                  const hasAmount = tenders[tender.id] > 0;
                  const btnColor = tender.buttonColor || '#0891b2';
                  const isCashLike = tender.classification === 'Cash' || tender.name.toLowerCase() === 'cash';
                  return (
                    <button
                      key={tender.id}
                      onClick={() => {
                        const amount = parseFloat(currentAmount) || 0;
                        if (amount > 0) {
                          const now = Date.now();
                          const last = lastAddRef.current;
                          if (last.tenderId === tender.id && last.amount === amount && (now - last.time) < 10000) {
                            setDuplicateWarning(`${formatNaira(amount)} was already added to ${tender.name}. Added again.`);
                            setTimeout(() => setDuplicateWarning(''), 4000);
                          } else {
                            setDuplicateWarning('');
                          }
                          lastAddRef.current = { tenderId: tender.id, amount, time: now };
                          setTenders(prev => ({ ...prev, [tender.id]: prev[tender.id] + amount }));
                          setSelectedTender(tender.id);
                          handleClear();
                        } else {
                          setSelectedTender(tender.id);
                        }
                      }}
                      className={`flex-1 py-2.5 px-2 rounded-lg font-bold text-xs sm:text-sm transition-all active:scale-[0.97] border-2 ${
                        isCashLike && !hasAmount
                          ? 'bg-white border-cyan-300 text-cyan-700 hover:bg-cyan-50'
                          : 'text-white hover:opacity-90'
                      }`}
                      style={isCashLike && !hasAmount ? {} : { backgroundColor: btnColor, borderColor: btnColor }}
                    >
                      <div className="truncate">{tender.name}</div>
                      {hasAmount && (
                        <div className={`text-[10px] mt-0.5 font-semibold ${isCashLike && !hasAmount ? 'text-cyan-500' : 'text-white/80'}`}>
                          {formatNaira(tenders[tender.id])}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
    </div>
  );

  return inline ? paymentContent : (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
      {paymentContent}
    </div>
  );
}
