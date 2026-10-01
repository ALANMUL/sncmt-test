import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        chalk: '#0f2a22',      // deep board green, used for the hero and sidebar
        field: '#0b6b4f',      // primary action green
        fieldDark: '#08543d',
        paper: '#f4f6f5',
        ink: '#17231f',
        line: '#d9e0dd',
        flag: '#d6283b',       // small red accent, used sparingly
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
        sans: ['system-ui', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
