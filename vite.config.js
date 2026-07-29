import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Some TON SDK dependencies (@ton/core and friends) were written for
    // Node.js and reference the `global` object, which doesn't exist in
    // browsers. Buffer itself is polyfilled separately in src/main.jsx.
    global: 'globalThis',
  },
});
