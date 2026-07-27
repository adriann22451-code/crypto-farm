import React from 'react';
import ReactDOM from 'react-dom/client';
import { initTelegram } from './telegram.js';
import './storageShim.js';
import App from './App.jsx';

initTelegram();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
