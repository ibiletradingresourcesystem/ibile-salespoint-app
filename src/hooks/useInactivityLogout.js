import { useEffect, useRef, useCallback } from "react";

const INACTIVITY_TIMEOUT = 5 * 60 * 60 * 1000; // 5 hours in milliseconds
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "click"];

export default function useInactivityLogout(onTimeout) {
  const timerRef = useRef(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (typeof onTimeout === "function") onTimeout();
    }, INACTIVITY_TIMEOUT);
  }, [onTimeout]);

  useEffect(() => {
    resetTimer();

    const handler = () => resetTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
    };
  }, [resetTimer]);
}
