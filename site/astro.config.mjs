import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://mgz-pkmn.com",
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: {
        // Allow importing shared brand SVGs from the repo root
        // (../assets/*) so the logo files have a single source of
        // truth at /assets/. Scoped to ../assets specifically (not
        // the whole parent) so the dev server can't serve anything
        // else from outside site/ if it's bound beyond localhost.
        allow: [".", "../assets"],
      },
    },
  },
});
