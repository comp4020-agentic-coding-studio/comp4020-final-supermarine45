import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const backend = process.env.BACKEND_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": backend,
      "/auth": backend,
      "/readme": backend,
      "/socket.io": { target: backend, ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
