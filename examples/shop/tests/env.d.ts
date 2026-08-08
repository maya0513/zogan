declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    TEST_SEED: string;
  }

  interface GlobalProps {
    mainModule: typeof import("../src/worker");
  }
}
