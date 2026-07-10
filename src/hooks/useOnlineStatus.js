import { useState, useEffect } from "react";

/**
 * Custom hook to detect and track online/offline status
 * Syncs offline transactions when connection is restored
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [offlineTransactions, setOfflineTransactions] = useState([]);
  const [syncing, setSyncing] = useState(false);

  // Detect online/offline status
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      console.log("🟢 Connection restored - syncing offline data...");
      setIsOnline(true);
      syncOfflineTransactions();
    };

    const handleOffline = () => {
      console.log("🔴 Connection lost - offline mode activated");
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load offline transactions from localStorage on mount
  useEffect(() => {
    const loadOfflineTransactions = () => {
      try {
        const stored = localStorage.getItem("offlineTransactions");
        if (stored) {
          const transactions = JSON.parse(stored);
          setOfflineTransactions(transactions);
        }
      } catch (err) {
        console.error("Failed to load offline transactions:", err);
      }
    };

    loadOfflineTransactions();
  }, []);

  /**
   * Sync all offline transactions to the server
   */
  const syncOfflineTransactions = async () => {
    try {
      const stored = localStorage.getItem("offlineTransactions");
      if (!stored) return;

      const transactions = JSON.parse(stored);
      if (transactions.length === 0) return;

      setSyncing(true);
      const failedTransactions = [];

      // Attempt to sync each transaction
      for (const transaction of transactions) {
        try {
          const res = await fetch("/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(transaction),
          });

          if (!res.ok) {
            failedTransactions.push(transaction);
            console.warn(`Failed to sync transaction:`, transaction._id);
          } else {
            console.log(`✅ Synced transaction successfully`);
          }
        } catch (err) {
          failedTransactions.push(transaction);
          console.error("Sync error:", err);
        }
      }

      // Update localStorage with failed transactions only
      if (failedTransactions.length > 0) {
        localStorage.setItem(
          "offlineTransactions",
          JSON.stringify(failedTransactions)
        );
        setOfflineTransactions(failedTransactions);
        console.warn(
          `⚠️ ${failedTransactions.length} transactions failed to sync`
        );
      } else {
        localStorage.removeItem("offlineTransactions");
        setOfflineTransactions([]);
        console.log("✅ All offline transactions synced successfully!");
      }
    } catch (err) {
      console.error("Sync process error:", err);
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Manually trigger sync
   */
  const manualSync = async () => {
    await syncOfflineTransactions();
  };

  return {
    isOnline,
    offlineTransactions,
    syncing,
    manualSync,
    syncOfflineTransactions,
  };
}
