// Service Worker for POS Offline Support
const CACHE_NAME = 'pos-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Offline fallback HTML page - styled professional POS offline page
const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>POS - Offline Mode</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0e7490 0%, #155e75 50%, #164e63 100%);
      color: white;
      overflow: hidden;
    }

    .container {
      text-align: center;
      max-width: 480px;
      width: 90%;
      padding: 2.5rem;
      animation: fadeIn 0.6s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .icon-wrapper {
      width: 120px;
      height: 120px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 2rem;
      backdrop-filter: blur(10px);
      border: 2px solid rgba(255, 255, 255, 0.15);
      position: relative;
    }

    .icon-wrapper::after {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: rgba(255, 255, 255, 0.3);
      animation: spin 3s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .wifi-icon {
      width: 56px;
      height: 56px;
      opacity: 0.9;
    }

    .wifi-icon path {
      fill: none;
      stroke: white;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .slash {
      stroke: #f59e0b !important;
      stroke-width: 2.5;
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
      letter-spacing: -0.02em;
    }

    .subtitle {
      font-size: 1rem;
      color: rgba(255, 255, 255, 0.75);
      margin-bottom: 2rem;
      line-height: 1.6;
    }

    .status-card {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 2rem;
      backdrop-filter: blur(10px);
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0;
    }

    .status-row:not(:last-child) {
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .status-label {
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.6);
    }

    .status-value {
      font-size: 0.875rem;
      font-weight: 600;
    }

    .status-offline {
      color: #fbbf24;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-offline::before {
      content: '';
      width: 8px;
      height: 8px;
      background: #fbbf24;
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }

    .status-ok {
      color: #34d399;
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 1rem 1.5rem;
      background: white;
      color: #0e7490;
      font-size: 1rem;
      font-weight: 700;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-bottom: 0.75rem;
      letter-spacing: 0.01em;
    }

    .btn-primary:hover {
      background: #f0f9ff;
      transform: translateY(-1px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-primary svg {
      width: 20px;
      height: 20px;
    }

    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 0.875rem 1.5rem;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      font-size: 0.9rem;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .tip {
      margin-top: 2rem;
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.45);
      line-height: 1.5;
    }

    .spinner {
      display: none;
      animation: spin 1s linear infinite;
    }

    .btn-primary.loading .spinner { display: inline-block; }
    .btn-primary.loading .btn-text { display: none; }

    @media (max-width: 480px) {
      .container { padding: 1.5rem; }
      h1 { font-size: 1.5rem; }
      .icon-wrapper { width: 100px; height: 100px; }
      .wifi-icon { width: 44px; height: 44px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon-wrapper">
      <svg class="wifi-icon" viewBox="0 0 24 24">
        <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9z"/>
        <path d="M5 13l2 2c2.76-2.76 7.24-2.76 10 0l2-2C14.14 8.14 9.87 8.14 5 13z"/>
        <path d="M9 17l3 3 3-3c-1.65-1.66-4.34-1.66-6 0z"/>
        <line class="slash" x1="3" y1="3" x2="21" y2="21"/>
      </svg>
    </div>

    <h1>You're Offline</h1>
    <p class="subtitle">
      The POS system needs an internet connection to load.<br>
      Your saved data is safe and will sync when reconnected.
    </p>

    <div class="status-card">
      <div class="status-row">
        <span class="status-label">Network Status</span>
        <span class="status-value status-offline">Disconnected</span>
      </div>
      <div class="status-row">
        <span class="status-label">Local Data</span>
        <span class="status-value status-ok">Safe & Stored</span>
      </div>
      <div class="status-row">
        <span class="status-label">Time</span>
        <span class="status-value" id="currentTime">--:--</span>
      </div>
    </div>

    <button class="btn-primary" id="retryBtn" onclick="handleRetry()">
      <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 12a9 9 0 11-6.219-8.56"/>
      </svg>
      <span class="btn-text">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
        </svg>
        Try Again
      </span>
    </button>

    <button class="btn-secondary" onclick="handleGoLogin()">
      Return to Login
    </button>

    <p class="tip">
      Tip: Check your Wi-Fi or network cable connection.<br>
      The page will automatically reload when the connection is restored.
    </p>
  </div>

  <script>
    // Update clock
    function updateTime() {
      const now = new Date();
      document.getElementById('currentTime').textContent = 
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    updateTime();
    setInterval(updateTime, 1000);

    // Retry
    function handleRetry() {
      const btn = document.getElementById('retryBtn');
      btn.classList.add('loading');
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }

    function handleGoLogin() {
      window.location.href = '/';
    }

    // Auto-reload when connection is restored
    window.addEventListener('online', function() {
      document.querySelector('h1').textContent = 'Reconnected!';
      document.querySelector('.subtitle').textContent = 'Connection restored. Reloading...';
      document.querySelector('.status-offline').innerHTML = '<span style="color:#34d399">\\u2022 Connected</span>';
      setTimeout(() => { window.location.reload(); }, 1000);
    });
  </script>
</body>
</html>`;

// Install event - cache static assets and offline fallback
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the offline fallback page
      cache.put(
        new Request('/_offline'),
        new Response(OFFLINE_FALLBACK_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      );
      // Try to cache static assets
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('⚠️ Some static assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activated');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - network-first strategy with cache fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API requests - let them go through normally (handled by IndexedDB)
  if (url.pathname.startsWith('/api/')) return;

  // Skip websocket and dev server requests
  if (url.pathname.includes('_next/webpack') || 
      url.pathname.includes('__nextjs') ||
      url.protocol === 'ws:' ||
      url.protocol === 'wss:') return;

  event.respondWith(
    // Network-first strategy
    fetch(request)
      .then((response) => {
        // Clone the response for caching
        const responseClone = response.clone();
        
        // Cache successful responses
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        
        return response;
      })
      .catch(async () => {
        // Network failed, try cache
        const cachedResponse = await caches.match(request);
        
        if (cachedResponse) {
          console.log('📦 Serving from cache:', request.url);
          return cachedResponse;
        }
        
        // For navigation requests, return the cached index or offline fallback page
        if (request.mode === 'navigate') {
          const indexCache = await caches.match('/');
          if (indexCache) {
            console.log('📦 Serving cached index for navigation');
            return indexCache;
          }
          
          // Return styled offline fallback page
          const offlinePage = await caches.match('/_offline');
          if (offlinePage) {
            console.log('📦 Serving offline fallback page');
            return offlinePage;
          }
          
          // Last resort - inline offline HTML
          return new Response(OFFLINE_FALLBACK_HTML, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        
        // For non-navigation requests, return a simple error
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      })
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('🚀 POS Service Worker loaded');
