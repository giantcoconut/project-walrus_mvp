import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: 'oklch(0.982 0.006 85)',
        ink: 'oklch(0.23 0.02 40)',
        muted: 'oklch(0.55 0.02 55)',
        line: 'oklch(0.87 0.01 70)',
        accent: 'oklch(0.56 0.11 36)',
        accentSoft: 'oklch(0.94 0.02 50)',
        olive: 'oklch(0.52 0.05 120)',
      },
      boxShadow: {
        sheet: '0 24px 80px rgba(49, 39, 24, 0.08)',
      },
      maxWidth: {
        reading: '72rem',
      },
      fontFamily: {
        sans: ['var(--font-public-sans)'],
        serif: ['var(--font-editorial)'],
      },
      letterSpacing: {
        terminal: '0.14em',
      },
    },
  },
  plugins: [],
};

export default config;
