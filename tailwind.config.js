/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './templates/**/*.ejs',
    './src/client/**/*.ts',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0f1117',
          800: '#161822',
          700: '#1e2030',
          600: '#262840',
        },
        accent: {
          DEFAULT: '#7c3aed',
          light: '#a78bfa',
        },
      },
    },
  },
  plugins: [],
};
