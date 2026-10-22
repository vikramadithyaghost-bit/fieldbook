import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FieldApp from './field/FieldApp';
import AdminApp from './admin/AdminApp';
import './styles/base.css';

// One build, two front-ends: /admin is the web dashboard, everything else is the mobile field app.
const isAdmin = /^\/admin(\/|$)/.test(location.pathname);
document.title = isAdmin ? 'Fieldbook admin' : 'Fieldbook';

createRoot(document.getElementById('root')!).render(<StrictMode>{isAdmin ? <AdminApp /> : <FieldApp />}</StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator && !isAdmin) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
