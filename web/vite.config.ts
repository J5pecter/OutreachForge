import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API calls to the backend on :4000 so the browser talks to
// a single origin (no CORS setup needed in dev).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
