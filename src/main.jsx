import { Buffer } from 'buffer';
// @ton/core (used by src/tonconnect.js for building payment payloads) was
// written for Node.js and expects a global `Buffer` — browsers don't have
// one, so without this the whole app crashes on load with
// "ReferenceError: Buffer is not defined". Must run before any other import.
window.Buffer = window.Buffer || Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { initTelegram } from './telegram.js';
import './storageShim.js';
import App from './App.jsx';

initTelegram();

// Read here (a real Vite module) rather than inside App.jsx, since App.jsx
// is also reused as a plain browser artifact elsewhere where import.meta.env
// isn't available.
window.__BOT_USERNAME__ = import.meta.env.VITE_BOT_USERNAME || null;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
