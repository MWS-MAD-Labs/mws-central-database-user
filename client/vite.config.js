import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      // Regex (not the plain string "/api") so this only matches real
      // backend calls under /api/... - a bare "/api" key matches by prefix,
      // which also swallows the /api-clients client-side route (React
      // Router page at src/app/App.jsx) and proxies its reload straight to
      // the backend, which 404s (no such backend route) instead of Vite
      // serving index.html for the SPA to handle.
      "^/api/": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
