import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    rolldownOptions: {
      input: {
        en: resolve(root, "index.html"),
        ja: resolve(root, "ja/index.html"),
      },
    },
  },
});
