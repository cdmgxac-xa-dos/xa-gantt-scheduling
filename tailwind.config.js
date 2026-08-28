/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          ink: '#132A3A',
          teal: '#0E7C86',
          accent: '#14B8A6',
          tint: '#ECFEFF',
          slate: '#4B5B63',
          line: '#DDE6E8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(19, 42, 58, 0.08), 0 1px 2px rgba(19, 42, 58, 0.06)',
        pop: '0 8px 24px rgba(19, 42, 58, 0.16)',
      },
    },
  },
  plugins: [],
}
