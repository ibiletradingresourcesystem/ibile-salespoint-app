/**
 * UnsyncedDataModal — Full-height overlay showing all unsynced/pending data
 *
 * Reads directly from IndexedDB so it works fully offline.
 * Displays: pending transactions, pending till opens, pending till closes.
 */

import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTimes,
  faSync,
  faExclamationTriangle,
  faReceipt,
  faCashRegister,
  faLock,
  faWifi,
  faCheckCircle,
} from "@fortawesome/free-solid-svg-icons";
import {
  getAllPendingData,
  syncPendingTransactions,
  syncPendingTillOpens,
  syncPendingTillCloses,
  syncPendingTransactionById,
  resolvePendingTransaction,
} from "@/src/lib/offlineSync";

export default function UnsyncedDataModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [data, setData] = useState({ transactions: [], tillOpens: [], tillCloses: [] });
  const [activeTab, setActiveTab] = useState("transactions");
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [tenderMap, setTenderMap] = useState({});
  const [locationMap, setLocationMap] = useState({});
  const [activeTransactionId, setActiveTransactionId] = useState(null);
  const [actionError, setActionError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const pending = await getAllPendingData();
      setData(pending);

      // Build tender ID → name map from localStorage cache
      const map = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith("tenders_")) {
            const tenders = JSON.parse(localStorage.getItem(key));
            if (Array.isArray(tenders)) {
              tenders.forEach((t) => {
                if (t.id || t._id) map[t.id || t._id] = t.name;
              });
            }
          }
        }
      } catch (e) {}
      setTenderMap(map);

      // Build location ID → name map from cached locations
      const locMap = {};
      try {
        const cachedLocs = localStorage.getItem("cachedLocations");
        if (cachedLocs) {
          const locs = JSON.parse(cachedLocs);
          if (Array.isArray(locs)) {
            locs.forEach((loc) => {
              if (loc._id) locMap[loc._id] = loc.name;
              if (loc.id) locMap[loc.id] = loc.name;
            });
          }
        }
      } catch (e) {}
      setLocationMap(locMap);
    } catch (e) {
      console.error("Failed to load pending data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const totalPending = data.transactions.length + data.tillOpens.length + data.tillCloses.length;

  const handleSyncNow = async () => {
    if (!isOnline) return;
    setSyncing(true);
    setActionError("");
    try {
      await syncPendingTillOpens();
      await syncPendingTransactions({ forceRetry: true });
      await syncPendingTillCloses();
      await loadData();
    } catch (e) {
      console.error("Sync failed:", e);
    } finally {
      setSyncing(false);
    }
  };

  const getSessionSnapshot = () => {
    try {
      return {
        staff: JSON.parse(localStorage.getItem("staff") || "null"),
        till: JSON.parse(localStorage.getItem("till") || "null"),
      };
    } catch {
      return { staff: null, till: null };
    }
  };

  const handleSyncTransaction = async (tx) => {
    const transactionId = tx?.id;
    if (!transactionId || !isOnline) return;

    setActionError("");
    setActiveTransactionId(String(transactionId));
    try {
      await syncPendingTillOpens();
      const result = await syncPendingTransactionById(transactionId);
      await syncPendingTillCloses();

      if (!result?.success) {
        setActionError(
          result?.reason === "till-not-mapped"
            ? "Till mapping is still not recoverable for that transaction. Use Resolve only if the sale was already handled."
            : "That transaction could not be synced yet. Check the connection and try again."
        );
      }

      await loadData();
    } catch (e) {
      console.error("Transaction sync failed:", e);
      setActionError("That transaction could not be synced yet. Check the connection and try again.");
    } finally {
      setActiveTransactionId(null);
    }
  };

  const handleResolveTransaction = async (tx) => {
    const transactionId = tx?.id;
    if (!transactionId) return;

    const { staff, till } = getSessionSnapshot();
    setActionError("");
    setActiveTransactionId(String(transactionId));
    try {
      const result = await resolvePendingTransaction(transactionId, {
        type: "previous-till",
        note: "Resolved from Help/Chat Unsynced Data after offline till recovery was reviewed.",
        tillId: till?._id || null,
        staffId: staff?._id || null,
        staffName: staff?.name || staff?.fullName || null,
        staffRole: staff?.role || null,
      });

      if (!result?.success) {
        setActionError("That transaction could not be resolved. Reload the panel and try again.");
      }

      await loadData();
    } catch (e) {
      console.error("Transaction resolve failed:", e);
      setActionError("That transaction could not be resolved. Reload the panel and try again.");
    } finally {
      setActiveTransactionId(null);
    }
  };

  const formatDate = (d) => {
    if (!d) return "—";
    try {
      const date = new Date(d);
      return date.toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    } catch { return String(d); }
  };

  const formatNaira = (amount) =>
    `₦${(Number(amount) || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!isOpen) return null;

  const tabs = [
    { key: "transactions", label: "Transactions", icon: faReceipt, count: data.transactions.length, color: "text-primary-400" },
    { key: "tillOpens", label: "Till Opens", icon: faCashRegister, count: data.tillOpens.length, color: "text-blue-400" },
    { key: "tillCloses", label: "Till Closes", icon: faLock, count: data.tillCloses.length, color: "text-red-400" },
  ];

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-end bg-black/40 backdrop-blur-[2px]">
      {/* Backdrop click to close */}
      <div className="flex-1" onClick={onClose} />

      {/* Panel — right side, full height, matching keypad width */}
      <div className="w-full max-w-md bg-gradient-to-b from-slate-900 to-slate-800 shadow-2xl flex flex-col overflow-hidden border-l border-primary-700/40">
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faExclamationTriangle} className="w-5 h-5 text-white" />
            <div>
              <h2 className="text-white font-bold text-sm">Unsynced Data</h2>
              <p className="text-primary-100 text-[10px]">{totalPending} pending item{totalPending !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Network status */}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${
              isOnline ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"
            }`}>
              <FontAwesomeIcon icon={faWifi} className="w-3 h-3" />
              {isOnline ? "Online" : "Offline"}
            </span>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded hover:bg-white/20 flex items-center justify-center transition"
            >
              <FontAwesomeIcon icon={faTimes} className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* Sync Now button */}
        <div className="px-4 py-2 border-b border-slate-700">
          <button
            onClick={handleSyncNow}
            disabled={!isOnline || syncing || totalPending === 0}
            className="w-full py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed bg-primary-600 hover:bg-primary-500 text-white"
          >
            <FontAwesomeIcon icon={faSync} className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : !isOnline ? "Offline — Sync unavailable" : "Sync Now"}
          </button>
          {actionError && (
            <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] font-medium text-amber-200">
              {actionError}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5 transition border-b-2 ${
                activeTab === tab.key
                  ? "border-primary-400 text-white bg-slate-700/50"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <FontAwesomeIcon icon={tab.icon} className={`w-3 h-3 ${tab.color}`} />
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-primary-500/80 text-white text-[9px] rounded-full font-bold min-w-[18px] text-center">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              <FontAwesomeIcon icon={faSync} className="w-5 h-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : totalPending === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <FontAwesomeIcon icon={faCheckCircle} className="w-10 h-10 text-green-400 mb-3" />
              <p className="text-green-300 font-bold text-sm">All Data Synced!</p>
              <p className="text-slate-400 text-xs mt-1">No pending items to sync.</p>
            </div>
          ) : (
            <>
              {/* Transactions */}
              {activeTab === "transactions" && (
                data.transactions.length === 0 ? (
                  <p className="text-center text-slate-500 text-xs py-6">No pending transactions</p>
                ) : (
                  data.transactions.map((tx, idx) => {
                    const transactionId = String(tx.id || tx.externalId || tx.clientId || idx);
                    const isActing = activeTransactionId === String(tx.id);
                    const tillLabel = tx.originalOfflineTillId || tx.tillId || "—";
                    const hasOfflineTill = String(tillLabel).startsWith("offline-till-");

                    return (
                    <div key={transactionId} className="bg-slate-800/80 border border-slate-700 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-mono">{tx.externalId || tx.clientId || `#${tx.id}`}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          tx.status === "completed" ? "bg-green-600/30 text-green-300"
                            : tx.status === "held" ? "bg-yellow-600/30 text-yellow-300"
                            : tx.status === "refunded" ? "bg-red-600/30 text-red-300"
                            : "bg-slate-600/30 text-slate-300"
                        }`}>{tx.status || "completed"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-white font-bold text-sm">{formatNaira(tx.total)}</span>
                        <span className="text-slate-400 text-[10px]">{tx.items?.length || 0} item{(tx.items?.length || 0) !== 1 ? "s" : ""}</span>
                      </div>
                      {/* Items list */}
                      {tx.items && tx.items.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {tx.items.slice(0, 5).map((item, i) => (
                            <div key={i} className="flex justify-between text-[10px] text-slate-300">
                              <span className="truncate max-w-[60%]">{item.name || item.productName || "Item"}</span>
                              <span>{item.quantity || 1} × {formatNaira(item.price || item.unitPrice || 0)}</span>
                            </div>
                          ))}
                          {tx.items.length > 5 && (
                            <p className="text-[9px] text-slate-500 italic">+{tx.items.length - 5} more items</p>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-700/50 mt-1">
                        <span className="text-[10px] text-slate-400">
                          {tx.staffName || "POS Staff"} · {tx.location || "—"}
                        </span>
                        <span className="text-[10px] text-slate-500">{formatDate(tx.createdAt || tx.timestamp)}</span>
                      </div>
                      {/* Payment info */}
                      {tx.paymentMethod && (
                        <div className="text-[10px] text-slate-400">
                          Payment: <span className="text-slate-300 font-medium">{tx.paymentMethod}</span>
                          {tx.amountPaid ? ` · Paid ${formatNaira(tx.amountPaid)}` : ""}
                          {tx.change > 0 ? ` · Change ${formatNaira(tx.change)}` : ""}
                        </div>
                      )}
                      {tx.attempts > 0 && (
                        <span className="text-[9px] text-amber-400">⚠ {tx.attempts} sync attempt{tx.attempts !== 1 ? "s" : ""} failed</span>
                      )}
                      <div className="text-[10px] text-slate-400">
                        Till: <span className="font-mono text-slate-300">{tillLabel}</span>
                      </div>
                      {hasOfflineTill && (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-medium text-amber-200">
                          Offline till is not mapped yet. Sync Sale will recover the sale even if the old till cannot be registered.
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          onClick={() => handleSyncTransaction(tx)}
                          disabled={!isOnline || syncing || isActing || !tx.id}
                          className="rounded-md bg-primary-600 px-2 py-1.5 text-[11px] font-bold text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-400"
                        >
                          {isActing ? "Working..." : isOnline ? "Sync Sale" : "Offline"}
                        </button>
                        <button
                          onClick={() => handleResolveTransaction(tx)}
                          disabled={syncing || isActing || !tx.id}
                          className="rounded-md bg-amber-500 px-2 py-1.5 text-[11px] font-bold text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-400"
                        >
                          {isActing ? "Working..." : "Resolve"}
                        </button>
                      </div>
                    </div>
                    );
                  })
                )
              )}

              {/* Till Opens */}
              {activeTab === "tillOpens" && (
                data.tillOpens.length === 0 ? (
                  <p className="text-center text-slate-500 text-xs py-6">No pending till opens</p>
                ) : (
                  data.tillOpens.map((t, idx) => (
                    <div key={t._id || idx} className="bg-slate-800/80 border border-slate-700 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-mono">{t._id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-600/30 text-blue-300">Till Open</span>
                      </div>
                      <div className="space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Staff:</span>
                          <span className="text-white font-medium">{t.staffName || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Location:</span>
                          <span className="text-white font-medium">{t.locationName || locationMap[t.locationId] || t.locationId || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Opening Balance:</span>
                          <span className="text-green-300 font-bold">{formatNaira(t.openingBalance)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Saved At:</span>
                          <span className="text-slate-300">{formatDate(t.savedAt)}</span>
                        </div>
                      </div>
                      {t.serverTillId && (
                        <div className="text-[9px] text-green-400">✓ Mapped to server: {t.serverTillId}</div>
                      )}
                    </div>
                  ))
                )
              )}

              {/* Till Closes */}
              {activeTab === "tillCloses" && (
                data.tillCloses.length === 0 ? (
                  <p className="text-center text-slate-500 text-xs py-6">No pending till closes</p>
                ) : (
                  data.tillCloses.map((t, idx) => (
                    <div key={t._id || idx} className="bg-slate-800/80 border border-slate-700 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-mono">{t._id}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-600/30 text-red-300">Till Close</span>
                      </div>
                      {/* Summary */}
                      {t.summary && (
                        <div className="space-y-1 text-[11px]">
                          {t.summary.totalSales !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-slate-400">Total Sales:</span>
                              <span className="text-white font-bold">{formatNaira(t.summary.totalSales)}</span>
                            </div>
                          )}
                          {t.summary.transactionCount !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-slate-400">Transactions:</span>
                              <span className="text-white">{t.summary.transactionCount}</span>
                            </div>
                          )}
                          {t.summary.expectedCash !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-slate-400">Expected Cash:</span>
                              <span className="text-white">{formatNaira(t.summary.expectedCash)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Tender counts */}
                      {t.tenderCounts && Object.keys(t.tenderCounts).length > 0 && (
                        <div className="mt-1 pt-1 border-t border-slate-700/50">
                          <p className="text-[10px] text-slate-400 mb-0.5">Counted:</p>
                          <div className="space-y-0.5">
                            {Object.entries(t.tenderCounts).map(([key, val]) => (
                              <div key={key} className="flex justify-between text-[10px]">
                                <span className="text-slate-300 capitalize">{tenderMap[key] || key}:</span>
                                <span className="text-white font-medium">{formatNaira(val)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {t.closingNotes && (
                        <div className="text-[10px] text-slate-400 mt-1 italic">
                          Note: {t.closingNotes}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700/50 mt-1">
                        {formatDate(t.savedAt)}
                      </div>
                    </div>
                  ))
                )
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-700 bg-slate-900/80 text-center">
          <p className="text-[10px] text-slate-500">
            Data is stored locally in IndexedDB and syncs automatically when a stable connection is available.
          </p>
        </div>
      </div>
    </div>
  );
}
