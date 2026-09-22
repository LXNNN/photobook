/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'paper': '#faf8f5',
        'ink': '#2c2c2c',
        'accent': '#b8a88a',
      },
    },
  },
  plugins: [],
}
