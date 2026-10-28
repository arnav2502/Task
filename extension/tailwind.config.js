import defaultColors from 'tailwindcss/colors';

/** Colour backed by a CSS variable (space-separated RGB) so dark / light themes can swap it. */
const v = (name) => `rgb(var(--tp-${name}) / <alpha-value>)`;

/** Light accent shades (100–300) used as text on dark surfaces; light mode darkens them (see index.css). */
const accent = (hue) => ({ ...defaultColors[hue], 100: v(`${hue}-100`), 200: v(`${hue}-200`), 300: v(`${hue}-300`) });

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "white" is the foreground colour: white text / white overlays in dark mode, slate-900 in light mode.
        white: v('white'),
        // Always-white (text on coloured buttons, logo tiles).
        snow: '#ffffff',
        ink: {
          950: v('ink-950'),
          900: v('ink-900'),
          850: v('ink-850'),
          800: v('ink-800'),
          750: v('ink-750'),
          700: v('ink-700'),
          600: v('ink-600'),
          500: v('ink-500'),
        },
        slate: {
          ...defaultColors.slate,
          100: v('slate-100'),
          200: v('slate-200'),
          300: v('slate-300'),
          400: v('slate-400'),
          500: v('slate-500'),
          600: v('slate-600'),
        },
        rose: accent('rose'),
        indigo: accent('indigo'),
        emerald: accent('emerald'),
        amber: accent('amber'),
        sky: accent('sky'),
        violet: accent('violet'),
        cyan: accent('cyan'),
        teal: accent('teal'),
        brand: { 400: '#818CF8', 500: '#6366F1', 600: '#4F46E5' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: 'var(--tp-shadow-card)',
        glow: '0 0 0 1px rgba(99,102,241,0.35), 0 8px 30px -8px rgba(99,102,241,0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in': { from: { transform: 'translateX(24px)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        'pop-in': { from: { transform: 'scale(0.97)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in': 'slide-in 200ms ease-out',
        'pop-in': 'pop-in 150ms ease-out',
      },
    },
  },
  plugins: [],
};
