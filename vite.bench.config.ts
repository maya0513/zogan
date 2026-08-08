import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "jsdom",
    fileParallelism: false,
    include: ["benchmarks/**/*.bench.ts?(x)"],
  },
});
