import { createRoot } from 'react-dom/client';
import { App } from './App';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import './style.css';

document.documentElement.dataset.platform = /Mac/.test(navigator.platform) ? 'mac' : 'windows';
createRoot(document.getElementById('root')!).render(<App />);
