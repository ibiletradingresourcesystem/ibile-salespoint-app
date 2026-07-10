/**
 * ClockInOutModal - Staff clock in/out system
 * 
 * Allows staff to clock in/out from the login page.
 * Shows current clock status and recent history.
 */

import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClock,
  faTimes,
  faSignInAlt,
  faSignOutAlt,
  faHistory,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';

export default function ClockInOutModal({ isOpen, onClose, staff, locations, selectedLocation }) {
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [clockStatus, setClockStatus] = useState(null); // { isClockedIn, lastRecord, records }
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const fetchClockStatus = useCallback(async (staffId) => {
    if (!staffId) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/staff/clock?staffId=${staffId}&date=${today}`);
      if (res.ok) {
        const data = await res.json();
        setClockStatus(data);
      } else {
        setClockStatus(null);
      }
    } catch (err) {
      console.warn('Failed to fetch clock status:', err);
      setClockStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && selectedStaffId) {
      fetchClockStatus(selectedStaffId);
    }
  }, [isOpen, selectedStaffId, fetchClockStatus]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedStaffId('');
      setClockStatus(null);
      setMessage('');
      setError('');
      setPin('');
      setShowHistory(false);
    }
  }, [isOpen]);

  const handleClockAction = async (type) => {
    if (!selectedStaffId) {
      setError('Please select a staff member');
      return;
    }

    setActionLoading(true);
    setError('');
    setMessage('');

    try {
      const location = locations?.find((l) => l._id === selectedLocation);
      const res = await fetch('/api/staff/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: selectedStaffId,
          type,
          locationId: selectedLocation || undefined,
          locationName: location?.name || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setMessage(`${data.staffName} clocked ${type} successfully at ${new Date(data.record.timestamp).toLocaleTimeString()}`);
        await fetchClockStatus(selectedStaffId);
      } else {
        setError(data.message || `Failed to clock ${type}`);
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (ts) => {
    return new Date(ts).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-700 to-cyan-800 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faClock} className="w-5 h-5" />
            <h2 className="font-bold text-lg">Clock In / Out</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition"
          >
            <FontAwesomeIcon icon={faTimes} className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Staff Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Select Staff Member</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-40 overflow-y-auto">
              {(staff || []).map((member) => (
                <button
                  key={member._id}
                  onClick={() => {
                    setSelectedStaffId(member._id);
                    setMessage('');
                    setError('');
                  }}
                  className={`p-2 rounded-lg text-center transition text-xs font-semibold ${
                    selectedStaffId === member._id
                      ? 'bg-cyan-600 text-white ring-2 ring-cyan-400 shadow'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-1 text-sm font-bold ${
                    selectedStaffId === member._id ? 'bg-white text-cyan-700' : 'bg-gray-300 text-gray-600'
                  }`}>
                    {member.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  {member.name}
                </button>
              ))}
            </div>
          </div>

          {/* Clock Status */}
          {selectedStaffId && (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              {loading ? (
                <div className="flex items-center justify-center py-4 text-gray-500">
                  <FontAwesomeIcon icon={faSpinner} className="w-5 h-5 animate-spin mr-2" />
                  Loading status...
                </div>
              ) : clockStatus ? (
                <div className="text-center space-y-3">
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm ${
                    clockStatus.isClockedIn
                      ? 'bg-green-100 text-green-800 border border-green-300'
                      : 'bg-gray-200 text-gray-700 border border-gray-300'
                  }`}>
                    <span className={`w-2.5 h-2.5 rounded-full ${clockStatus.isClockedIn ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                    {clockStatus.isClockedIn ? 'Clocked In' : 'Clocked Out'}
                  </div>

                  {clockStatus.lastRecord && (
                    <p className="text-xs text-gray-500">
                      Last: {clockStatus.lastRecord.type === 'in' ? 'Clocked in' : 'Clocked out'} at{' '}
                      {formatTime(clockStatus.lastRecord.timestamp)}
                      {clockStatus.lastRecord.locationName && ` @ ${clockStatus.lastRecord.locationName}`}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => handleClockAction('in')}
                      disabled={actionLoading || clockStatus.isClockedIn}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow"
                    >
                      <FontAwesomeIcon icon={faSignInAlt} className="w-4 h-4" />
                      Clock In
                    </button>
                    <button
                      onClick={() => handleClockAction('out')}
                      disabled={actionLoading || !clockStatus.isClockedIn}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow"
                    >
                      <FontAwesomeIcon icon={faSignOutAlt} className="w-4 h-4" />
                      Clock Out
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-3">
                  <p className="text-sm text-gray-500">Could not load clock status. You may be offline.</p>
                  <div className="flex gap-3 pt-3">
                    <button
                      onClick={() => handleClockAction('in')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition disabled:opacity-50 shadow"
                    >
                      <FontAwesomeIcon icon={faSignInAlt} className="w-4 h-4" />
                      Clock In
                    </button>
                    <button
                      onClick={() => handleClockAction('out')}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition disabled:opacity-50 shadow"
                    >
                      <FontAwesomeIcon icon={faSignOutAlt} className="w-4 h-4" />
                      Clock Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {message && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm font-semibold">
              ✅ {message}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm font-semibold">
              {error}
            </div>
          )}

          {/* History Toggle */}
          {selectedStaffId && clockStatus?.records?.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 text-sm text-cyan-600 hover:text-cyan-700 font-semibold"
              >
                <FontAwesomeIcon icon={faHistory} className="w-3.5 h-3.5" />
                {showHistory ? 'Hide' : 'Show'} Today&apos;s History ({clockStatus.records.length} records)
              </button>

              {showHistory && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {clockStatus.records.map((record, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between px-3 py-2 rounded text-xs ${
                        record.type === 'in'
                          ? 'bg-green-50 text-green-800'
                          : 'bg-red-50 text-red-800'
                      }`}
                    >
                      <span className="font-semibold">
                        {record.type === 'in' ? '➡️ Clock In' : '⬅️ Clock Out'}
                      </span>
                      <span>{formatTime(record.timestamp)}</span>
                      {record.locationName && (
                        <span className="text-gray-500">@ {record.locationName}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-xl transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
