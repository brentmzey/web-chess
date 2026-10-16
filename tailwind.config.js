/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cathedral: {
          dark: '#09080c',
          surface: 'rgba(20, 17, 24, 0.82)',
          surfaceHigh: 'rgba(34, 29, 41, 0.90)',
          gold: '#e5c158',
          outline: 'rgba(229, 193, 88, 0.25)'
        }
      },
      fontFamily: {
        cathedral: ['Cinzel', 'serif'],
        sans: ['Inter', 'sans-serif']
      }
    }
  },
  plugins: []
};
