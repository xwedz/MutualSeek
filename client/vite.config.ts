import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development, /api is proxied to the backend (wrangler dev, port 3000), so the frontend needs no CORS or hard-coded URLs.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: { '/api': 'http://localhost:3000' },
    },
});
