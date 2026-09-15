/**
 * Desktop app first-run setup.
 *
 * 1. Connect: the cloud address of the existing System POS deployment
 * 2. Authorise: location + a manager/admin passcode (enrols this installation)
 * 3. Prepare: download store, staff, products and settings into the local database
 *
 * Cloud calls go through the Electron main process (window.posDesktop), which keeps the
 * installation token out of the browser.
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getDesktopBridge } from "@/src/lib/desktopClient";

const DATA_LABELS = {
  store: "Store and locations",
  systemthemes: "Theme",
  tenders: "Payment types",
  categories: "Categories",
  promotions: "Promotions",
  staff: "Staff and permissions",
  customers: "Customers",
  products: "Products and prices",
};

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500";

function Card({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cyan-600 to-cyan-800 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export default function DesktopSetup() {
  const [bridge, setBridge] = useState(undefined);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState("loading");

  const [cloudUrl, setCloudUrl] = useState("");
  const [installationName, setInstallationName] = useState("");
  const [lookup, setLookup] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const desktop = getDesktopBridge();
    setBridge(desktop);
    if (!desktop) return;
    desktop.getInfo().then((details) => {
      setInfo(details);
      setCloudUrl(details.cloudUrl || "");
      setInstallationName(details.installationName || "");
    });
  }, []);

  useEffect(() => {
    if (!bridge) return undefined;
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch("/api/desktop/status", { cache: "no-store" });
        const data = await response.json();
        if (!stopped) setStatus(data);
      } catch {
        // The local service restarts briefly after enrolment
      }
    };
    load();
    const interval = setInterval(load, 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [bridge]);

  useEffect(() => {
    if (!status || !info) return;
    if (status.enrolled) {
      setStep(status.initialSyncComplete ? "ready" : "sync");
    } else {
      // Right after enrolling, the local service restarts before it reports enrolled; stay on "sync"
      setStep((current) => (current === "loading" ? "connect" : current));
    }
  }, [status, info]);

  const startSync = useCallback(() => bridge?.syncNow().catch(() => {}), [bridge]);

  useEffect(() => {
    if (step !== "sync") return undefined;
    startSync();
    const interval = setInterval(startSync, 15000);
    return () => clearInterval(interval);
  }, [step, startSync]);

  const connect = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await bridge.cloudLookup({ cloudUrl });
      if (!result?.ok) throw new Error(result?.error || "Could not reach the cloud");
      setLookup(result);
      setLocationId(result.locations[0]?._id || "");
      setStaffId("");
      setPin("");
      setStep("authorise");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enroll = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await bridge.enroll({ cloudUrl, installationName, locationId, staffId, pin });
      if (!result?.ok) throw new Error(result?.error || "Setup failed");
      setPin("");
      setStep("sync");
    } catch (err) {
      setError(err.message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (bridge === null) {
    return (
      <Card title="Desktop setup" subtitle="This page is only used by the Ibile POS desktop app.">
        <Link href="/" className="text-cyan-700 font-semibold">Go to the POS</Link>
      </Card>
    );
  }

  if (step === "loading") {
    return <Card title="Starting Ibile POS" subtitle="Checking this computer's setup…" />;
  }

  const errorBox = error && (
    <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
  );

  if (step === "connect") {
    return (
      <Card title="Set up this POS" subtitle="Connect this computer to your existing System POS.">
        {errorBox}
        <form onSubmit={connect} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Cloud address</span>
            <input
              className={inputClass}
              type="url"
              required
              placeholder="https://your-pos.vercel.app"
              value={cloudUrl}
              onChange={(event) => setCloudUrl(event.target.value.trim())}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Name for this computer</span>
            <input
              className={inputClass}
              required
              maxLength={80}
              value={installationName}
              onChange={(event) => setInstallationName(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-300 text-white font-semibold py-3"
          >
            {busy ? "Connecting…" : "Continue"}
          </button>
        </form>
        <p className="mt-4 text-xs text-gray-500">Installation ID: {info?.installationId}</p>
      </Card>
    );
  }

  if (step === "authorise") {
    return (
      <Card
        title="Authorise this POS"
        subtitle={`${lookup?.storeName || "Your store"} — a manager or admin confirms with their passcode.`}
      >
        {errorBox}
        <form onSubmit={enroll} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Location this POS operates</span>
            <select className={inputClass} required value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              {(lookup?.locations || []).map((location) => (
                <option key={location._id} value={location._id}>{location.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Manager or admin</span>
            <select className={inputClass} required value={staffId} onChange={(event) => setStaffId(event.target.value)}>
              <option value="" disabled>Select…</option>
              {(lookup?.managers || []).map((member) => (
                <option key={member._id} value={member._id}>{member.name} ({member.role})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Passcode</span>
            <input
              className={`${inputClass} tracking-[0.5em]`}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4}"
              maxLength={4}
              required
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setError(""); setStep("connect"); }}
              className="flex-1 rounded-lg border border-gray-300 text-gray-700 font-semibold py-3"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy || pin.length !== 4 || !staffId || !locationId}
              className="flex-[2] rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-300 text-white font-semibold py-3"
            >
              {busy ? "Setting up…" : "Set up this POS"}
            </button>
          </div>
        </form>
      </Card>
    );
  }

  const offline = status?.cloudReachable === false;
  const pulled = status?.pull || {};

  if (step === "sync") {
    return (
      <Card
        title="Preparing this POS"
        subtitle="Downloading what the till needs to work without internet. Keep the app open."
      >
        {offline && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            Waiting for an internet connection…
          </div>
        )}
        {status?.lastError && !offline && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {status.lastError} — retrying automatically.
          </div>
        )}
        <ul className="space-y-2">
          {Object.entries(DATA_LABELS).map(([entity, label]) => {
            const done = Boolean(pulled[entity]);
            const active = status?.progress?.entity === entity;
            return (
              <li key={entity} className="flex items-center justify-between text-sm">
                <span className={done ? "text-gray-900" : "text-gray-500"}>{label}</span>
                <span className={done ? "text-green-600 font-semibold" : active ? "text-cyan-700" : "text-gray-400"}>
                  {done ? "Ready" : active ? "Downloading…" : "Waiting"}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  }

  return (
    <Card title="This POS is ready" subtitle={`Connected to ${status?.cloudHost || "the cloud"}.`}>
      <p className="text-sm text-gray-600">
        Sales are saved on this computer first and sync to the cloud automatically. Staff log in with their usual passcode.
      </p>
      <button
        type="button"
        onClick={() => window.location.replace("/")}
        className="mt-6 w-full rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3"
      >
        Open POS
      </button>
    </Card>
  );
}
