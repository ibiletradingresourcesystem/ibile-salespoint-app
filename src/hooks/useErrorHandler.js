/**
 * Error Handler Hook
 * 
 * Provides centralized error handling for the POS system.
 * Automatically redirects to login page on critical errors.
 */

import { useCallback } from 'react';
import { useStaff } from '../context/StaffContext';
import { showToast } from '../components/common/Toast';

// Error types that should redirect to login
const LOGIN_REDIRECT_ERRORS = [
  'UNAUTHORIZED',
  'SESSION_EXPIRED',
  'INVALID_TOKEN',
  'AUTHENTICATION_FAILED',
  'STAFF_NOT_FOUND',
  'TILL_SESSION_INVALID',
];

// HTTP status codes that should redirect to login
const LOGIN_REDIRECT_STATUS_CODES = [401, 403];

// Critical errors that should redirect to login
const CRITICAL_ERROR_PATTERNS = [
  /unauthorized/i,
  /authentication/i,
  /session.*expired/i,
  /invalid.*token/i,
  /not.*logged.*in/i,
  /access.*denied/i,
  /staff.*not.*found/i,
  /permission.*denied/i,
];

export function useErrorHandler() {
  const { logout } = useStaff();

  /**
   * Check if error should trigger login redirect
   */
  const shouldRedirectToLogin = useCallback((error, statusCode) => {
    // Check status code
    if (statusCode && LOGIN_REDIRECT_STATUS_CODES.includes(statusCode)) {
      return true;
    }

    // Check error code
    if (error?.code && LOGIN_REDIRECT_ERRORS.includes(error.code)) {
      return true;
    }

    // Check error message patterns
    const errorMessage = error?.message || error?.toString() || '';
    return CRITICAL_ERROR_PATTERNS.some(pattern => pattern.test(errorMessage));
  }, []);

  /**
   * Handle error and redirect to login if needed
   * Returns true if redirected to login, false otherwise
   */
  const handleError = useCallback((error, options = {}) => {
    const { 
      showAlert = false, 
      alertMessage = null,
      statusCode = null,
      context = 'Unknown',
      forceLogout = false 
    } = options;

    console.error(`❌ [${context}] Error:`, error);

    // Check if we should redirect to login
    if (forceLogout || shouldRedirectToLogin(error, statusCode)) {
      console.log('🔒 Critical error detected - redirecting to login');
      
      // Show alert if needed
      if (showAlert) {
        const message = alertMessage || 'Session expired. Please log in again.';
        showToast(message, 'error', 5000);
      }

      // Logout will clear staff state, which triggers redirect in Layout component
      logout();
      return true;
    }

    // Show non-critical error alert if requested
    if (showAlert) {
      const message = alertMessage || error?.message || 'An error occurred. Please try again.';
      showToast(message, 'error');
    }

    return false;
  }, [logout, shouldRedirectToLogin]);

  /**
   * Wrapper for API calls with automatic error handling
   */
  const withErrorHandling = useCallback(async (asyncFn, options = {}) => {
    try {
      return await asyncFn();
    } catch (error) {
      handleError(error, options);
      throw error; // Re-throw so caller can also handle if needed
    }
  }, [handleError]);

  /**
   * Handle API response errors
   * Call this after fetch() to check response status
   */
  const handleApiError = useCallback(async (response, options = {}) => {
    if (!response.ok) {
      let errorData = null;
      try {
        errorData = await response.json();
      } catch {
        // Response may not be JSON
      }

      const error = new Error(errorData?.message || `API Error: ${response.status}`);
      error.code = errorData?.code;
      error.statusCode = response.status;

      handleError(error, { 
        ...options, 
        statusCode: response.status 
      });

      return { ok: false, error, data: errorData };
    }

    return { ok: true, error: null };
  }, [handleError]);

  /**
   * Force redirect to login (e.g., on critical state errors)
   */
  const forceLoginRedirect = useCallback((message = 'Please log in again.') => {
    console.log('🔒 Force redirect to login triggered');
    if (message) {
      showToast(message, 'error', 5000);
    }
    logout();
  }, [logout]);

  return {
    handleError,
    withErrorHandling,
    handleApiError,
    shouldRedirectToLogin,
    forceLoginRedirect,
  };
}

export default useErrorHandler;
