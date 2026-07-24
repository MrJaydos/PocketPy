// Client entry point: mount React, wrap it in the router + auth provider, and wire
// up the service worker so the app is installable and works offline.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { AuthProvider } from './state/auth.jsx';
import App from './App.jsx';
import './styles/theme.css';

// autoUpdate registration: the service worker updates itself in the background.
registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
