/**
 * Desktop app first-run setup, styled like the staff login screen.
 *
 * 1. Connect:   the connection string of the customer's cloud MongoDB
 * 2. Authorise: location + a manager/admin passcode (registers this installation)
 * 3. Download:  store, staff, products and settings into the local database
 *
 * The connection string is handed to the Electron main process (window.posDesktop), which tests
 * it, keeps it encrypted, and never gives it back to this page. The page clears it straight away.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faCheck,
  faCheckCircle,
  faChevronDown,
  faChevronUp,
  faCircleNotch,
  faCloud,
  faDatabase,
  faEraser,
  faEye,
  faEyeSlash,
  faFileAlt,
  faLocationDot,
  faPowerOff,
  faQuestionCircle,
  faRotateRight,
  faTriangleExclamation,
  faUserShield,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { getDesktopBridge } from "@/src/lib/desktopClient";
import DesktopSystemMenu from "@/src/components/desktop/DesktopSystemMenu";
import PinPad from "@/src/components/desktop/PinPad";

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

// Share of the download progress bar (connecting and checking the registration take the other 10)
const DATA_WEIGHTS = {
  store: 6,
  systemthemes: 3,
  tenders: 4,
  categories: 5,
  promotions: 4,
  staff: 6,
  customers: 8,
  products: 54,
};

const STEPS = [
  { key: "connect", label: "CONNECT" },
  { key: "authorise", label: "AUTHORISE" },
  { key: "sync", label: "DOWNLOAD" },
];

const secondaryButton =
  "px-3 py-2 rounded-lg border border-cyan-400/70 text-white text-xs font-bold hover:bg-cyan-700 transition flex items-center justify-center gap-2 disabled:opacity-50";

const formatNumber = (value) => (typeof value === "number" ? value.toLocaleString("en-NG") : "");
const formatTime = (value) => (value ? new Date(value).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

function downloadPercent(status) {
  const details = status?.pullDetails || {};
  const progress = status?.progress;
  const anyDone = Object.values(details).some((entry) => entry?.lastPulledAt);
  const connected = anyDone || ["check", "push", "pull"].includes(progress?.step);
  const checked = anyDone || ["push", "pull"].includes(progress?.step);
  let value = (connected ? 5 : 0) + (checked ? 5 : 0);
  for (const [entity, weight] of Object.entries(DATA_WEIGHTS)) {
    if (details[entity]?.lastPulledAt) value += weight;
    else if (progress?.entity === entity && progress.total) value += weight * Math.min(1, (progress.done || 0) / progress.total);
  }
  return Math.min(100, Math.round(value));
}

function currentActivity(status) {
  const progress = status?.progress;
  if (!status?.running || !progress) return null;
  if (progress.step === "connect") return "Connecting to the cloud database";
  if (progress.step === "check") return "Checking this POS's registration";
  if (progress.step === "push") return "Sending changes made on this computer";
  const label = DATA_LABELS[progress.entity] || "store data";
  if (progress.detail) return `${label}: ${progress.detail}`;
  if (progress.total) return `Downloading ${label.toLowerCase()} — ${formatNumber(progress.done || 0)} of ${formatNumber(progress.total)}`;
  return `Downloading ${label.toLowerCase()}`;
}

/** Live steps while connecting or authorising (sent by the app, no credentials). */
function StepList({ steps, busy, failed }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-4 space-y-1.5 rounded-lg bg-cyan-900/50 border border-cyan-700 p-3 text-xs">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const state = last && busy ? "active" : last && failed ? "failed" : "done";
        return (
          <li key={`${step.at}-${index}`} className="flex items-start gap-2">
            <span className="mt-0.5 w-3.5 flex-shrink-0 text-center">
              {state === "active" && <FontAwesomeIcon icon={faCircleNotch} spin className="w-3.5 h-3.5 text-yellow-300" />}
              {state === "done" && <FontAwesomeIcon icon={faCheck} className="w-3.5 h-3.5 text-green-300" />}
              {state === "failed" && <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5 text-red-300" />}
            </span>
            <span className={state === "active" ? "text-white font-semibold" : state === "failed" ? "text-red-200" : "text-cyan-100"}>{step.message}</span>
            <span className="ml-auto text-cyan-300 tabular-nums">{formatTime(step.at)}</span>
          </li>
        );
      })}
    </ol>
  );
}

const headerButton =
  "px-4 py-1.5 border-2 border-white text-white rounded-full font-semibold text-sm hover:bg-cyan-600 transition flex items-center gap-2";
const panel = "w-full max-w-xl bg-cyan-800/80 rounded-xl p-6 border border-cyan-600 shadow-2xl";
const primaryButton =
  "w-full py-3 font-bold text-base border border-cyan-500/60 shadow-md rounded-lg transition bg-cyan-400 hover:bg-cyan-300 text-cyan-900 disabled:bg-gray-400 disabled:text-gray-600 disabled:cursor-not-allowed";

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div className="w-full mb-3 p-2.5 bg-red-600/95 text-white rounded-lg text-xs text-center font-semibold border border-red-400">
      {message}
    </div>
  );
}

function SetupHelp({ onClose }) {
  return (
    <div className="desktop-no-drag fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-[min(92vw,600px)] bg-gradient-to-b from-cyan-700 to-cyan-800 border border-cyan-500/60 rounded-2xl shadow-2xl p-6 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-bold text-lg tracking-wide">SETTING UP THIS POS</h2>
        <ul className="mt-4 space-y-3 text-sm text-cyan-50">
          <li>
            <span className="font-bold text-white">Connection string:</span> in MongoDB Atlas open your cluster, choose
            Connect → Drivers, copy the string and put in the database user&apos;s password. It starts with
            <span className="font-mono"> mongodb+srv://</span>.
          </li>
          <li>
            <span className="font-bold text-white">Cannot reach the database:</span> check the internet connection and that
            Atlas → Network Access allows this shop&apos;s internet address.
          </li>
          <li>
            <span className="font-bold text-white">Authorise:</span> a manager or admin chooses the location this till serves
            and enters their usual 4-digit passcode.
          </li>
          <li>
            <span className="font-bold text-white">Afterwards:</span> the till works without internet. Sales are saved on this
            computer and sync to the cloud database automatically.
          </li>
        </ul>
        <button type="button" onClick={onClose} className={`mt-6 ${primaryButton}`}>
          CLOSE
        </button>
      </div>
    </div>
  );
}

export default function DesktopSetup() {
  const [bridge, setBridge] = useState(undefined);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState("loading");
  const [clock, setClock] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const [connectionString, setConnectionString] = useState("");
  const [installationName, setInstallationName] = useState("");
  const [lookup, setLookup] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showConnectionString, setShowConnectionString] = useState(false);
  const [setupSteps, setSetupSteps] = useState([]);
  const [online, setOnline] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [resetMessage, setResetMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [manualEntry, setManualEntry] = useState(false);
  const autoConnectTried = useRef(false);

  useEffect(() => {
    const desktop = getDesktopBridge();
    setBridge(desktop);
    if (!desktop) return undefined;
    desktop.getInfo().then((details) => {
      setInfo(details);
      setInstallationName(details.installationName || "");
    });
    return desktop.onSetupStep?.((step) => setSetupSteps((steps) => [...steps, step].slice(-12)));
  }, []);

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }));
      setNow(Date.now());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // This computer's own internet connection, to tell "no internet" apart from "cloud database not answering"
  useEffect(() => {
    if (!bridge || step !== "sync") return undefined;
    const check = () => bridge.getNetworkStatus?.().then((result) => setOnline(Boolean(result?.online))).catch(() => {});
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [bridge, step]);

  useEffect(() => {
    if (!bridge) return undefined;
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch("/api/desktop/status", { cache: "no-store" });
        const data = await response.json();
        if (!stopped) setStatus(data);
      } catch {
        // The local service restarts briefly after setup
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
      // Right after setup the local service restarts before it reports enrolled; stay on "sync"
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

  // Installers built for the customer carry their cloud database (encrypted); only the host is known here
  const preconfiguredHost = info?.preconfiguredCloudHost || "";
  const usePreconfigured = Boolean(preconfiguredHost) && !manualEntry;

  const connect = async (event) => {
    event?.preventDefault();
    setError("");
    setSetupSteps([]);
    setBusy(true);
    try {
      const result = await bridge.cloudLookup(usePreconfigured ? { preconfigured: true } : { connectionString });
      if (!result?.ok) throw new Error(result?.error || "Could not reach the cloud database");
      // The app keeps the connection string now; do not hold it in the page any longer
      setConnectionString("");
      setShowConnectionString(false);
      setSetupSteps([]);
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

  // Pre-filled database: connect as soon as the first step opens
  useEffect(() => {
    if (step !== "connect" || !usePreconfigured || autoConnectTried.current || !bridge) return;
    autoConnectTried.current = true;
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, usePreconfigured, bridge]);

  const enroll = async () => {
    setError("");
    setSetupSteps([]);
    setBusy(true);
    try {
      const result = await bridge.enroll({ installationName, locationId, staffId, pin });
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

  const exitApp = () => bridge?.quit();

  const resetSetup = async () => {
    setResetMessage("");
    const result = await bridge.resetSetup?.();
    if (result?.ok === false && !result.canceled) setResetMessage(result.error);
  };

  if (bridge === null) {
    return (
      <div className="h-screen bg-gradient-to-b from-cyan-600 to-cyan-700 flex items-center justify-center p-4">
        <div className={`${panel} text-center text-white`}>
          <p className="font-bold text-white">This page is only used by the Ibile POS desktop app.</p>
          <Link href="/" className="mt-4 inline-block text-yellow-300 font-semibold underline">Go to the POS</Link>
        </div>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((item) => item.key === step);
  const percent = downloadPercent(status);
  const activity = currentActivity(status);
  const problem = Boolean(status?.lastError) && !status?.initialSyncComplete;
  const elapsed = status?.running && status?.cycleStartedAt
    ? Math.max(0, Math.round((now - new Date(status.cycleStartedAt).getTime()) / 1000))
    : null;

  return (
    <div className="h-screen bg-gradient-to-b from-cyan-600 to-cyan-700 flex flex-col overflow-hidden pos-mobile-scale">
      {/* Header, same as the staff login screen */}
      <div className="bg-cyan-700 px-4 py-2 flex items-center justify-between border-b-4 border-cyan-800 flex-shrink-0 desktop-drag">
        <div className="flex-1 flex items-center">
          <span className="px-4 py-1.5 border-2 border-white/60 text-white rounded-full font-semibold text-sm flex items-center gap-2">
            <FontAwesomeIcon icon={faDatabase} className="w-4 h-4" />
            FIRST-TIME SETUP
          </span>
        </div>

        <div className="text-center flex flex-col items-center">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mx-auto mb-1 shadow-lg overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="Ibile" className="w-8 h-8 object-contain" />
          </div>
          <p className="text-white font-bold text-xs">{clock}</p>
        </div>

        <div className="flex-1 flex items-center justify-end gap-3">
          <DesktopSystemMenu variant="setup" />
          <button type="button" onClick={() => setShowHelp(true)} className={headerButton}>
            <FontAwesomeIcon icon={faQuestionCircle} className="w-4 h-4" />
            HELP
          </button>
          <button
            type="button"
            onClick={exitApp}
            className="px-4 py-1.5 bg-red-600 text-white rounded-full font-semibold text-sm hover:bg-red-700 transition flex items-center gap-2"
          >
            <FontAwesomeIcon icon={faPowerOff} className="w-4 h-4" />
            EXIT
          </button>
        </div>
      </div>

      {/* Steps */}
      {stepIndex >= 0 && (
        <div className="bg-cyan-800/60 px-4 py-2 flex items-center justify-center gap-2 flex-shrink-0">
          {STEPS.map((item, index) => (
            <React.Fragment key={item.key}>
              <div className={`flex items-center gap-2 text-xs font-bold ${index <= stepIndex ? "text-white" : "text-cyan-300"}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  index < stepIndex ? "bg-green-500 text-white" : index === stepIndex ? "bg-yellow-400 text-cyan-900" : "bg-cyan-700 text-cyan-200"
                }`}>
                  {index < stepIndex ? "✓" : index + 1}
                </span>
                {item.label}
              </div>
              {index < STEPS.length - 1 && <div className="w-10 h-0.5 bg-cyan-600" />}
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0">
        {step === "loading" && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className={`${panel} text-center`}>
              <p className="text-white font-bold text-lg mb-2">Starting Ibile POS</p>
              <p className="text-cyan-100 text-sm mb-4">Checking this computer&apos;s setup…</p>
              <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden">
                <div className="h-full w-2/5 bg-gradient-to-r from-cyan-300 to-green-300 rounded-full animate-pulse" />
              </div>
            </div>
          </div>
        )}

        {step === "connect" && (
          <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
            <form onSubmit={connect} className={panel}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-lg overflow-hidden flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/logo.png" alt="Ibile" className="w-11 h-11 object-contain" />
                </div>
                <div>
                  <h1 className="text-white font-bold text-lg tracking-wide">CONNECT TO YOUR CLOUD DATABASE</h1>
                  <p className="text-cyan-100 text-sm">This till works offline and syncs directly with your database.</p>
                </div>
              </div>

              {usePreconfigured ? (
                <div className="mb-5 rounded-lg bg-cyan-900/50 border border-cyan-600 p-3">
                  <p className="text-white font-semibold text-xs flex items-center gap-2">
                    <FontAwesomeIcon icon={faCloud} className="w-3.5 h-3.5" />
                    CLOUD DATABASE
                  </p>
                  <p className="text-white font-mono text-sm mt-1 break-all">{preconfiguredHost}</p>
                  <p className="text-xs text-cyan-200 mt-1">Set up for this store in the installer; stored encrypted on this computer.</p>
                </div>
              ) : (
              <label className="block mb-4">
                <span className="text-white font-semibold text-xs flex items-center gap-2 mb-2">
                  <FontAwesomeIcon icon={faCloud} className="w-3.5 h-3.5" />
                  CLOUD DATABASE CONNECTION STRING
                </span>
                <div className="relative">
                  <input
                    className="w-full text-gray-900 placeholder-gray-400 !pr-12 font-mono text-sm"
                    type={showConnectionString ? "text" : "password"}
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="mongodb+srv://user:password@cluster.mongodb.net/"
                    value={connectionString}
                    onChange={(event) => setConnectionString(event.target.value.trim())}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConnectionString((value) => !value)}
                    title={showConnectionString ? "Hide connection string" : "Show connection string"}
                    aria-label={showConnectionString ? "Hide connection string" : "Show connection string"}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-md text-gray-500 hover:text-cyan-800 hover:bg-gray-100 flex items-center justify-center"
                  >
                    <FontAwesomeIcon icon={showConnectionString ? faEyeSlash : faEye} className="w-4 h-4" />
                  </button>
                </div>
                <span className="mt-1.5 block text-xs text-cyan-200">
                  Stored encrypted on this computer only. Once saved it is never shown again.
                </span>
              </label>
              )}

              <ErrorBox message={error} />
              <button
                type="submit"
                disabled={busy || (!usePreconfigured && !connectionString)}
                className={primaryButton}
              >
                {busy ? "CONNECTING…" : usePreconfigured && error ? "TRY AGAIN" : "CONTINUE"}
              </button>
              <StepList steps={setupSteps} busy={busy} failed={Boolean(error)} />
              {preconfiguredHost && !busy && (
                <button
                  type="button"
                  onClick={() => { setManualEntry((value) => !value); setError(""); setSetupSteps([]); }}
                  className="w-full mt-3 text-xs text-white/70 hover:text-white underline"
                >
                  {manualEntry ? `Use the store's cloud database (${preconfiguredHost})` : "Use a different connection string"}
                </button>
              )}
              <p className="mt-4 text-[11px] text-cyan-300 text-center">Installation ID: {info?.installationId}</p>
            </form>
          </div>
        )}

        {step === "authorise" && (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4 p-3 bg-cyan-800 rounded-lg border-2 border-cyan-600 text-white flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-bold text-sm text-white">{lookup?.storeName || "Your store"}</p>
                  <p className="text-xs text-cyan-200">Connected to {lookup?.host}</p>
                </div>
                <label className="block w-full sm:w-72">
                  <span className="text-white font-semibold text-[11px] mb-1 block">NAME FOR THIS COMPUTER</span>
                  <input
                    className="w-full text-gray-900 !py-2 text-sm"
                    maxLength={80}
                    value={installationName}
                    onChange={(event) => setInstallationName(event.target.value)}
                  />
                </label>
              </div>

              <div className="mb-4 bg-cyan-800/80 rounded-xl p-3 border border-cyan-600 shadow-lg">
                <p className="text-white font-bold text-xs mb-2 flex items-center gap-2">
                  <FontAwesomeIcon icon={faLocationDot} className="w-3 h-3" />
                  SELECT LOCATION THIS POS SERVES
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {(lookup?.locations || []).map((location) => (
                    <button
                      key={location._id}
                      type="button"
                      onClick={() => setLocationId(location._id)}
                      className={`px-3 py-2.5 rounded-lg font-bold text-xs transition-all ${
                        locationId === location._id
                          ? "bg-yellow-400 text-cyan-900 ring-2 ring-yellow-300 shadow-md"
                          : "bg-cyan-700 text-white hover:bg-cyan-600 border border-cyan-600"
                      }`}
                    >
                      {location.name}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-white font-semibold text-xs mb-2 flex items-center gap-2">
                <FontAwesomeIcon icon={faUserShield} className="w-3.5 h-3.5" />
                SELECT MANAGER OR ADMIN
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {(lookup?.managers || []).map((member) => (
                  <button
                    key={member._id}
                    type="button"
                    onClick={() => setStaffId(member._id)}
                    className={`p-3 rounded-lg text-center font-semibold transition flex flex-col items-center gap-1 ${
                      staffId === member._id ? "bg-yellow-400 text-cyan-900 ring-2 ring-yellow-300 shadow-lg" : "bg-cyan-800 text-white hover:bg-cyan-700"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold ${
                      staffId === member._id ? "bg-cyan-700 text-white" : "bg-cyan-600 text-white"
                    }`}>
                      {member.name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <div className="font-bold text-xs leading-tight break-words w-full">{member.name}</div>
                    <div className={`text-[10px] px-2 py-0.5 rounded-full ${staffId === member._id ? "bg-white/80 text-cyan-900" : "bg-cyan-700 text-cyan-100"}`}>
                      {member.role}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="w-0.5 bg-cyan-800" />

            <div className="w-2/5 bg-gradient-to-b from-cyan-700 to-cyan-800 p-4 flex items-center justify-center">
              <div className="w-full max-w-sm bg-cyan-900/30 border border-cyan-500/60 rounded-2xl p-5 shadow-2xl flex flex-col items-center">
                <h2 className="text-white font-bold text-lg mb-4 tracking-wide text-center">MANAGER PASSCODE</h2>
                <PinPad value={pin} onChange={setPin} disabled={busy} />
                <div className="w-full max-w-xs mt-4">
                  <ErrorBox message={error} />
                  <button
                    type="button"
                    onClick={enroll}
                    disabled={busy || pin.length !== 4 || !staffId || !locationId}
                    className={primaryButton}
                  >
                    {busy ? "SETTING UP…" : "SET UP THIS POS"}
                  </button>
                  <StepList steps={setupSteps} busy={busy} failed={Boolean(error)} />
                  <button
                    type="button"
                    onClick={() => { setError(""); setPin(""); setStep("connect"); }}
                    className="w-full py-2 mt-2 text-xs text-white/70 hover:text-white underline transition flex items-center justify-center gap-1.5"
                  >
                    <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" />
                    Back to connection
                  </button>
                </div>
                <p className="text-white/60 text-xs mt-3 text-center">Select a location and a manager, then enter their 4-digit passcode</p>
              </div>
            </div>
          </>
        )}

        {step === "sync" && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="w-full max-w-4xl mx-auto grid gap-4 lg:grid-cols-5">
              {/* Progress */}
              <div className="lg:col-span-3 bg-cyan-800/80 rounded-xl p-5 border border-cyan-600 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-white font-bold text-lg tracking-wide">DOWNLOADING STORE DATA</h1>
                    <p className="text-cyan-100 text-sm">What the till needs to work without internet. Keep the app open.</p>
                  </div>
                  <span className="text-3xl font-bold text-white tabular-nums">{percent}%</span>
                </div>

                <div className="mt-4 w-full h-3 bg-cyan-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      problem ? "bg-gradient-to-r from-yellow-400 to-orange-400" : "bg-gradient-to-r from-cyan-300 to-green-300"
                    }`}
                    style={{ width: `${Math.max(percent, 2)}%` }}
                  />
                </div>

                <div className="mt-3 min-h-[2.5rem] flex items-center gap-2 text-sm">
                  {activity ? (
                    <>
                      <FontAwesomeIcon icon={faCircleNotch} spin className="w-4 h-4 text-yellow-300 flex-shrink-0" />
                      <span className="text-white font-semibold">{activity}…</span>
                      {elapsed !== null && <span className="ml-auto text-cyan-200 tabular-nums">{elapsed} s</span>}
                    </>
                  ) : problem ? (
                    <span className="text-yellow-200 font-semibold">Paused: retrying automatically every 15 seconds</span>
                  ) : (
                    <span className="text-cyan-200">Waiting to continue…</span>
                  )}
                </div>

                {problem && (
                  <div className="mt-2 rounded-lg bg-red-600/90 border border-red-400 p-3 text-white">
                    <p className="text-sm font-bold flex items-start gap-2">
                      <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        {online === false ? "This computer is not connected to the internet." : status.lastError}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-red-100">
                      {online === false
                        ? "Connect to the internet; the download continues by itself."
                        : `This computer's internet connection is working; the cloud database is not answering.${status.lastErrorAt ? ` Last attempt ${formatTime(status.lastErrorAt)}.` : ""}`}
                    </p>
                    {status.lastErrorDetail && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowDetails((value) => !value)}
                          className="mt-2 text-xs font-semibold underline flex items-center gap-1"
                        >
                          <FontAwesomeIcon icon={showDetails ? faChevronUp : faChevronDown} className="w-3 h-3" />
                          {showDetails ? "Hide technical details" : "Show technical details"}
                        </button>
                        {showDetails && (
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[11px] font-mono text-red-50">
                            {status.lastErrorStep ? `Step: ${status.lastErrorStep}\n` : ""}
                            {status.lastErrorDetail}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                )}

                <ul className="mt-4 space-y-2">
                  {Object.entries(DATA_LABELS).map(([entity, label]) => {
                    const detail = status?.pullDetails?.[entity] || {};
                    const done = Boolean(detail.lastPulledAt);
                    const active = status?.running && status?.progress?.entity === entity;
                    const { done: count = 0, total } = active ? status.progress : {};
                    return (
                      <li key={entity} className="text-sm bg-cyan-900/40 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className={done || active ? "text-white font-semibold" : "text-cyan-200"}>{label}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-xs text-cyan-100 tabular-nums">
                              {done && typeof detail.count === "number" ? formatNumber(detail.count) : ""}
                              {active && total ? `${formatNumber(count)} / ${formatNumber(total)}` : ""}
                            </span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              done ? "bg-green-500 text-white" : active ? "bg-yellow-400 text-cyan-900" : "bg-cyan-700 text-cyan-200"
                            }`}>
                              {done ? "READY" : active ? "DOWNLOADING" : "WAITING"}
                            </span>
                          </span>
                        </div>
                        {active && total > 0 && (
                          <div className="mt-1.5 h-1.5 bg-cyan-950/60 rounded-full overflow-hidden">
                            <div className="h-full bg-yellow-300 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (count / total) * 100)}%` }} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Activity and actions */}
              <div className="lg:col-span-2 flex flex-col gap-4">
                <div className="bg-cyan-800/80 rounded-xl p-4 border border-cyan-600 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => setShowActivity((value) => !value)}
                    className="w-full flex items-center justify-between text-white font-bold text-xs tracking-wide"
                  >
                    ACTIVITY
                    <FontAwesomeIcon icon={showActivity ? faChevronUp : faChevronDown} className="w-3 h-3" />
                  </button>
                  {showActivity && (
                    <ol className="mt-3 space-y-1.5 max-h-80 overflow-y-auto text-xs">
                      {(status?.activity || []).length === 0 && <li className="text-cyan-200">Nothing yet.</li>}
                      {[...(status?.activity || [])].reverse().map((entry, index) => (
                        <li key={`${entry.at}-${index}`} className="flex gap-2">
                          <span className="text-cyan-300 tabular-nums flex-shrink-0">{formatTime(entry.at)}</span>
                          <span className={entry.level === "error" ? "text-red-200" : entry.level === "warn" ? "text-yellow-200" : "text-cyan-50"}>
                            {entry.message}
                            {entry.repeat > 1 && <span className="text-cyan-300"> ×{entry.repeat}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div className="bg-cyan-800/80 rounded-xl p-4 border border-cyan-600 shadow-2xl space-y-2">
                  <p className="text-white font-bold text-xs tracking-wide">IF SETUP IS STUCK</p>
                  <button type="button" onClick={startSync} disabled={status?.running} className={`w-full ${secondaryButton}`}>
                    <FontAwesomeIcon icon={faRotateRight} className="w-3.5 h-3.5" />
                    {status?.running ? "WORKING…" : "RETRY NOW"}
                  </button>
                  <button type="button" onClick={() => bridge.openLogsFolder()} className={`w-full ${secondaryButton}`}>
                    <FontAwesomeIcon icon={faFileAlt} className="w-3.5 h-3.5" />
                    OPEN LOGS FOLDER
                  </button>
                  <button type="button" onClick={resetSetup} className={`w-full ${secondaryButton} !border-red-300 hover:!bg-red-700`}>
                    <FontAwesomeIcon icon={faEraser} className="w-3.5 h-3.5" />
                    CLEAR SETUP AND START AGAIN
                  </button>
                  <p className="text-[11px] text-cyan-200">
                    Clearing removes the cloud connection and the data downloaded so far from this computer, then restarts at the first
                    step. Nothing in the cloud database changes.
                  </p>
                  <ErrorBox message={resetMessage} />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "ready" && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className={`${panel} text-center`}>
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/images/logo.png" alt="Ibile" className="w-16 h-16 object-contain" />
              </div>
              <h1 className="text-white font-bold text-xl tracking-wide flex items-center justify-center gap-2">
                <FontAwesomeIcon icon={faCheckCircle} className="w-5 h-5 text-green-300" />
                THIS POS IS READY
              </h1>
              <p className="text-cyan-100 text-sm mt-2">
                {info?.storeName ? `${info.storeName} · ` : ""}{info?.locationName || "Location set"} · connected to {status?.cloudHost || "the cloud database"}
              </p>
              <p className="text-cyan-100 text-sm mt-1">Staff log in with their usual passcode. Sales sync to the cloud automatically.</p>
              <button type="button" onClick={() => window.location.replace("/")} className={`mt-6 ${primaryButton}`}>
                OPEN POS
              </button>
            </div>
          </div>
        )}
      </div>

      {showHelp && <SetupHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
