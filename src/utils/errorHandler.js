/**
 * Error handling utilities for the POS app
 */

export const ErrorTypes = {
  NETWORK_ERROR: "NETWORK_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SERVER_ERROR: "SERVER_ERROR",
  OFFLINE: "OFFLINE",
  UNKNOWN: "UNKNOWN",
};

/**
 * Parse error from fetch response or exception
 * @param {Error | Response} error
 * @returns {Object} { type, message }
 */
export function parseError(error) {
  if (!error) {
    return {
      type: ErrorTypes.UNKNOWN,
      message: "An unknown error occurred",
    };
  }

  if (error instanceof TypeError) {
    if (error.message.includes("fetch")) {
      return {
        type: ErrorTypes.NETWORK_ERROR,
        message: "Network error. Please check your connection.",
      };
    }
  }

  if (error.message) {
    return {
      type: ErrorTypes.SERVER_ERROR,
      message: error.message,
    };
  }

  return {
    type: ErrorTypes.UNKNOWN,
    message: error.toString ? error.toString() : "An unexpected error occurred",
  };
}

/**
 * Check if app is online
 * @returns {boolean}
 */
export function isOnline() {
  return typeof navigator !== "undefined" && navigator.onLine;
}

/**
 * Log error for debugging
 * @param {string} context
 * @param {Error} error
 */
export function logError(context, error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${context}:`, error);

  // Could send to monitoring service here
  // e.g., Sentry, LogRocket, etc.
}
