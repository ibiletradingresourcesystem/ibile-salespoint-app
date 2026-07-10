/**
 * ConfirmDialog Component
 * 
 * Replaces window.confirm() with a proper UI modal
 * that matches the POS system design.
 */
import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";

function ConfirmModal({ title, message, confirmLabel, cancelLabel, variant, onConfirm, onCancel }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = (result) => {
    setVisible(false);
    setTimeout(() => (result ? onConfirm : onCancel)?.(), 200);
  };

  const btnColor = variant === "danger"
    ? "bg-red-600 hover:bg-red-700"
    : "bg-cyan-600 hover:bg-cyan-700";

  return (
    <div className={`fixed inset-0 z-[110] flex items-center justify-center transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}>
      <div className="absolute inset-0 bg-black/40" onClick={() => handleClose(false)} />
      <div className={`relative bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden transition-all duration-200 ${visible ? "scale-100" : "scale-95"}`}>
        <div className="p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
            <FontAwesomeIcon icon={faExclamationTriangle} className="w-7 h-7 text-amber-500" />
          </div>
          {title && <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>}
          <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
        </div>
        <div className="flex border-t border-gray-100">
          <button
            onClick={() => handleClose(false)}
            className="flex-1 py-3.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition border-r border-gray-100"
          >
            {cancelLabel || "Cancel"}
          </button>
          <button
            onClick={() => handleClose(true)}
            className={`flex-1 py-3.5 text-sm font-semibold text-white ${btnColor} transition`}
          >
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ConfirmDialog Container - listens for confirm requests via events
 */
export function ConfirmDialogContainer() {
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      const { message, title, confirmLabel, cancelLabel, variant, resolve } = e.detail || {};
      setDialog({ message, title, confirmLabel, cancelLabel, variant, resolve });
    };
    window.addEventListener("confirm:show", handler);
    return () => window.removeEventListener("confirm:show", handler);
  }, []);

  if (!dialog) return null;

  return (
    <ConfirmModal
      {...dialog}
      onConfirm={() => { dialog.resolve?.(true); setDialog(null); }}
      onCancel={() => { dialog.resolve?.(false); setDialog(null); }}
    />
  );
}

/**
 * Show a confirmation dialog. Returns a Promise<boolean>.
 * Usage: const ok = await showConfirm("Reset settings to defaults?");
 */
export function showConfirm(message, options = {}) {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent("confirm:show", {
        detail: { message, resolve, ...options },
      })
    );
  });
}
