/**
 * Toast Notification Component
 * 
 * Replaces alert() calls with a smooth, auto-dismissing notification
 * that flows with the POS system design.
 */
import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faExclamationTriangle, faInfoCircle, faTimes, faXmark } from "@fortawesome/free-solid-svg-icons";

const TOAST_VARIANTS = {
  success: {
    bg: "bg-emerald-600",
    icon: faCheck,
    iconBg: "bg-emerald-700",
  },
  error: {
    bg: "bg-red-600",
    icon: faExclamationTriangle,
    iconBg: "bg-red-700",
  },
  warning: {
    bg: "bg-amber-500",
    icon: faExclamationTriangle,
    iconBg: "bg-amber-600",
    text: "text-amber-950",
  },
  info: {
    bg: "bg-cyan-600",
    icon: faInfoCircle,
    iconBg: "bg-cyan-700",
  },
};

export function Toast({ message, variant = "info", duration = 3000, onClose }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (duration > 0) {
      const timer = setTimeout(() => {
        setExiting(true);
        setTimeout(() => onClose?.(), 300);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const style = TOAST_VARIANTS[variant] || TOAST_VARIANTS.info;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-white max-w-sm w-full border border-white/10 transition-all duration-300 ${style.bg} ${style.text || ""} ${
        visible && !exiting ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${style.iconBg}`}>
        <FontAwesomeIcon icon={style.icon} className="w-4 h-4" />
      </div>
      <p className="text-sm font-medium flex-1 leading-snug">{message}</p>
      <button
        onClick={() => { setExiting(true); setTimeout(() => onClose?.(), 300); }}
        className="p-1 hover:bg-white/20 rounded-full transition flex-shrink-0"
      >
        <FontAwesomeIcon icon={faXmark} className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/**
 * Toast Container - manages multiple toasts
 * Use the global `showToast` function exposed via window event.
 */
export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((detail) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, ...detail }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e) => addToast(e.detail || {});
    window.addEventListener("toast:show", handler);
    return () => window.removeEventListener("toast:show", handler);
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          variant={toast.variant}
          duration={toast.duration}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

/**
 * Show a toast notification.
 * Call from anywhere: showToast("Message", "success")
 */
export function showToast(message, variant = "info", duration = 3000) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("toast:show", { detail: { message, variant, duration } })
  );
}
