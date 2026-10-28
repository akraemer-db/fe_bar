import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build output goes to the FastAPI backend so it can serve the SPA.
// Relative base keeps asset URLs working when the backend mounts the static folder.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  build: {
    outDir: "../backend/static",
    emptyOutDir: true,
    // recharts accounts for most of the bundle; the demo is a single screen so one chunk is fine.
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    // Local dev against a running FastAPI backend (ignored in mock mode).
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
}));
