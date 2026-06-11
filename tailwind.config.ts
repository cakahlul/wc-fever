import type { Config } from 'tailwindcss';

/**
 * Custom design tokens — "stadium night" theme for World Cup 2026.
 * Three host nations inform the accent palette (USA blue, Canada red, Mexico green)
 * with championship gold as the primary accent.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        night: {
          DEFAULT: '#0a0e1a',
          50: '#1a2238',
          100: '#141b2e',
          200: '#101627',
          300: '#0c1120',
          400: '#0a0e1a',
        },
        pitch: {
          DEFAULT: '#0e3a2c',
          light: '#14543f',
          line: '#2e7d5f',
        },
        gold: {
          DEFAULT: '#e8b541',
          bright: '#ffd166',
          dim: '#9c7a2c',
        },
        hostUsa: '#3c6ff0',
        hostCan: '#e0413e',
        hostMex: '#1f9d55',
        live: '#ff3b5c',
        ice: '#dce6f5',
        mist: '#8b97ad',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'live-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.85)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'live-pulse': 'live-pulse 1.4s ease-in-out infinite',
        shimmer: 'shimmer 2.8s linear infinite',
      },
      boxShadow: {
        glow: '0 0 24px rgba(232, 181, 65, 0.35)',
        'glow-strong': '0 0 40px rgba(255, 209, 102, 0.55)',
      },
    },
  },
  plugins: [],
};

export default config;
