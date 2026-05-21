/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        scanline: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(200px)' },
        },
      },
      animation: {
        scanline: 'scanline 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};