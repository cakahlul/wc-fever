/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Playwright must not be bundled by webpack — it spawns a real browser binary.
    serverComponentsExternalPackages: [
      'playwright',
      'playwright-core',
      'playwright-extra',
      'puppeteer-extra-plugin-stealth',
      'puppeteer-extra-plugin',
      'puppeteer-extra',
      'clone-deep',
      'merge-deep',
    ],
  },
};

export default nextConfig;
