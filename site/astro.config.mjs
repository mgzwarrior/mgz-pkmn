import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://mgz-pkmn.com",
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: {
        // Allow importing shared assets from the repo root (../assets/*)
        // so the logo SVGs have a single source of truth at /assets/.
        allow: [".."],
      },
    },
  },
});
