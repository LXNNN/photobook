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
      // 按「窗口高度」适配：1280×720 的屏幕扣掉浏览器工具栏/任务栏后，
      // 视口高度通常只剩 560~600。short 用来在小分辨率下隐藏书架页右侧插画
      screens: {
        short: { raw: '(max-height: 700px)' },
      },
    },
  },
  plugins: [],
}
