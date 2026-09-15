/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Desktop builds (scripts/desktop/build-server.js) produce a self-contained server for Electron.
  // Vercel builds are unaffected.
  ...(process.env.BUILD_TARGET === 'desktop' ? { output: 'standalone' } : {}),
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
    deviceSizes: [360, 414, 640, 768, 1024, 1280],
    imageSizes: [48, 64, 96, 128, 192, 256, 384],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'http',
        hostname: '127.0.0.1',
      },
    ],
  },
};

export default nextConfig;
