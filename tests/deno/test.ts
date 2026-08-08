type TestBody = () => void | Promise<void>;

const runtime = globalThis as unknown as {
  Deno: { test(name: string, body: TestBody): void };
};

/** Deno.test without adding Deno globals to the Node-based repository type checker. */
export const denoTest = (name: string, body: TestBody): void => runtime.Deno.test(name, body);
