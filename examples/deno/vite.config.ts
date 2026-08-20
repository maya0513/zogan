import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { zoganVite } from "../../src/vite/index.ts";

const root = import.meta.dirname;
const clientEntry = fileURLToPath(new URL("../../src/client/index.ts", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: [{ find: "zogan/client", replacement: clientEntry }],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/client.ts",
      formats: ["es"],
      fileName: () => "client.js",
    },
  },
  plugins: [zoganVite({ islandsDir: "src/islands" })],
});
