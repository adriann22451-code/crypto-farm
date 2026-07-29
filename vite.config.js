import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    // @ton/core and its dependencies were written for Node.js and need
    // Buffer/process/global — this plugin properly polyfills them for the
    // browser across the whole dependency graph (a manual `window.Buffer =`
    // assignment in main.jsx isn't reliable because Rollup can evaluate
    // modules in an order where the TON library's code runs before that
    // assignment does).
    nodePolyfills({ include: ['buffer'] }),
  ],
});
