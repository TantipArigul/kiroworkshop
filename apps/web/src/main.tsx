import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/crimson-pro/600.css';
import '@fontsource/crimson-pro/700.css';
import './styles/tokens.css';
import './components/ui/styles.css';
import './app.css';
import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element is unavailable.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
