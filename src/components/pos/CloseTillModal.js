// components/pos/CloseTillModal.js
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import { useStaff } from "../../context/StaffContext";
import { useCart } from "../../context/CartContext";
import { useLocationTenders } from "../../hooks/useLocationTenders";
import { getOnlineStatus, resolveTillId } from "../../lib/offlineSync";
import { getStoreLogo } from "../../lib/logoCache";
import { escapeHtml } from "../../lib/receiptViewModel";
import { getTenderAmount, normalizeTenderBreakdown } from "../../lib/tenderKey";
import { describeTillTerminals, mergeTillTransactions, summarizeTillTransactions } from "../../lib/tillReconciliation";
import { getDeviceId, getDeviceName } from "../../lib/deviceIdentity";
import NumKeypad from "../common/NumKeypad";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCashRegister,
  faDesktop,
  faLock,
  faRightFromBracket,
  faPenToSquare,
  faPrint,
  faRotate,
  faSpinner,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import { getPrintLayout } from "../../lib/printerConfig";
import { buildPrintPageCss, printHtmlDocument } from "../../lib/printDocument";

// Generate and print End-of-Day report
const printEndOfDayReport = (tillData, summaryData, tenderCounts, tenders, closingNotes, locationName) => {
  const formatNaira = (amount) =>
    `₦${(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-NG', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = now.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const openedAt = tillData?.openedAt ? new Date(tillData.openedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'N/A';

  const logo = getStoreLogo();
  const logoAbsolute = logo && logo !== '/images/placeholder.jpg'
    ? (logo.startsWith('http') || logo.startsWith('data:') ? logo : `${window.location.origin}${logo.startsWith('/') ? '' : '/'}${logo}`)
    : '';

  // Build tender reconciliation rows
  const tenderRows = (tenders || []).map(tender => {
    const expected = getTenderAmount(summaryData?.tenderBreakdown, tender.name);
    const physical = parseFloat(tenderCounts?.[tender.id]) || 0;
    const variance = physical - expected;
    return `
      <tr>
        <td style="padding: 2px 0; text-align: left;">${escapeHtml(tender.name)}</td>
        <td style="padding: 2px 0; text-align: right;">${formatNaira(expected)}</td>
        <td style="padding: 2px 0; text-align: right;">${formatNaira(physical)}</td>
        <td style="padding: 2px 0; text-align: right; color: ${variance === 0 ? '#000' : variance > 0 ? '#065f46' : '#991b1b'};">
          ${formatNaira(variance)} ${variance === 0 ? '✓' : variance > 0 ? '↑' : '↓'}
        </td>
      </tr>`;
  }).join('');

  const totalPhysical = (tenders || []).reduce((sum, t) => sum + (parseFloat(tenderCounts?.[t.id]) || 0), 0);
  const totalExpected = (summaryData?.openingBalance || 0) + (summaryData?.totalSales || 0);
  const totalVariance = totalPhysical - totalExpected;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>End of Day Report</title>
  <style>
    ${buildPrintPageCss(getPrintLayout())}
    body {
      font-family: 'Arial', 'Helvetica Neue', sans-serif;
      font-size: 7.5pt;
      line-height: 1.1;
    }
    .report {
      padding: 0;
    }
    .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
    .logo { max-width: 35mm; max-height: 20mm; display: block; margin: 0 auto 2mm auto; filter: grayscale(100%); }
    .title { font-weight: bold; font-size: 9pt; margin: 1mm 0; letter-spacing: 1px; }
    .subtitle { font-size: 7pt; color: #333; }
    .section { margin: 2mm 0; padding: 1mm 0; border-bottom: 1px dashed #000; }
    .section-title { font-weight: bold; font-size: 7.5pt; margin-bottom: 1mm; text-transform: uppercase; }
    .row { display: flex; justify-content: space-between; margin: 0.5mm 0; font-size: 7.5pt; }
    .row-bold { display: flex; justify-content: space-between; margin: 1mm 0; font-weight: bold; font-size: 8.5pt; }
    table { width: 100%; border-collapse: collapse; font-size: 7pt; }
    th { text-align: left; font-weight: bold; padding: 1px 0; border-bottom: 1px solid #000; font-size: 7pt; }
    .notes { font-size: 7pt; font-style: italic; margin: 1mm 0; padding: 1mm; background: #f5f5f5; }
    .footer { text-align: center; font-size: 6.5pt; margin-top: 3mm; padding-top: 2mm; border-top: 2px solid #000; }
  </style>
</head>
<body>
  <div class="print-page">
  <div class="report">
    <div class="header">
      ${logoAbsolute ? `<img src="${escapeHtml(logoAbsolute)}" class="logo" alt="Logo" onerror="this.style.display='none'">` : ''}
      <div class="title">END OF DAY REPORT</div>
      <div class="subtitle">${escapeHtml(locationName || 'Store Location')}</div>
      <div class="subtitle">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</div>
    </div>

    <div class="section">
      <div class="section-title">Till Session</div>
      <div class="row"><span>Opened:</span><span>${escapeHtml(openedAt)}</span></div>
      <div class="row"><span>Closed:</span><span>${escapeHtml(timeStr)}</span></div>
      <div class="row"><span>Staff:</span><span>${escapeHtml(tillData?.staffName || 'N/A')}</span></div>
      <div class="row"><span>Transactions:</span><span>${tillData?.transactionCount || 0}</span></div>
    </div>

    <div class="section">
      <div class="section-title">Financial Summary</div>
      <div class="row"><span>Opening Balance:</span><span>${formatNaira(summaryData?.openingBalance)}</span></div>
      <div class="row"><span>Total Sales:</span><span>${formatNaira(summaryData?.totalSales)}</span></div>
      <div class="row-bold"><span>Expected Closing:</span><span>${formatNaira(totalExpected)}</span></div>
    </div>

    <div class="section">
      <div class="section-title">Tender Reconciliation</div>
      <table>
        <thead>
          <tr>
            <th style="text-align: left;">Tender</th>
            <th style="text-align: right;">Expected</th>
            <th style="text-align: right;">Actual</th>
            <th style="text-align: right;">Var.</th>
          </tr>
        </thead>
        <tbody>
          ${tenderRows}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="row-bold"><span>Total Physical:</span><span>${formatNaira(totalPhysical)}</span></div>
      <div class="row-bold"><span>Total Variance:</span><span style="color: ${totalVariance === 0 ? '#000' : totalVariance > 0 ? '#065f46' : '#991b1b'};">${formatNaira(totalVariance)} ${totalVariance === 0 ? '✓ OK' : totalVariance > 0 ? 'OVER' : 'SHORT'}</span></div>
    </div>

    ${closingNotes ? `<div class="section"><div class="section-title">Notes</div><div class="notes">${escapeHtml(closingNotes)}</div></div>` : ''}

    <div class="footer">
      <div style="font-weight: bold;">— End of Report —</div>
      <div style="margin-top: 1mm;">Printed: ${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</div>
    </div>
  </div>
  <div class="print-end"></div>
  </div>
</body>
</html>`;

  try {
    printHtmlDocument(html);
  } catch (err) {
    console.error('Failed to print end-of-day report:', err);
  }
};


// Helper to get offline till data from IndexedDB
const getOfflineTillData = async (tillId) => {
  try {
    const request = indexedDB.open('SalesPOS', 3);
    const tillIdStr = String(tillId);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const db = event.target.result;
        
        // Get transactions for this till
        const txStore = db.transaction(['transactions'], 'readonly').objectStore('transactions');
        const allTxRequest = txStore.getAll();
        
        allTxRequest.onsuccess = () => {
          const allTransactions = allTxRequest.result || [];
          // Filter transactions for this specific till using string comparison
          const tillTransactions = allTransactions.filter(tx => String(tx.tillId) === tillIdStr);
          const unsyncedCount = tillTransactions.filter(tx => tx.synced !== true).length;

          // Only completed sales count: voids, refunds, held and credit sales are left out
          const { totalSales, transactionCount, tenderBreakdown } = summarizeTillTransactions(
            mergeTillTransactions(null, tillTransactions)
          );

          resolve({
            transactionCount,
            totalSales,
            tenderBreakdown,
            unsyncedCount,
            transactions: tillTransactions,
          });
        };
        
        allTxRequest.onerror = () => reject(allTxRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error getting offline till data:', err);
    return { transactionCount: 0, totalSales: 0, tenderBreakdown: {}, unsyncedCount: 0, transactions: [] };
  }
};

// The cloud's list of this till's transactions (all terminals, with voids) — null when it can't be reached
const getServerTillData = async (tillId) => {
  if (!tillId || String(tillId).startsWith('offline-till-')) return null;
  try {
    const res = await fetch(`/api/till/${tillId}/transactions`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.success ? data : null;
  } catch (err) {
    console.warn('Could not load till transactions from the cloud:', err);
    return null;
  }
};

const getPendingTransactionsForTill = async (tillId) => {
  try {
    const tillIdStr = String(tillId);
    const extraTillIds = [];
    try {
      const savedTill = typeof window !== 'undefined' ? localStorage.getItem('till') : null;
      if (savedTill) {
        const parsed = JSON.parse(savedTill);
        if (parsed?._id && String(parsed._id) !== tillIdStr) {
          extraTillIds.push(String(parsed._id));
        }
      }
    } catch (err) {
      // ignore localStorage errors
    }

    const request = indexedDB.open('SalesPOS', 3);
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const db = event.target.result;
        const txStore = db.transaction(['transactions'], 'readonly').objectStore('transactions');
        const allTxRequest = txStore.getAll();
        allTxRequest.onsuccess = () => {
          const allTransactions = allTxRequest.result || [];
          const pending = allTransactions.filter(tx => {
            if (tx.synced === true) return false;
            if (String(tx.tillId) === tillIdStr) return true;
            return extraTillIds.includes(String(tx.tillId));
          });
          resolve(pending.length);
        };
        allTxRequest.onerror = () => reject(allTxRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error checking pending till transactions:', err);
    return 0;
  }
};

export default function CloseTillModal({ isOpen, onClose, onTillClosed }) {
  const router = useRouter();
  const { staff, till: contextTill, setCurrentTill, logout, location } = useStaff();
  const { orders: cartOrders } = useCart();
  const { tenders, loading: tendersLoading } = useLocationTenders(location?._id);
  const [till, setTill] = useState(null);
  const [tenderCounts, setTenderCounts] = useState({});
  const [closingNotes, setClosingNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStep, setLoadingStep] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [pendingLocalTransactions, setPendingLocalTransactions] = useState(0);
  const [fetchingTill, setFetchingTill] = useState(false);
  const [fetchingProgress, setFetchingProgress] = useState(0);
  const [fetchingStep, setFetchingStep] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [activeTenderKeypad, setActiveTenderKeypad] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [tillTransactions, setTillTransactions] = useState([]);
  const [handovers, setHandovers] = useState([]);
  const [showHandoverConfirm, setShowHandoverConfirm] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [handoverStep, setHandoverStep] = useState("");
  const [handoverProgress, setHandoverProgress] = useState(0);
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  const [reloadToken, setReloadToken] = useState(0);
  const keepCountsOnReloadRef = useRef(false);

  // Another terminal handed over while this screen is open: reload so its sales are included
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleHandoverReceived = () => {
      keepCountsOnReloadRef.current = true;
      setReloadToken((token) => token + 1);
    };
    window.addEventListener("pos:till-handover:received", handleHandoverReceived);
    return () => window.removeEventListener("pos:till-handover:received", handleHandoverReceived);
  }, [isOpen]);

  // Track online/offline status
  useEffect(() => {
    setIsOnline(getOnlineStatus());
    
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
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

  useEffect(() => {
    if (!isOpen || isMobile) return;
    if (!tenders || tenders.length === 0) return;
    if (!activeTenderKeypad) {
      setActiveTenderKeypad(tenders[0].id);
    }
  }, [isOpen, isMobile, tenders, activeTenderKeypad]);

  // Save till close to IndexedDB (offline)
  const saveTillCloseOffline = async (closeData) => {
    try {
      const request = indexedDB.open('SalesPOS', 3);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const db = event.target.result;
          const txStore = db.transaction(['till_closes'], 'readwrite').objectStore('till_closes');
          
          const tillCloseData = {
            ...closeData,
            synced: false,
            savedAt: new Date(),
          };

          const addRequest = txStore.put(tillCloseData);
          addRequest.onsuccess = () => resolve(addRequest.result);
          addRequest.onerror = () => reject(addRequest.error);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('Error saving till close offline:', err);
      throw err;
    }
  };

  // Fetch till data when modal opens (online or offline)
  useEffect(() => {
    if (isOpen && contextTill?._id) {
      setFetchingTill(true);
      setFetchingProgress(0);
      setFetchingStep("Initializing...");
      // Keep amounts already counted when reloading for a hand-over
      if (!keepCountsOnReloadRef.current) setTenderCounts({});
      keepCountsOnReloadRef.current = false;
      
      const fetchTillData = async () => {
        try {
          setFetchingProgress(20);
          setFetchingStep("Loading till information...");
          
          if (isOnline) {
            // Online: Fetch from API
            try {
              setFetchingProgress(40);
              setFetchingStep("Fetching from server...");
              
              const [res, serverData] = await Promise.all([
                fetch(`/api/till/${contextTill._id}`),
                getServerTillData(contextTill._id),
              ]);
              const data = await res.json();

              setFetchingProgress(60);
              setFetchingStep("Loading this terminal's sales...");

              const offlineData = await getOfflineTillData(contextTill._id);
              setPendingLocalTransactions(offlineData.unsyncedCount || 0);

              // Cloud copies (every terminal, voids included) plus this terminal's unsynced sales.
              // Without the cloud list, fall back to this terminal's own copies.
              const merged = mergeTillTransactions(serverData?.transactions || null, offlineData.transactions || []);
              const figures = summarizeTillTransactions(merged);
              setTillTransactions(merged);
              setHandovers(serverData?.till?.handovers || []);

              setTill({
                ...(data.till || contextTill),
                totalSales: figures.totalSales,
                transactionCount: figures.transactionCount,
                tenderBreakdown: figures.tenderBreakdown,
              });
            } catch (err) {
              console.error("Error fetching till:", err);
              setFetchingProgress(70);
              setFetchingStep("Using offline fallback...");
              
              // Fallback to offline data
              const offlineData = await getOfflineTillData(contextTill._id);
              const { transactions: offlineTransactions, ...offlineFigures } = offlineData;
              setTill({
                ...contextTill,
                ...offlineFigures,
              });
              setPendingLocalTransactions(offlineData.unsyncedCount || 0);
              setTillTransactions(mergeTillTransactions(null, offlineTransactions || []));
              setHandovers([]);
            }
          } else {
            // Offline: Use context + IndexedDB data
            setFetchingProgress(50);
            setFetchingStep("Reading offline data...");
            
            const offlineData = await getOfflineTillData(contextTill._id);
            const hasLocalTransactions = (offlineData.transactions || []).length > 0;
            setTill({
              ...contextTill,
              transactionCount: hasLocalTransactions ? offlineData.transactionCount : contextTill.transactionCount || 0,
              totalSales: hasLocalTransactions ? offlineData.totalSales : contextTill.totalSales || 0,
              tenderBreakdown: hasLocalTransactions ? offlineData.tenderBreakdown : contextTill.tenderBreakdown || {},
            });
            setPendingLocalTransactions(offlineData.unsyncedCount || 0);
            setTillTransactions(mergeTillTransactions(null, offlineData.transactions || []));
            setHandovers([]);
          }
          
          setFetchingProgress(90);
          setFetchingStep("Preparing reconciliation...");
          
          // Small delay for visual feedback
          await new Promise(resolve => setTimeout(resolve, 300));
          
          setFetchingProgress(100);
          setFetchingStep("Complete!");
        } catch (err) {
          console.error("Error in fetchTillData:", err);
          setFetchingProgress(100);
          setFetchingStep("Error loading data");
        } finally {
          setFetchingTill(false);
        }
      };
      
      fetchTillData();
    }
  }, [isOpen, contextTill, isOnline, reloadToken]);

  useEffect(() => {
    if (!isOpen || contextTill?._id) return;
    if (typeof window === 'undefined') return;
    try {
      const persistedTill = localStorage.getItem('till');
      if (!persistedTill) return;
      const parsedTill = JSON.parse(persistedTill);
      if (parsedTill?._id) {
        setCurrentTill(parsedTill);
        setTill(parsedTill);
      }
    } catch (error) {
      console.warn('Failed to hydrate till for close modal:', error);
    }
  }, [isOpen, contextTill, setCurrentTill]);

  // Calculate summary when till data is available
  useEffect(() => {
    if (till && isOpen) {
      const expectedClosing = (till.openingBalance || 0) + (till.totalSales || 0);
      const tenderBreakdownObj = normalizeTenderBreakdown(till.tenderBreakdown);
      
      setSummary({
        openingBalance: till.openingBalance || 0,
        totalSales: till.totalSales || 0,
        expectedClosingBalance: expectedClosing,
        tenderBreakdown: tenderBreakdownObj,
        pendingLocalTransactions: pendingLocalTransactions || 0,
      });
    }
  }, [till, isOpen, pendingLocalTransactions]);

  const syncPendingForTill = async () => {
    const {
      syncPendingTillOpens,
      syncPendingTransactions,
      syncPendingTillCloses,
    } = await import('../../lib/offlineSync');

    await syncPendingTillOpens();
    await syncPendingTransactions({ forceRetry: true });
    await syncPendingTillCloses();

    const pendingAfterSync = await getPendingTransactionsForTill(till?._id);
    setPendingLocalTransactions(pendingAfterSync || 0);
    return pendingAfterSync || 0;
  };

  const handleCloseTill = async () => {
    if (!tenders || tenders.length === 0) {
      setError("No payment methods available");
      return;
    }

    if (isOnline && pendingLocalTransactions > 0) {
      setSyncing(true);
      setError(null);
      try {
        const pendingAfterSync = await syncPendingForTill();
        if (pendingAfterSync > 0) {
          setError("Pending transactions are still unsynced. Open Help/Chat > Unsynced Data, then use Sync Sale or Resolve for old offline-till records.");
          return;
        }
      } catch (err) {
        console.warn('⚠️ Could not recover pending transactions before close:', err?.message || err);
        setError("Could not sync pending transactions. Check the connection, then try again.");
        return;
      } finally {
        setSyncing(false);
      }
    }

    const hasEmptyTenders = tenders.some(t => 
      tenderCounts[t.id] === undefined || tenderCounts[t.id] === ""
    );
    
    if (hasEmptyTenders) {
      setError("Please enter physical count for all payment methods");
      return;
    }

    // Show confirmation modal instead of proceeding directly
    setShowConfirmation(true);
  };

  const handleConfirmCloseTill = async () => {
    setShowConfirmation(false);
    setLoading(true);
    setLoadingProgress(0);
    setLoadingStep("Initializing till closure...");
    setError(null);

    try {
      const tenderCountsForAPI = {};
      tenders.forEach(tender => {
        tenderCountsForAPI[tender.id] = parseFloat(tenderCounts[tender.id]) || 0;
      });

      let resolvedTillId = till._id;
      if (isOnline && String(till._id).startsWith('offline-till-')) {
        setLoadingStep("Resolving till ID...");
        setLoadingProgress(5);
        const mapped = await resolveTillId(till._id, till);
        if (mapped) {
          resolvedTillId = mapped;
        }
      }

      const payload = {
        tillId: String(resolvedTillId),
        tenderCounts: tenderCountsForAPI,
        closingNotes: closingNotes.trim(),
        summary: summary,
        deviceId,
        deviceName,
        closedByStaffName: staff?.name || contextTill?.staffName || "",
      };

      if (isOnline) {
        // Ensure all local transactions are synced before closing till
        setLoadingProgress(15);
        setLoadingStep("Syncing pending transactions...");
        let pendingAfterSync = 0;
        try {
          pendingAfterSync = await syncPendingForTill();
        } catch (err) {
          console.warn('⚠️ Could not sync pending transactions before closing till:', err?.message || err);
          try {
            pendingAfterSync = await getPendingTransactionsForTill(till?._id);
            setPendingLocalTransactions(pendingAfterSync || 0);
          } catch (countErr) {
            console.warn('⚠️ Could not re-count pending transactions before closing till:', countErr?.message || countErr);
            pendingAfterSync = 1;
          }
        }

        setLoadingProgress(35);
        setLoadingStep("Checking final pending transactions...");
        if (pendingAfterSync > 0) {
          setError("Pending transactions are still unsynced. Open Help/Chat > Unsynced Data, then use Sync Sale or Resolve for old offline-till records.");
          setLoading(false);
          setLoadingProgress(0);
          setLoadingStep("");
          return;
        }

        setLoadingProgress(50);
        setLoadingStep("Closing till on server...");
        const response = await fetch("/api/till/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || "Failed to close till");
        }

        const data = await response.json();
        setLoadingProgress(75);
        setLoadingStep("Till closed successfully...");
        onTillClosed(data.till);
      } else {
        const tillCloseData = {
          _id: till._id,
          staffId: contextTill?.staffId || till.staffId,
          staffName: contextTill?.staffName || till.staffName,
          storeId: till.storeId || contextTill?.storeId,
          locationId: location?._id,
          tenderCounts: tenderCountsForAPI,
          closingNotes: closingNotes.trim(),
          summary: summary,
          tenderBreakdown: till.tenderBreakdown,
          transactionCount: till.transactionCount,
          openingBalance: till.openingBalance,
          totalSales: till.totalSales || 0,
          closedAt: new Date().toISOString(),
        };

        setLoadingProgress(50);
        setLoadingStep("Saving till closure data locally...");
        await saveTillCloseOffline(tillCloseData);
        setLoadingProgress(75);
        setLoadingStep("Till closed offline...");
        onTillClosed({ ...payload, offline: true });
      }

      setLoadingProgress(80);
      setLoadingStep("Printing end-of-day report...");
      
      // Print end-of-day report before clearing session
      try {
        printEndOfDayReport(
          till,
          summary,
          tenderCountsForAPI,
          tenders,
          closingNotes.trim(),
          location?.name || ''
        );
      } catch (printErr) {
        console.warn('Could not print end-of-day report:', printErr);
      }

      // Wait for print dialog to appear
      await new Promise(resolve => setTimeout(resolve, 1500));

      setLoadingProgress(85);
      setLoadingStep("Clearing session data...");
      setCurrentTill(null);
      setTenderCounts({});
      setClosingNotes("");
      try {
        if (typeof window !== "undefined") {
          localStorage.removeItem("till");
        }
      } catch (err) {
        console.warn("Failed to clear local till:", err);
      }

      setLoadingProgress(95);
      setLoadingStep("Logging out...");
      logout();
      
      setLoadingProgress(100);
      setLoadingStep("Complete!");
      
      // Small delay before closing
      setTimeout(() => {
        onClose();
        router.push("/");
      }, 500);
    } catch (err) {
      setError(err.message);
      setLoading(false);
      setLoadingProgress(0);
      setLoadingStep("");
    }
  };

  const handleSyncNow = async () => {
    if (!isOnline || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const pendingAfterSync = await syncPendingForTill();
      if (pendingAfterSync > 0) {
        setError("Some transactions are still pending. Open Help/Chat > Unsynced Data, then use Sync Sale or Resolve for old offline-till records.");
      }
    } catch (err) {
      console.warn('⚠️ Sync failed:', err?.message || err);
      setError("Sync failed. Please check connection and try again.");
    } finally {
      setSyncing(false);
    }
  };

  // Send this terminal's sales to the cloud and log out, leaving the till open for another terminal to close
  const handleConfirmHandover = async () => {
    setShowHandoverConfirm(false);
    setError(null);

    if (!isOnline) {
      setError("Handing over needs an internet connection so the other terminal can receive this terminal's sales.");
      return;
    }
    if (!till?._id || String(till._id).startsWith('offline-till-')) {
      setError("This till has not reached the cloud yet. Sync first, then hand over.");
      return;
    }

    setHandingOver(true);
    try {
      setHandoverProgress(20);
      setHandoverStep("Sending this terminal's sales to the cloud...");
      const pendingAfterSync = await syncPendingForTill();
      if (pendingAfterSync > 0) {
        throw new Error("Some sales on this terminal have not synced yet. Open Help/Chat > Unsynced Data to sync them, then hand over again.");
      }

      setHandoverProgress(60);
      setHandoverStep("Letting the other terminal know...");
      const response = await fetch(`/api/till/${till._id}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          deviceName,
          staffId: staff?._id,
          staffName: staff?.name || "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not hand over the till. Please try again.");
      }

      setHandoverProgress(85);
      setHandoverStep("Logging out of this terminal...");
      setCurrentTill(null);
      try {
        localStorage.removeItem("till");
      } catch (err) {
        console.warn("Failed to clear local till:", err);
      }
      logout();
      setHandoverProgress(100);
      setHandoverStep("Handed over");
      setTimeout(() => {
        onClose();
        router.push("/");
      }, 400);
    } catch (err) {
      setError(err.message);
      setHandingOver(false);
      setHandoverProgress(0);
      setHandoverStep("");
    }
  };

  if (!isOpen) return null;

  const progressOverlay = (title, step, progress) => (
    <div className="fixed inset-0 bg-primary-900 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-neutral-200 rounded-lg shadow-2xl p-8 text-center w-full max-w-md">
        <div className="w-20 h-20 bg-primary-50 border border-primary-100 rounded-full flex items-center justify-center mx-auto mb-5 overflow-hidden">
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
        <p className="text-neutral-900 font-bold text-lg mb-1">{title}</p>
        <p className="text-neutral-500 text-sm mb-5">{step || "Initializing..."}</p>
        <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-600 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-neutral-600 text-sm font-semibold">{progress}%</div>
      </div>
    </div>
  );

  if (fetchingTill) {
    return progressOverlay("Loading Till Data", fetchingStep, fetchingProgress);
  }

  if (!till || !summary) return null;

  const isButtonDisabled = loading || syncing || !tenders?.length ||
    tenders?.some(t => tenderCounts[t.id] === undefined || tenderCounts[t.id] === "");

  // Helper function to format number with "," as thousands separator
  const formatDisplayValue = (value) => {
    if (!value && value !== 0) return "";
    const numValue = parseFloat(value) || 0;
    return numValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  const formatNaira = (value) => `₦${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Loading overlay while closing till
  if (loading) {
    return progressOverlay("Closing Till & Logging Out", loadingStep, loadingProgress);
  }

  if (handingOver) {
    return progressOverlay("Handing Over & Logging Out", handoverStep, handoverProgress);
  }

  // Held orders are kept on this device; show the ones held today at this location
  const todayKey = new Date().toDateString();
  const heldToday = (cartOrders || [])
    .filter((order) => {
      if (order.status !== 'HELD' || !order.createdAt) return false;
      if (new Date(order.createdAt).toDateString() !== todayKey) return false;
      const orderLocation = typeof order.location === 'string' ? order.location : order.location?.name;
      return !location?.name || !orderLocation || orderLocation === location.name;
    })
    .map((order) => ({
      ...order,
      staffName: order.staffMember?.name || order.staffMember || '',
      customerName: order.customer?.name || '',
    }));

  // Same rules as the totals: voided sales move to VOID and stop counting as sales
  const reconciled = summarizeTillTransactions(tillTransactions);
  const transactionTabs = {
    sales: reconciled.sales,
    refunds: reconciled.refunds,
    void: reconciled.voids,
    held: heldToday,
  };

  const terminals = describeTillTerminals({
    transactions: tillTransactions,
    handovers,
    currentDeviceId: deviceId,
    currentDeviceName: deviceName,
  });
  const otherTerminals = terminals.filter((terminal) => !terminal.isCurrent && terminal.deviceId);
  const showTerminals = otherTerminals.length > 0;

  const handoverButton = (extraClass = "") => (
    <button
      type="button"
      onClick={() => { setError(null); setShowHandoverConfirm(true); }}
      disabled={!isOnline || syncing || showConfirmation}
      title={!isOnline ? "Needs an internet connection" : "Send this terminal's sales to the cloud and let another terminal close the till"}
      className={`w-full py-2.5 bg-white hover:bg-primary-50 border border-primary-300 rounded-md text-sm font-semibold text-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 ${extraClass}`}
    >
      <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
      Hand Over to Another Terminal
    </button>
  );

  const TABS = [
    { id: 'summary', label: 'Summary' },
    { id: 'sales', label: 'Sales', count: transactionTabs.sales.length },
    { id: 'refunds', label: 'Refunds', count: transactionTabs.refunds.length },
    { id: 'void', label: 'Void', count: transactionTabs.void.length },
    { id: 'held', label: 'Held', count: transactionTabs.held.length },
  ];

  const totalCounted = Object.values(tenderCounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const totalExpected = tenders ? tenders.reduce((s, t) => s + getTenderAmount(summary?.tenderBreakdown, t.name), 0) : 0;
  const totalVariance = totalCounted - totalExpected;
  const activeTender = tenders?.find(t => t.id === activeTenderKeypad);
  const varianceClass = (variance) => (variance === 0 ? 'text-green-700' : variance > 0 ? 'text-amber-700' : 'text-red-700');

  const statRows = [
    { label: 'Opening balance', value: formatNaira(summary.openingBalance) },
    { label: 'Total sales', value: formatNaira(summary.totalSales) },
    { label: 'Expected closing', value: formatNaira(summary.expectedClosingBalance), strong: true },
    { label: 'Transactions', value: till?.transactionCount || 0 },
  ];

  const summaryCards = [
    { label: 'Transactions', value: till?.transactionCount || 0 },
    { label: 'Counted', value: formatNaira(totalCounted) },
    { label: 'Takings', value: formatNaira(totalExpected) },
    { label: 'Float', value: formatNaira(summary.openingBalance) },
    { label: 'Total variance', value: formatNaira(totalVariance), className: varianceClass(totalVariance) },
  ];

  return (
    <>
      {/* Solid backdrop so the sales screen is hidden while closing the till */}
      <div className="fixed inset-0 bg-primary-900 flex items-center justify-center z-50 p-2 sm:p-3">
        <div className="bg-primary-700 border border-primary-800 rounded-lg shadow-2xl w-full max-w-[1400px] h-[calc(100vh-1rem)] flex flex-col overflow-hidden">

        {/* Header + tabs */}
        <div className="bg-primary-700 text-white flex items-stretch flex-shrink-0 border-b border-white/10">
          <div className="flex items-center gap-2.5 px-4 border-r border-white/15">
            <FontAwesomeIcon icon={faCashRegister} className="w-4 h-4" />
            <span className="text-sm font-bold uppercase tracking-wide whitespace-nowrap">Close Till</span>
          </div>
          <nav className="flex-1 flex overflow-x-auto" aria-label="Close till sections">
            {TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 sm:px-5 py-3.5 text-xs font-bold uppercase tracking-wide whitespace-nowrap border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'text-white border-white bg-white/10'
                    : 'text-primary-100 border-transparent hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`min-w-[1.25rem] px-1.5 py-0.5 rounded text-[10px] leading-none ${
                    activeTab === tab.id ? 'bg-white text-primary-700' : 'bg-white/15 text-white'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 px-3">
            {!isOnline && (
              <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-[11px] font-bold">OFFLINE</span>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              aria-label="Close"
              className="w-9 h-9 rounded-md hover:bg-white/15 flex items-center justify-center transition-colors"
            >
              <FontAwesomeIcon icon={faXmark} className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Content — 3 white panels on the system colour */}
        <div className="flex-1 grid grid-cols-[260px_1fr_360px] gap-2 p-2 min-h-0 overflow-hidden">

          {/* LEFT: Till info + actions */}
          <aside className="bg-white rounded-md p-4 flex flex-col gap-4 overflow-y-auto">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Till</p>
              <h3 className="text-base font-bold text-neutral-900 mt-0.5">{till?.tillNumber || till?.tillName || 'Till'}</h3>
              <dl className="mt-3 space-y-2 text-sm">
                {[
                  ['Opened by', till?.staffName || '—'],
                  ['Date', till?.openedAt ? new Date(till.openedAt).toLocaleDateString() : '—'],
                  ['Time', till?.openedAt ? new Date(till.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-neutral-500">{label}</dt>
                    <dd className="font-medium text-neutral-900 text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="border border-neutral-200 rounded-md divide-y divide-neutral-200">
              {statRows.map(row => (
                <div key={row.label} className={`flex justify-between items-center gap-3 px-3 py-2.5 ${row.strong ? 'bg-primary-50' : ''}`}>
                  <span className={`text-xs ${row.strong ? 'font-semibold text-primary-800' : 'text-neutral-600'}`}>{row.label}</span>
                  <span className={`text-sm font-bold text-right ${row.strong ? 'text-primary-800' : 'text-neutral-900'}`}>{row.value}</span>
                </div>
              ))}
            </div>

            {pendingLocalTransactions > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                <p className="text-xs font-semibold text-amber-800">
                  {pendingLocalTransactions} transaction{pendingLocalTransactions === 1 ? '' : 's'} waiting to sync
                </p>
                {isOnline && (
                  <button
                    type="button"
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="mt-2 w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-2"
                  >
                    <FontAwesomeIcon icon={faRotate} className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? "Syncing..." : "Sync now"}
                  </button>
                )}
              </div>
            )}

            <div>
              <label htmlFor="closing-notes" className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">Closing notes</label>
              <textarea
                id="closing-notes"
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                placeholder="Anything to note about this till..."
                className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 resize-none h-20"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 flex gap-2">
                <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs font-semibold text-red-700">{error}</p>
              </div>
            )}

            <div className="mt-auto space-y-2 pt-4 border-t border-neutral-200">
              <button
                type="button"
                onClick={handleCloseTill}
                disabled={isButtonDisabled || showConfirmation}
                className="w-full py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white font-bold text-sm rounded-md transition-colors flex items-center justify-center gap-2"
              >
                <FontAwesomeIcon icon={faLock} className="w-4 h-4" />
                Print &amp; Close Till
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    printEndOfDayReport(till, summary, tenderCounts, tenders, closingNotes.trim(), location?.name || '');
                  } catch (printErr) {
                    console.warn('Could not print end-of-day report:', printErr);
                  }
                }}
                className="w-full py-2.5 bg-white hover:bg-neutral-50 border border-neutral-300 rounded-md text-sm font-semibold text-neutral-700 transition-colors flex items-center justify-center gap-2"
              >
                <FontAwesomeIcon icon={faPrint} className="w-4 h-4" />
                Print Report
              </button>
              {/* The Count column is hidden on small screens, so the hand-over button lives here instead */}
              {handoverButton("sm:hidden")}
              <button
                type="button"
                onClick={onClose}
                disabled={loading || showConfirmation}
                className="w-full py-2.5 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded-md text-sm font-semibold text-neutral-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </aside>

          {/* CENTER: Tab content */}
          <main className="overflow-y-auto min-w-0">
            {activeTab === 'summary' ? (
              <>
                {/* Summary strip: one panel, values kept on one line */}
                <div className="bg-white rounded-md mb-2 px-2 py-3 flex flex-wrap gap-y-3">
                  {summaryCards.map(card => (
                    <div key={card.label} className="flex-1 min-w-fit px-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500 whitespace-nowrap">{card.label}</p>
                      <p className={`text-lg font-semibold mt-1.5 whitespace-nowrap tabular-nums ${card.className || 'text-neutral-900'}`}>{card.value}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-md overflow-hidden">
                  <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-neutral-800">Cash up</h3>
                    <span className="text-xs text-neutral-500">Tap a tender, then enter the amount counted</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-neutral-100 border-b border-neutral-200">
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-neutral-600 uppercase">Tender</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-neutral-600 uppercase">Counted</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-neutral-600 uppercase">Expected</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-neutral-600 uppercase">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenders && tenders.map((tender) => {
                        const expected = getTenderAmount(summary?.tenderBreakdown, tender.name);
                        const counted = parseFloat(tenderCounts[tender.id]) || 0;
                        const variance = counted - expected;
                        const hasVal = tenderCounts[tender.id] !== undefined && tenderCounts[tender.id] !== "";
                        const isActive = activeTenderKeypad === tender.id;
                        return (
                          <tr
                            key={tender.id}
                            onClick={() => setActiveTenderKeypad(tender.id)}
                            className={`border-b border-neutral-100 cursor-pointer transition-colors ${isActive ? 'bg-primary-50' : 'hover:bg-neutral-50'}`}
                          >
                            <td className={`px-4 py-3 font-semibold text-neutral-800 border-l-4 ${isActive ? 'border-primary-600' : 'border-transparent'}`}>
                              <span className="flex items-center gap-2">
                                {tender.name}
                                {isActive && <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5 text-primary-600" />}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type={isMobile ? "number" : "text"}
                                inputMode={isMobile ? "decimal" : undefined}
                                value={isMobile ? (tenderCounts[tender.id] ?? '') : formatDisplayValue(tenderCounts[tender.id])}
                                readOnly={!isMobile}
                                onChange={(e) => { if (isMobile) setTenderCounts(prev => ({ ...prev, [tender.id]: e.target.value })); }}
                                placeholder="—"
                                onClick={() => setActiveTenderKeypad(tender.id)}
                                className={`w-36 text-right border rounded-md px-2.5 py-1.5 text-sm font-bold cursor-pointer ${isActive ? 'border-primary-400 bg-white' : 'border-neutral-200 bg-neutral-50'}`}
                              />
                            </td>
                            <td className="px-4 py-3 text-right text-neutral-600 whitespace-nowrap">{formatNaira(expected)}</td>
                            <td className={`px-4 py-3 text-right font-bold whitespace-nowrap ${hasVal ? varianceClass(variance) : 'text-neutral-400'}`}>
                              {hasVal ? formatNaira(variance) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-neutral-300 bg-neutral-50">
                        <td className="px-4 py-2.5 font-semibold text-neutral-700">Sub-total</td>
                        <td className="px-4 py-2.5 text-right font-bold text-neutral-800 whitespace-nowrap">{formatNaira(totalCounted)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-neutral-600 whitespace-nowrap">{formatNaira(totalExpected)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold whitespace-nowrap ${varianceClass(totalVariance)}`}>{formatNaira(totalVariance)}</td>
                      </tr>
                      <tr className="border-t border-neutral-200">
                        <td className="px-4 py-2.5 font-semibold text-neutral-600">Float</td>
                        <td className="px-4 py-2.5 text-right text-neutral-400">—</td>
                        <td className="px-4 py-2.5 text-right text-neutral-600 whitespace-nowrap">{formatNaira(summary.openingBalance)}</td>
                        <td className="px-4 py-2.5 text-right text-neutral-400 whitespace-nowrap">{formatNaira(0)}</td>
                      </tr>
                      <tr className="border-t-2 border-neutral-300">
                        <td className="px-4 py-3 font-bold text-neutral-900">Total</td>
                        <td className="px-4 py-3 text-right font-bold text-neutral-900 whitespace-nowrap">{formatNaira(totalCounted)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-neutral-700 whitespace-nowrap">{formatNaira(totalExpected)}</td>
                        <td className={`px-4 py-3 text-right font-bold whitespace-nowrap ${varianceClass(totalVariance)}`}>{formatNaira(totalVariance)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {showTerminals && (
                  <div className="bg-white rounded-md overflow-hidden mt-2">
                    <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-neutral-800 flex items-center gap-2">
                        <FontAwesomeIcon icon={faDesktop} className="w-3.5 h-3.5 text-primary-600" />
                        Terminals on this till
                      </h3>
                      <span className="text-xs text-neutral-500">Count the cash and tenders from every terminal</span>
                    </div>
                    <div className="divide-y divide-neutral-100">
                      {terminals.map((terminal) => {
                        const handover = terminal.handover;
                        const status = terminal.isCurrent
                          ? { label: 'This terminal', className: 'bg-primary-50 text-primary-700 border-primary-200' }
                          : handover?.status === 'pending'
                            ? { label: 'Handed over', className: 'bg-green-50 text-green-700 border-green-200' }
                            : handover?.status === 'resumed'
                              ? { label: 'Back on sales', className: 'bg-amber-50 text-amber-800 border-amber-200' }
                              : { label: 'Not handed over', className: 'bg-amber-50 text-amber-800 border-amber-200' };
                        return (
                          <div key={terminal.deviceId || terminal.deviceName} className="px-4 py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-neutral-800 truncate">{terminal.deviceName}</p>
                              <p className="text-xs text-neutral-500">
                                {terminal.salesCount} sale{terminal.salesCount === 1 ? '' : 's'} · {formatNaira(terminal.salesTotal)}
                                {handover?.sentAt && !terminal.isCurrent && (
                                  <> · sent {new Date(handover.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}{handover.staffName ? ` by ${handover.staffName}` : ''}</>
                                )}
                              </p>
                            </div>
                            <span className={`text-[11px] font-bold px-2 py-1 rounded border whitespace-nowrap ${status.className}`}>{status.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    {otherTerminals.some((terminal) => terminal.handover?.status !== 'pending') && (
                      <p className="px-4 py-2.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 flex gap-2">
                        <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        A terminal that has not handed over may still have sales it hasn&apos;t synced. Ask for a hand over from that terminal before closing, so its sales are included.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (() => {
              const tab = TABS.find(t => t.id === activeTab);
              const list = transactionTabs[activeTab] || [];
              const isHeld = activeTab === 'held';
              return (
                <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
                  <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-neutral-800">
                      {isHeld ? 'Held today' : tab?.label} ({list.length})
                    </h3>
                    <span className="text-sm font-bold text-neutral-700">
                      Total: {formatNaira(list.reduce((s, tx) => s + (Number(tx.total) || 0), 0))}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="p-8 text-center text-neutral-500 text-sm">
                      {isHeld ? 'No orders on hold today.' : `No ${tab?.label.toLowerCase()} transactions this session.`}
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {list.map((tx, idx) => (
                        <div key={tx.id || tx._id || tx.clientId || idx} className="px-4 py-3 hover:bg-neutral-50 transition-colors">
                          <div className="flex items-center justify-between gap-3 mb-1.5">
                            <span className="text-sm font-bold text-neutral-800">
                              #{idx + 1}
                              {isHeld && (tx.customerName || tx.tableName) && (
                                <span className="ml-2 font-medium text-neutral-500">{tx.customerName || tx.tableName}</span>
                              )}
                            </span>
                            <span className="text-xs text-neutral-500">
                              {tx.createdAt ? new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}
                            </span>
                          </div>
                          {Array.isArray(tx.items) && tx.items.length > 0 && (
                            <div className="space-y-1 mb-1.5">
                              {tx.items.map((item, i) => {
                                const quantity = Number(item.quantity ?? item.qty) || 0;
                                const price = Number(item.price ?? item.salePriceIncTax) || 0;
                                return (
                                  <div key={i} className="flex justify-between gap-3 text-xs">
                                    <span className="text-neutral-600 min-w-0 break-words">{item.name} × {quantity}</span>
                                    <span className="text-neutral-800 font-medium whitespace-nowrap">{formatNaira(price * quantity)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div className="flex justify-between items-center gap-3 pt-1.5 border-t border-dashed border-neutral-200">
                            <span className="text-xs text-neutral-500">
                              {isHeld
                                ? `Held by ${tx.staffName || 'staff'}`
                                : [
                                    tx.tenderPayments?.length ? tx.tenderPayments.map((p) => p.tenderName).join(' + ') : (tx.tenderType || '—'),
                                    activeTab === 'void' && tx.refundedAt
                                      ? `voided ${new Date(tx.refundedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`
                                      : '',
                                    showTerminals && tx.deviceName ? tx.deviceName : '',
                                  ].filter(Boolean).join(' · ')}
                            </span>
                            <span className="text-sm font-bold text-neutral-900">{formatNaira(tx.total)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </main>

          {/* RIGHT: Count keypad */}
          <aside className="hidden sm:flex flex-col bg-white rounded-md p-4 gap-3 overflow-y-auto">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Count</p>
              <h3 className="text-base font-bold text-neutral-900">{activeTender?.name || 'Select a tender'}</h3>
            </div>
            {tenders && tenders.length > 0 ? (
              <>
                <div className="border border-neutral-200 rounded-md divide-y divide-neutral-200">
                  {tenders.map((tender) => {
                    const isActive = activeTenderKeypad === tender.id;
                    return (
                      <button
                        key={tender.id}
                        type="button"
                        onClick={() => setActiveTenderKeypad(tender.id)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors border-l-4 ${
                          isActive ? 'bg-primary-50 border-primary-600' : 'bg-white border-transparent hover:bg-neutral-50'
                        }`}
                      >
                        <span className={`text-sm font-semibold ${isActive ? 'text-primary-800' : 'text-neutral-700'}`}>{tender.name}</span>
                        <span className={`text-sm font-bold text-right break-all ${isActive ? 'text-primary-800' : 'text-neutral-900'}`}>
                          ₦{formatDisplayValue(tenderCounts[tender.id]) || '0'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <NumKeypad
                  value={activeTenderKeypad ? (tenderCounts[activeTenderKeypad] || "") : ""}
                  onChange={(newValue) => {
                    if (!activeTenderKeypad) return;
                    setTenderCounts(prev => ({ ...prev, [activeTenderKeypad]: newValue }));
                  }}
                  placeholder={activeTender ? `${activeTender.name} amount (₦)` : "Amount (₦)"}
                  disabled={loading || !activeTenderKeypad}
                  showCalc
                  size="large"
                />
              </>
            ) : (
              <div className="text-sm text-neutral-500">No payment methods available.</div>
            )}

            {/* Bottom of the Count column, level with Cancel in the left column */}
            <div className="mt-auto pt-4 border-t border-neutral-200">
              {handoverButton()}
            </div>
          </aside>
        </div>
      </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-neutral-200 rounded-lg shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Close this till?</h3>
                <p className="text-sm text-neutral-600 mt-1">The end-of-day report will print and you will be logged out. This can&apos;t be undone.</p>
              </div>
            </div>

            <div className="bg-neutral-50 border border-neutral-200 rounded-md divide-y divide-neutral-200">
              {[
                ['Total sales', formatNaira(summary?.totalSales)],
                ['Expected closing', formatNaira(summary?.expectedClosingBalance)],
                ['Counted', formatNaira(totalCounted)],
                ['Variance', formatNaira(totalVariance)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-neutral-600">{label}</span>
                  <span className={`font-bold ${label === 'Variance' ? varianceClass(totalVariance) : 'text-neutral-900'}`}>{value}</span>
                </div>
              ))}
              {closingNotes && (
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold text-neutral-500">Notes</p>
                  <p className="text-sm text-neutral-700 mt-0.5">{closingNotes}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                className="flex-1 px-4 py-2.5 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-800 font-semibold rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCloseTill}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin" />}
                {loading ? "Processing..." : "Yes, close till"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hand-over Confirmation */}
      {showHandoverConfirm && (() => {
        const thisTerminal = terminals.find((terminal) => terminal.isCurrent);
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-neutral-200 rounded-lg shadow-2xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center flex-shrink-0">
                  <FontAwesomeIcon icon={faRightFromBracket} className="w-5 h-5 text-primary-700" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-neutral-900">Hand over to another terminal?</h3>
                  <p className="text-sm text-neutral-600 mt-1">
                    This terminal&apos;s sales will be sent to the cloud and you will be logged out. The till stays open,
                    and the other terminal at {location?.name || 'this location'} will be asked to close it with these sales included.
                  </p>
                </div>
              </div>

              <div className="bg-neutral-50 border border-neutral-200 rounded-md divide-y divide-neutral-200">
                {[
                  ['Terminal', deviceName],
                  ['Sales on this terminal', String(thisTerminal?.salesCount || 0)],
                  ['Value', formatNaira(thisTerminal?.salesTotal || 0)],
                  ['Waiting to sync', String(pendingLocalTransactions || 0)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-neutral-600">{label}</span>
                    <span className="font-bold text-neutral-900 text-right">{value}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-neutral-500">
                Take this terminal&apos;s cash and tender slips to the terminal that will close the till.
              </p>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowHandoverConfirm(false)}
                  className="flex-1 px-4 py-2.5 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-800 font-semibold rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmHandover}
                  className="flex-1 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-md transition-colors"
                >
                  Send &amp; log out
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
