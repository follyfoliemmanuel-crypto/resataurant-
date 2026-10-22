import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * La CSP de index.html est stricte pour la production (aucun script inline).
 * En développement, le préambule inline de React Fast Refresh serait bloqué :
 * on autorise uniquement les scripts inline sur le serveur local.
 */
function relaxCspForDev(): Plugin {
  return {
    name: "savora-relax-csp-dev",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        "script-src 'self';",
        "script-src 'self' 'unsafe-inline';",
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), relaxCspForDev()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
