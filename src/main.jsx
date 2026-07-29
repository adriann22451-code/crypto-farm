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
