import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

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
