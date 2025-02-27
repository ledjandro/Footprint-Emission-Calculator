/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'eco-green': {
          light: '#4CAF50',
          DEFAULT: '#2E7D32',
          dark: '#1B5E20',
        },
        'eco-blue': {
          light: '#64B5F6',
          DEFAULT: '#1976D2',
          dark: '#0D47A1',
        },
      },
      boxShadow: {
        'eco': '0 4px 14px 0 rgba(46, 125, 50, 0.1)',
      },
      animation: {
        'gradient-slow': 'gradient 15s ease infinite',
      },
    },
  },
  plugins: [],
};