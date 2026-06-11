/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Playwright must not be bundled by webpack — it spawns a real browser binary.
    serverComponentsExternalPackages: ['playwright', 'playwright-core'],
  },
};

export default nextConfig;
