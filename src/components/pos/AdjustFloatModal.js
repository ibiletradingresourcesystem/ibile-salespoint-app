/**
 * AdjustFloatModal Component
 * 
 * Modal to add additional cash to the till's opening balance (startup funds).
 * This tops up the float without creating a transaction.
 * Redesigned with consistent system styling and better button feedback.
 */

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faX, faPlus, faMinus, faCoins } from '@fortawesome/free-solid-svg-icons';
import { useStaff } from '../../context/StaffContext';

export default function AdjustFloatModal({ isOpen, onClose }) {
  const { till, setCurrentTill } = useStaff();
  const [amount, setAmount] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("add"); // 'add' or 'remove'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleAdjustFloat = async (e) => {
    e.preventDefault();
    
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const adjustmentAmount = adjustmentType === "add" 
        ? parseFloat(amount) 
        : -parseFloat(amount);

      const response = await fetch(`/api/till/${till._id}/adjust-float`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          adjustmentAmount: adjustmentAmount,
          reason: adjustmentType === "add" ? "Cash added to float" : "Cash removed from float"
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Failed to adjust float");
        return;
      }

      const actionText = adjustmentType === "add" ? "added to" : "removed from";
      setSuccess(`₦${parseFloat(amount).toFixed(2)} ${actionText} float`);
      setAmount("");
      
      // Update till in context with the new opening balance
      if (data.till) {
        setCurrentTill({
          ...till,
          openingBalance: data.till.openingBalance,
        });
      }

      // Close after 1.5 seconds
      setTimeout(() => {
        onClose();
        setSuccess("");
      }, 1500);
    } catch (err) {
      console.error("Error adjusting float:", err);
      setError("Failed to adjust float");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAmount = (quickAmount) => {
    setAmount(quickAmount.toString());
    setError("");
  };

  if (!isOpen) return null;

  const currentFloat = till?.openingBalance || 0;
  const adjustedAmount = parseFloat(amount) || 0;
  const newBalance = adjustmentType === "add" 
    ? currentFloat + adjustedAmount 
    : currentFloat - adjustedAmount;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-600 to-cyan-700 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <FontAwesomeIcon icon={faCoins} className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Adjust Float</h2>
              <p className="text-cyan-100 text-sm">Add or remove cash from till</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors active:scale-95"
          >
            <FontAwesomeIcon icon={faX} className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {/* Current Float Display */}
          <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 border-2 border-cyan-300 rounded-xl p-5 mb-6">
            <p className="text-sm text-cyan-700 font-semibold mb-1">Current Opening Balance</p>
            <p className="text-3xl font-bold text-cyan-800">
              ₦{currentFloat.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          {/* Adjustment Type Toggle */}
          <div className="flex gap-2 mb-5">
            <button
              type="button"
              onClick={() => { setAdjustmentType("add"); setError(""); }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2
                ${adjustmentType === "add" 
                  ? "bg-green-600 text-white shadow-lg scale-[1.02]" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }
                active:scale-95
              `}
            >
              <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
              Add Cash
            </button>
            <button
              type="button"
              onClick={() => { setAdjustmentType("remove"); setError(""); }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2
                ${adjustmentType === "remove" 
                  ? "bg-red-600 text-white shadow-lg scale-[1.02]" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }
                active:scale-95
              `}
            >
              <FontAwesomeIcon icon={faMinus} className="w-4 h-4" />
              Remove Cash
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleAdjustFloat} className="space-y-5">
            {/* Amount Input */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Amount to {adjustmentType === "add" ? "Add" : "Remove"}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-lg">₦</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError("");
                  }}
                  placeholder="0.00"
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 border-gray-300 rounded-xl focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 disabled:bg-gray-100 disabled:cursor-not-allowed transition-all"
                  autoFocus
                />
              </div>
            </div>

            {/* Quick Amount Buttons */}
            <div className="grid grid-cols-4 gap-2">
              {[500, 1000, 2000, 5000].map((quickAmount) => (
                <button
                  key={quickAmount}
                  type="button"
                  onClick={() => handleQuickAmount(quickAmount)}
                  disabled={loading}
                  className="py-2 px-3 bg-gray-100 hover:bg-cyan-100 text-gray-700 font-semibold rounded-lg border-2 border-gray-200 hover:border-cyan-300 transition-all active:scale-95 disabled:opacity-50"
                >
                  ₦{quickAmount.toLocaleString()}
                </button>
              ))}
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-700">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="bg-green-50 border-2 border-green-300 rounded-xl p-4">
                <p className="text-sm font-semibold text-green-700">✓ {success}</p>
              </div>
            )}

            {/* New Balance Preview */}
            {amount && !error && parseFloat(amount) > 0 && (
              <div className={`rounded-xl p-4 border-2 ${
                adjustmentType === "add" 
                  ? "bg-green-50 border-green-300" 
                  : "bg-orange-50 border-orange-300"
              }`}>
                <p className="text-xs text-gray-600 mb-1 font-semibold">New Opening Balance</p>
                <p className={`text-2xl font-bold ${
                  adjustmentType === "add" ? "text-green-700" : "text-orange-700"
                }`}>
                  ₦{newBalance.toLocaleString('en-NG', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                  })}
                </p>
                <p className={`text-xs mt-1 font-semibold ${
                  adjustmentType === "add" ? "text-green-600" : "text-orange-600"
                }`}>
                  {adjustmentType === "add" ? "↑" : "↓"} ₦{adjustedAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 px-4 py-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !amount || isNaN(amount) || parseFloat(amount) <= 0}
                className={`flex-1 px-4 py-4 font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                  adjustmentType === "add"
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              >
                {loading ? "Processing..." : adjustmentType === "add" ? "Add to Float" : "Remove from Float"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
