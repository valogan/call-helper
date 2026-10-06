import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: double-invoked effects would re-trigger microphone /
// screen-share prompts around the live-capture lifecycle.
createRoot(document.getElementById('root')!).render(<App />);
