import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src"), "@shared": resolve(import.meta.dirname, "shared") } },
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:5174" },
  },
});
