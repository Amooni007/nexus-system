/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        // Scanner targeting line animation
        scanline: {
          '0%, 100%': { transform: 'translateY(0px)', opacity: '1' },
          '50%':       { transform: 'translateY(196px)', opacity: '0.6' },
        },
        // Slide in for result cards
        'slide-in': {
          '0%':   { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        scanline:   'scanline 2s ease-in-out infinite',
        'slide-in': 'slide-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};