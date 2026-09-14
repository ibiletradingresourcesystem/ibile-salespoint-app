/**
 * TillHandoverWatcher
 *
 * Several terminals at one location share the location's till. This checks the till in the cloud and:
 * - asks this terminal to close the till when another terminal has handed over its sales
 * - logs this terminal out when another terminal has already closed the till
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCashRegister, faLock, faRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import { useStaff } from "../../context/StaffContext";
import { getDeviceId } from "../../lib/deviceIdentity";
import { getOnlineStatus, getPendingTransactionsCount, syncPendingTransactions } from "../../lib/offlineSync";
import { hasPosPermission } from "../../lib/posPermissions";

const CHECK_INTERVAL_MS = 30000;
const SEEN_KEY = "pos_seen_handovers";

const readSeen = () => {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const formatNaira = (value) =>
  `₦${Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatTime = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }) : "";

export default function TillHandoverWatcher() {
  const router = useRouter();
  const { staff, till, setCurrentTill, logout } = useStaff();
  const [pendingHandovers, setPendingHandovers] = useState([]);
  const [closedTill, setClosedTill] = useState(null);
  const [pendingSales, setPendingSales] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const seenRef = useRef(null);
  const announcedRef = useRef("");
  const tillId = till?._id ? String(till._id) : "";
  const canCloseTill = hasPosPermission(staff, "sidebarAccess") && hasPosPermission(staff, "closeTill");

  const markSeen = (handovers) => {
    if (!seenRef.current) seenRef.current = readSeen();
    handovers.forEach((handover) => seenRef.current.add(String(handover._id)));
    try {
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenRef.current]));
    } catch {
      // ignore storage errors
    }
  };

  const checkTill = useCallback(async () => {
    if (!tillId || tillId.startsWith("offline-till-") || !getOnlineStatus()) return;
    try {
      const res = await fetch(`/api/till/${tillId}/handover`);
      if (!res.ok) return;
      const data = await res.json();
      const cloudTill = data?.till;
      if (!cloudTill) return;

      const myDeviceId = getDeviceId();
      if (cloudTill.status !== "OPEN") {
        // Closed here: this terminal is already logging out
        if (!cloudTill.closedByDeviceId || cloudTill.closedByDeviceId !== myDeviceId) {
          setPendingSales(await getPendingTransactionsCount());
          setClosedTill(cloudTill);
        }
        return;
      }

      if (!seenRef.current) seenRef.current = readSeen();
      const fresh = (cloudTill.handovers || []).filter(
        (handover) => handover.status === "pending" && handover.deviceId !== myDeviceId && !seenRef.current.has(String(handover._id))
      );
      if (fresh.length > 0) {
        setPendingHandovers(fresh);
        const freshKey = fresh.map((handover) => String(handover._id)).sort().join(",");
        if (freshKey !== announcedRef.current) {
          announcedRef.current = freshKey;
          window.dispatchEvent(new CustomEvent("pos:till-handover:received", { detail: { handovers: fresh } }));
        }
      }
    } catch {
      // Try again on the next check
    }
  }, [tillId]);

  useEffect(() => {
    if (!tillId) return undefined;
    checkTill();
    const timer = setInterval(checkTill, CHECK_INTERVAL_MS);
    window.addEventListener("focus", checkTill);
    window.addEventListener("online", checkTill);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", checkTill);
      window.removeEventListener("online", checkTill);
    };
  }, [tillId, checkTill]);

  const handleLater = () => {
    markSeen(pendingHandovers);
    setPendingHandovers([]);
  };

  const handleCloseNow = () => {
    markSeen(pendingHandovers);
    setPendingHandovers([]);
    window.dispatchEvent(new CustomEvent("pos:close-till:open"));
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      if (getOnlineStatus()) await syncPendingTransactions({ forceRetry: true });
    } catch {
      // Unsynced sales stay queued on this terminal and sync after the next login
    }
    setCurrentTill(null);
    try {
      localStorage.removeItem("till");
    } catch {
      // ignore storage errors
    }
    setClosedTill(null);
    setLoggingOut(false);
    logout();
    router.push("/");
  };

  if (closedTill) {
    return (
      <div className="fixed inset-0 z-[70] bg-primary-900 flex items-center justify-center p-4">
        <div className="bg-white border border-neutral-200 rounded-lg shadow-2xl max-w-md w-full p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center flex-shrink-0">
              <FontAwesomeIcon icon={faLock} className="w-5 h-5 text-primary-700" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-neutral-900">Till closed on another terminal</h3>
              <p className="text-sm text-neutral-600 mt-1">
                {closedTill.closedByDeviceName || "Another terminal"}
                {closedTill.closedByStaffName ? ` (${closedTill.closedByStaffName})` : ""} closed this till
                {closedTill.closedAt ? ` at ${formatTime(closedTill.closedAt)}` : ""}. Log out, then open a new till to keep selling.
              </p>
            </div>
          </div>
          {pendingSales > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {pendingSales} sale{pendingSales === 1 ? "" : "s"} on this terminal had not synced before the close, so
              {pendingSales === 1 ? " it is" : " they are"} not in that end-of-day report. They will sync to the cloud when you log out.
            </p>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full px-4 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold rounded-md transition-colors flex items-center justify-center gap-2"
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
            {loggingOut ? "Syncing & logging out..." : "Log out"}
          </button>
        </div>
      </div>
    );
  }

  if (pendingHandovers.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
        <div className="bg-primary-700 text-white px-5 py-3 flex items-center gap-2">
          <FontAwesomeIcon icon={faCashRegister} className="w-4 h-4" />
          <h3 className="text-sm font-bold uppercase tracking-wide">Till handed over</h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-neutral-700">
            {pendingHandovers.length === 1 ? "Another terminal has" : `${pendingHandovers.length} terminals have`} sent
            {pendingHandovers.length === 1 ? " its" : " their"} sales to the cloud and logged out.
            {canCloseTill
              ? " Close the till on this terminal to merge their sales into today's end-of-day report."
              : " Ask a manager to close the till on this terminal so their sales are included."}
          </p>
          <div className="border border-neutral-200 rounded-md divide-y divide-neutral-200">
            {pendingHandovers.map((handover) => (
              <div key={handover._id} className="px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-800 truncate">{handover.deviceName || "Terminal"}</p>
                  <p className="text-xs text-neutral-500">
                    {handover.staffName ? `${handover.staffName} · ` : ""}sent {formatTime(handover.sentAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-neutral-900 whitespace-nowrap">{formatNaira(handover.totalSales)}</p>
                  <p className="text-xs text-neutral-500">{handover.transactionCount || 0} sale{handover.transactionCount === 1 ? "" : "s"}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleLater}
              className="flex-1 px-4 py-2.5 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-800 font-semibold rounded-md transition-colors"
            >
              {canCloseTill ? "Later" : "OK"}
            </button>
            {canCloseTill && (
              <button
                type="button"
                onClick={handleCloseNow}
                className="flex-1 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-md transition-colors flex items-center justify-center gap-2"
              >
                <FontAwesomeIcon icon={faLock} className="w-4 h-4" />
                Close till now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
