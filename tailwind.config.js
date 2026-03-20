/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#dde7ff',
          200: '#c3d2fe',
          300: '#9db2fd',
          400: '#7a8cf9',
          500: '#5c6df3',
          600: '#4550e6',
          700: '#3840cb',
          800: '#3036a4',
          900: '#2d3381',
        },
      },
    },
  },
  plugins: [],
}
