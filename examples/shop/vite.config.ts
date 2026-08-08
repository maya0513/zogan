import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { zoganVite } from "zogan/vite";

export default defineConfig({
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: { client: "src/client.ts" },
          output: { entryFileNames: "assets/client.js" },
        },
      },
    },
  },
  plugins: [zoganVite({ islandsDir: "src/islands" }), cloudflare()],
});
