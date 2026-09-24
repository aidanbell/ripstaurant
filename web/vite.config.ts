import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // MapLibre starts its worker as a module worker (src/pages/map/ClosureMap.tsx).
  worker: { format: "es" },
});
