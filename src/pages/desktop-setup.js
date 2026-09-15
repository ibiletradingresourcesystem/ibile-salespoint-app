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

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faCheckCircle,
  faCloud,
  faDatabase,
  faLocationDot,
  faPowerOff,
  faQuestionCircle,
  faTriangleExclamation,
  faUserShield,
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

const STEPS = [
  { key: "connect", label: "CONNECT" },
  { key: "authorise", label: "AUTHORISE" },
  { key: "sync", label: "DOWNLOAD" },
];

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

  useEffect(() => {
    const desktop = getDesktopBridge();
    setBridge(desktop);
    if (!desktop) return;
    desktop.getInfo().then((details) => {
      setInfo(details);
      setInstallationName(details.installationName || "");
    });
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
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

  const connect = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await bridge.cloudLookup({ connectionString });
      if (!result?.ok) throw new Error(result?.error || "Could not reach the cloud database");
      // The app keeps the connection string now; do not hold it in the page any longer
      setConnectionString("");
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

  const enroll = async () => {
    setError("");
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

  const pulled = status?.pull || {};
  const pulledCount = Object.keys(DATA_LABELS).filter((entity) => pulled[entity]).length;
  const offline = status?.cloudReachable === false;
  const stepIndex = STEPS.findIndex((item) => item.key === step);

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

              <label className="block mb-4">
                <span className="text-white font-semibold text-xs flex items-center gap-2 mb-2">
                  <FontAwesomeIcon icon={faCloud} className="w-3.5 h-3.5" />
                  CLOUD DATABASE CONNECTION STRING
                </span>
                <input
                  className="w-full text-gray-900 placeholder-gray-400"
                  type="password"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="mongodb+srv://user:password@cluster.mongodb.net/"
                  value={connectionString}
                  onChange={(event) => setConnectionString(event.target.value.trim())}
                />
                <span className="mt-1.5 block text-xs text-cyan-200">Stored encrypted on this computer only.</span>
              </label>

              <label className="block mb-5">
                <span className="text-white font-semibold text-xs mb-2 block">NAME FOR THIS COMPUTER</span>
                <input
                  className="w-full text-gray-900"
                  required
                  maxLength={80}
                  value={installationName}
                  onChange={(event) => setInstallationName(event.target.value)}
                />
              </label>

              <ErrorBox message={error} />
              <button
                type="submit"
                disabled={busy || !connectionString || !installationName.trim()}
                className={primaryButton}
              >
                {busy ? "CONNECTING…" : "CONTINUE"}
              </button>
              <p className="mt-4 text-[11px] text-cyan-300 text-center">Installation ID: {info?.installationId}</p>
            </form>
          </div>
        )}

        {step === "authorise" && (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4 p-3 bg-cyan-800 rounded-lg border-2 border-cyan-600 text-white">
                <p className="font-bold text-sm text-white">{lookup?.storeName || "Your store"}</p>
                <p className="text-xs text-cyan-200">Connected to {lookup?.host}</p>
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
          <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
            <div className={panel}>
              <h1 className="text-white font-bold text-lg tracking-wide">DOWNLOADING STORE DATA</h1>
              <p className="text-cyan-100 text-sm mb-4">What the till needs to work without internet. Keep the app open.</p>

              {offline && (
                <div className="mb-3 p-2.5 bg-yellow-500 text-cyan-900 rounded-lg text-xs font-bold flex items-center gap-2">
                  <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5" />
                  Waiting for an internet connection…
                </div>
              )}
              {status?.lastError && !offline && <ErrorBox message={`${status.lastError} Retrying automatically.`} />}

              <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden mb-4">
                <div
                  className="h-full bg-gradient-to-r from-cyan-300 to-green-300 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((pulledCount / Object.keys(DATA_LABELS).length) * 100)}%` }}
                />
              </div>

              <ul className="space-y-2">
                {Object.entries(DATA_LABELS).map(([entity, label]) => {
                  const done = Boolean(pulled[entity]);
                  const active = status?.progress?.entity === entity;
                  return (
                    <li key={entity} className="flex items-center justify-between text-sm bg-cyan-900/40 rounded-lg px-3 py-2">
                      <span className={done ? "text-white font-semibold" : "text-cyan-200"}>{label}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        done ? "bg-green-500 text-white" : active ? "bg-yellow-400 text-cyan-900" : "bg-cyan-700 text-cyan-200"
                      }`}>
                        {done ? "READY" : active ? "DOWNLOADING" : "WAITING"}
                      </span>
                    </li>
                  );
                })}
              </ul>
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
