import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // strictPort: Google sign-in only allows the origins registered for the Client ID, so never drift to 5174.
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:3000' } },
});
