// components/pos/CloseTillModal.js
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Image from "next/image";
import { useStaff } from "../../context/StaffContext";
import { useLocationTenders } from "../../hooks/useLocationTenders";
import { getOnlineStatus, resolveTillId } from "../../lib/offlineSync";
import { getStoreLogo } from "../../lib/logoCache";
import { escapeHtml } from "../../lib/receiptViewModel";
import { addTenderAmount, getTenderAmount, normalizeTenderBreakdown } from "../../lib/tenderKey";
import NumKeypad from "../common/NumKeypad";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";

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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: white;
    }
    body {
      font-family: 'Arial', 'Helvetica Neue', sans-serif;
      font-size: 7.5pt;
      line-height: 1.1;
      overflow-x: hidden;
    }
    .report-page {
      width: 58mm;
      min-width: 58mm;
      max-width: 58mm;
      margin: 0 auto;
      padding: 0;
      background: white;
      display: flex;
      justify-content: center;
    }
    .report {
      width: 100%;
      margin: 0;
      padding: 2mm 1.5mm 1.5mm;
      color: #000;
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
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: white;
        overflow-x: hidden;
      }
      .report-page {
        width: 58mm;
        min-width: 58mm;
        max-width: 58mm;
        margin: 0 auto !important;
        padding: 0 !important;
      }
      .report {
        width: 100%;
        margin: 0;
        padding: 2mm 1.5mm 1.5mm;
      }
      @page { size: 58mm auto; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="report-page">
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
  </div>
</body>
</html>`;

  // Print via iframe
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    iframe.contentDocument.write(html);
    iframe.contentDocument.close();

    let printed = false;
    const doPrint = () => {
      if (printed) return;
      printed = true;
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.error('EOD print error:', e);
      }
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch (e) { /* ignore */ }
      }, 5000);
    };

    iframe.contentWindow.addEventListener('load', doPrint, { once: true });
    setTimeout(doPrint, 1000);
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
          
          // Calculate totals from offline transactions
          let totalSales = 0;
          const tenderBreakdown = {};
          let unsyncedCount = 0;
          
          tillTransactions.forEach(tx => {
            totalSales += tx.total || 0;
            if (tx.synced !== true) {
              unsyncedCount += 1;
            }
            
            // Process tender payments
            if (tx.tenderPayments && Array.isArray(tx.tenderPayments)) {
              tx.tenderPayments.forEach(tp => {
                addTenderAmount(tenderBreakdown, tp.tenderName, tp.amount, 'Cash');
              });
            } else if (tx.tenderType) {
              addTenderAmount(tenderBreakdown, tx.tenderType, tx.total, 'Cash');
            }
          });
          
          resolve({
            transactionCount: tillTransactions.length,
            totalSales,
            tenderBreakdown,
            unsyncedCount,
          });
        };
        
        allTxRequest.onerror = () => reject(allTxRequest.error);
      };
      
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Error getting offline till data:', err);
    return { transactionCount: 0, totalSales: 0, tenderBreakdown: {}, unsyncedCount: 0 };
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
  const { till: contextTill, setCurrentTill, logout, location } = useStaff();
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
      setTenderCounts({});
      
      const fetchTillData = async () => {
        try {
          setFetchingProgress(20);
          setFetchingStep("Loading till information...");
          
          if (isOnline) {
            // Online: Fetch from API
            try {
              setFetchingProgress(40);
              setFetchingStep("Fetching from server...");
              
              const res = await fetch(`/api/till/${contextTill._id}`);
              const data = await res.json();
              
              setFetchingProgress(60);
              setFetchingStep("Loading offline data...");
              
              // Always get offline data (reliable source of tenderBreakdown from IndexedDB)
              const offlineData = await getOfflineTillData(contextTill._id);
              setPendingLocalTransactions(offlineData.unsyncedCount || 0);
              
              if (data.till) {
                // IndexedDB tenderBreakdown is always reliable (built from actual transactions).
                // Server Mongoose Map serialization is fragile, so prefer offline when available.
                const offlineBreakdown = offlineData.tenderBreakdown || {};
                const hasOfflineBreakdown = Object.keys(offlineBreakdown).length > 0;
                
                if (hasOfflineBreakdown) {
                  console.log('📊 Using IndexedDB tenderBreakdown (reliable):', offlineBreakdown);
                  data.till.tenderBreakdown = offlineBreakdown;
                }
                
                setTill(data.till);
              } else {
                setTill(contextTill);
              }
            } catch (err) {
              console.error("Error fetching till:", err);
              setFetchingProgress(70);
              setFetchingStep("Using offline fallback...");
              
              // Fallback to offline data
              const offlineData = await getOfflineTillData(contextTill._id);
              setTill({
                ...contextTill,
                ...offlineData,
              });
              setPendingLocalTransactions(offlineData.unsyncedCount || 0);
            }
          } else {
            // Offline: Use context + IndexedDB data
            setFetchingProgress(50);
            setFetchingStep("Reading offline data...");
            
            const offlineData = await getOfflineTillData(contextTill._id);
            setTill({
              ...contextTill,
              transactionCount: offlineData.transactionCount || contextTill.transactionCount || 0,
              totalSales: offlineData.totalSales || contextTill.totalSales || 0,
              tenderBreakdown: offlineData.tenderBreakdown || contextTill.tenderBreakdown || {},
            });
            setPendingLocalTransactions(offlineData.unsyncedCount || 0);
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
  }, [isOpen, contextTill, isOnline]);

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

  if (!isOpen) return null;

  if (fetchingTill) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gradient-to-br from-cyan-600 to-cyan-700 rounded-xl shadow-2xl p-8 text-center w-full max-w-md">
          {/* Logo */}
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg overflow-hidden">
            <Image 
              src={getStoreLogo()} 
              alt="Store Logo" 
              width={90}
              height={90}
              className="object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = '/images/placeholder.jpg';
              }}
              unoptimized
            />
          </div>

          {/* Loading Text */}
          <p className="text-white font-bold text-lg mb-2">Loading Till Data...</p>
          <p className="text-cyan-100 text-sm mb-6 font-medium">{fetchingStep || "Initializing..."}</p>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-cyan-300 to-green-300 rounded-full transition-all duration-300 shadow-lg"
                style={{ width: `${fetchingProgress}%` }}
              />
            </div>
            <div className="mt-2 text-cyan-100 text-sm font-semibold">{fetchingProgress}%</div>
          </div>
        </div>
      </div>
    );
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

  // Loading overlay while closing till
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gradient-to-br from-cyan-600 to-cyan-700 rounded-xl shadow-2xl p-8 text-center w-full max-w-md">
          {/* Logo */}
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg overflow-hidden">
            <Image 
              src={getStoreLogo()} 
              alt="Store Logo" 
              width={90}
              height={90}
              className="object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = '/images/placeholder.jpg';
              }}
              unoptimized
            />
          </div>

          {/* Loading Text */}
          <p className="text-white font-bold text-lg mb-2">Closing Till & Logging Out...</p>
          <p className="text-cyan-100 text-sm mb-6 font-medium">{loadingStep}</p>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-cyan-300 to-green-300 rounded-full transition-all duration-300 shadow-lg"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <div className="mt-2 text-cyan-100 text-sm font-semibold">{loadingProgress}%</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[calc(100vh-1rem)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-600 to-cyan-700 text-white px-3 py-2 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold">Close Till & Reconciliation</h2>
            <p className="text-cyan-100 text-xs">
              Session: {till?.openedAt ? new Date(till.openedAt).toLocaleTimeString() : 'Unknown'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!isOnline && (
              <div className="bg-yellow-500 text-yellow-900 px-3 py-1 rounded-lg text-sm font-bold flex items-center gap-2">
                <span className="w-2 h-2 bg-yellow-900 rounded-full animate-pulse"></span>
                OFFLINE
              </div>
            )}
            <button
              onClick={onClose}
              disabled={loading}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors active:scale-95"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content - Grid Layout */}
        <div className="flex-1 p-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,320px)] sm:grid-rows-[auto_auto] gap-2 overflow-y-auto">
          {/* Content 1 - Summary Cards (col 1, row 1) */}
          <div className="space-y-3 order-1 sm:col-start-1 sm:row-start-1">
            <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-300 rounded p-2">
              <p className="text-xs text-cyan-700 font-semibold uppercase">Opening Balance</p>
              <p className="text-base font-bold text-cyan-800">₦{Number(summary.openingBalance).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            
            <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-300 rounded p-2">
              <p className="text-xs text-green-700 font-semibold uppercase">Total Sales</p>
              <p className="text-base font-bold text-green-800">₦{Number(summary.totalSales).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-300 rounded p-2">
              <p className="text-xs text-purple-700 font-semibold uppercase">Expected Closing</p>
              <p className="text-base font-bold text-purple-800">₦{Number(summary.expectedClosingBalance).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-300 rounded p-2">
              <p className="text-xs text-orange-700 font-semibold uppercase">Transactions</p>
              <p className="text-base font-bold text-orange-800">{till?.transactionCount || 0}</p>
            </div>

            {pendingLocalTransactions > 0 && (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded p-2">
                <p className="text-xs text-yellow-800 font-semibold uppercase">Pending Sync</p>
                <p className="text-base font-bold text-yellow-900">{pendingLocalTransactions}</p>
                <p className="text-xs text-yellow-800 mt-1">Sync before closing till.</p>
                {isOnline && (
                  <button
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="mt-2 w-full px-3 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-bold transition disabled:opacity-60"
                  >
                    {syncing ? "Syncing..." : "Sync Now"}
                  </button>
                )}
              </div>
            )}

            {/* Offline Notice */}
            {!isOnline && (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-3">
                <p className="text-xs text-yellow-800 font-semibold">
                  ⚠️ Data from local storage. Will sync when online.
                </p>
              </div>
            )}
          </div>

          {/* Content 1 - Reconcile Payment Methods (col 2, row 1) */}
          <div className="flex flex-col overflow-hidden order-2 sm:col-start-2 sm:row-start-1">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-2">Reconcile Payment Methods</h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {tenders && tenders.map((tender) => {
                const processedAmount = getTenderAmount(summary?.tenderBreakdown, tender.name);
                const physicalCount = parseFloat(tenderCounts[tender.id]) || 0;
                const variance = physicalCount - processedAmount;
                const hasValue = tenderCounts[tender.id] !== undefined && tenderCounts[tender.id] !== "";
                
                return (
                  <div key={tender.id}>
                    <div
                      className={`rounded-lg border-2 p-3 cursor-pointer transition-all ${
                        activeTenderKeypad === tender.id
                          ? "border-cyan-500 bg-cyan-50 shadow-lg"
                          : "border-gray-200 bg-white hover:border-cyan-400"
                      }`}
                      style={{ borderLeftColor: tender.buttonColor || "#06b6d4", borderLeftWidth: "4px" }}
                      onClick={() => setActiveTenderKeypad(tender.id)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-bold ${activeTenderKeypad === tender.id ? "text-cyan-700" : "text-gray-800"}`}>
                          {tender.name}
                          {activeTenderKeypad === tender.id && <span className="ml-2 text-cyan-600 font-bold text-sm">→ ACTIVE</span>}
                        </span>
                        <span className="text-sm text-gray-500">Expected: ₦{Number(processedAmount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <input
                            type={isMobile ? "number" : "text"}
                            inputMode={isMobile ? "decimal" : undefined}
                            value={formatDisplayValue(tenderCounts[tender.id])}
                            readOnly={!isMobile}
                            onChange={(e) => {
                              if (!isMobile) return;
                              setTenderCounts(prev => ({ ...prev, [tender.id]: e.target.value }));
                            }}
                            placeholder="Tap to enter"
                            className={`w-full border-2 rounded-lg px-3 py-2 text-lg font-bold focus:outline-none text-gray-700 ${
                              activeTenderKeypad === tender.id
                                ? "border-cyan-400 bg-white shadow-md"
                                : "border-gray-300 bg-gray-50"
                            }`}
                          />
                        </div>
                        <div className={`w-24 flex flex-col items-center justify-center rounded-lg text-sm font-bold ${
                          !hasValue ? "bg-gray-100 text-gray-400" :
                          variance === 0 ? "bg-green-100 text-green-700" :
                          variance > 0 ? "bg-yellow-100 text-yellow-700" :
                          "bg-red-100 text-red-700"
                        }`}>
                          {!hasValue ? "—" : (
                            <>
                              <span>₦{Number(variance).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              <span className="text-xs">{variance === 0 ? "✓ OK" : variance > 0 ? "Over" : "Short"}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Content 2 - Keypad (col 3, rows 1-2) */}
          <div className="hidden sm:flex flex-col overflow-hidden order-3 sm:col-start-3 sm:row-start-1 sm:row-span-2">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-2">
              {activeTenderKeypad ? `📝 ${tenders.find(t => t.id === activeTenderKeypad)?.name}` : "Keypad"}
            </h3>
            <div className={`flex-1 border-2 rounded-lg p-3 h-full transition-all ${
              activeTenderKeypad
                ? "bg-cyan-50 border-cyan-300 shadow-lg"
                : "bg-gray-50 border-gray-200"
            }`}>
              {tenders && tenders.length > 0 ? (
                <>
                  <div className={`text-xs font-semibold mb-3 p-2 rounded ${
                    activeTenderKeypad
                      ? "text-cyan-700 bg-cyan-100"
                      : "text-gray-600 bg-gray-100"
                  }`}>
                    {activeTenderKeypad
                      ? `✓ Entering amount for ${tenders.find(t => t.id === activeTenderKeypad)?.name || "payment method"}`
                      : "← Select a payment method to enter amount"}
                  </div>
                  
                  {/* Custom display showing formatted value */}
                  {activeTenderKeypad && (
                    <div className="bg-white border-2 border-gray-300 rounded-lg p-3 text-right mb-3 shadow-sm">
                      <div className="text-xs text-gray-500 mb-1">Amount in ₦</div>
                      <div className="text-3xl font-bold text-cyan-700 truncate">
                        {formatDisplayValue(tenderCounts[activeTenderKeypad]) || '0'}
                      </div>
                    </div>
                  )}
                  
                  <NumKeypad
                    value={activeTenderKeypad ? (tenderCounts[activeTenderKeypad] || "") : ""}
                    onChange={(newValue) => {
                      if (!activeTenderKeypad) return;
                      setTenderCounts(prev => ({ ...prev, [activeTenderKeypad]: newValue }));
                    }}
                    placeholder="Amount in ₦"
                    disabled={loading || !activeTenderKeypad}
                  />
                </>
              ) : (
                <div className="text-sm text-gray-500">No payment methods available.</div>
              )}
            </div>
          </div>

          {/* Content 1 - Closing Notes (col 1-2, row 2) */}
          <div className="flex flex-col order-4 sm:col-span-2 sm:col-start-1 sm:row-start-2">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-2">Closing Notes</h3>
            <textarea
              value={closingNotes}
              onChange={(e) => setClosingNotes(e.target.value)}
              placeholder="Note any discrepancies or issues..."
              className="flex-1 border-2 border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 resize-none"
              disabled={loading}
            />
            
            {/* Error Message */}
            {error && (
              <div className="mt-3 bg-red-50 border-2 border-red-300 rounded-xl p-3">
                <p className="text-sm font-semibold text-red-700">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer - Buttons */}
        <div className="px-4 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={loading || showConfirmation}
            className="flex-1 px-4 py-3.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-base transition-all active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCloseTill}
            disabled={isButtonDisabled || showConfirmation}
            className="flex-1 px-4 py-3.5 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-lg text-base transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin" />}
            {loading ? "Closing Till..." : "Close Till & Logout"}
          </button>
        </div>
      </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            {/* Warning Icon & Title */}
            <div className="flex items-start gap-3">
              <div className="text-3xl">⚠️</div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">Confirm Till Closure</h3>
                <p className="text-sm text-gray-600 mt-1">Are you sure you want to close this till? This action cannot be undone.</p>
              </div>
            </div>

            {/* Summary Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">Total Sales:</span>
                <span className="font-bold text-gray-800">₦{Number(summary?.totalSales || 0).toLocaleString('en-NG')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">Expected Closing:</span>
                <span className="font-bold text-gray-800">₦{Number(summary?.expectedClosingBalance || 0).toLocaleString('en-NG')}</span>
              </div>
              {closingNotes && (
                <div className="pt-2 border-t border-blue-200 mt-2">
                  <p className="text-xs text-gray-600 font-semibold">Notes:</p>
                  <p className="text-sm text-gray-700 mt-0.5">{closingNotes}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowConfirmation(false)}
                className="flex-1 px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCloseTill}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading && <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin" />}
                {loading ? "Processing..." : "Yes, Close Till"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
