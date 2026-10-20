import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 開發時把 /api 轉發到後端（wrangler dev，port 3000），前端就不用處理 CORS 或寫死網址。
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 5173,
        proxy: { '/api': 'http://localhost:3000' },
    },
});
