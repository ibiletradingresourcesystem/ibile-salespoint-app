/**
 * POS Error Boundary
 * 
 * Catches React rendering errors and provides recovery options.
 * Redirects to login on critical errors.
 */

import React from 'react';

class POSErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      countdown: 5
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('❌ [ErrorBoundary] Caught error:', error);
    console.error('❌ [ErrorBoundary] Error info:', errorInfo);
    this.setState({ errorInfo });

    // Start countdown to auto-redirect
    this.startCountdown();
  }

  startCountdown = () => {
    this.countdownInterval = setInterval(() => {
      this.setState(prev => {
        if (prev.countdown <= 1) {
          clearInterval(this.countdownInterval);
          this.handleReturnToLogin();
          return { countdown: 0 };
        }
        return { countdown: prev.countdown - 1 };
      });
    }, 1000);
  };

  componentWillUnmount() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }

  handleReturnToLogin = () => {
    // Clear all auth-related localStorage
    localStorage.removeItem('staff');
    localStorage.removeItem('location');
    localStorage.removeItem('shift');
    localStorage.removeItem('staffMember');
    localStorage.removeItem('staffToken');
    
    // Force page reload to reset all state and redirect to login
    window.location.href = '/';
  };

  handleRetry = () => {
    // Clear countdown
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    
    // Reset error state
    this.setState({ 
      hasError: false, 
      error: null, 
      errorInfo: null,
      countdown: 5 
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-10 h-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>

            {/* Error Title */}
            <h1 className="text-2xl font-bold text-gray-800 text-center mb-2">
              Something Went Wrong
            </h1>
            
            {/* Error Message */}
            <p className="text-gray-600 text-center mb-6">
              An unexpected error occurred. We recommend returning to the login page to ensure data integrity.
            </p>

            {/* Countdown */}
            <div className="text-center text-sm text-gray-500 mb-6">
              Auto-redirecting to login in <span className="font-bold text-red-600">{this.state.countdown}</span> seconds...
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={this.handleReturnToLogin}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
              >
                Return to Login
              </button>
              
              <button
                onClick={this.handleRetry}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>

            {/* Error Details (Collapsible) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6">
                <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                  Technical Details
                </summary>
                <div className="mt-2 p-3 bg-gray-100 rounded-lg overflow-auto max-h-40">
                  <pre className="text-xs text-red-600 whitespace-pre-wrap">
                    {this.state.error.toString()}
                    {this.state.errorInfo?.componentStack}
                  </pre>
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default POSErrorBoundary;
