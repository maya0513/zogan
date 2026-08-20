import { render } from "preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import AddToCart from "../../examples/shop/src/islands/AddToCart";

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Shop AddToCart enhancement", () => {
  test("suppresses a second submit while the first mutation is in flight", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal("fetch", fetchMock);

    render(<AddToCart disabled={false} label="Add" productId={1} />, document.body);
    const form = document.querySelector("form");
    const button = document.querySelector("button");
    expect(form).not.toBeNull();
    expect(button).not.toBeNull();

    form?.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }),
    );
    form?.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    resolveResponse?.(
      new Response('{"count":1,"total":6800,"version":1}', {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await vi.waitFor(() => expect(button?.disabled).toBe(false));
  });

  test.each([
    ["network failure", () => Promise.reject(new TypeError("connection reset"))],
    ["non-success response", () => Promise.resolve(new Response("failed", { status: 503 }))],
  ])("never replays an ambiguous mutation after %s", async (_label, response) => {
    const nativeSubmit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(response));

    render(<AddToCart disabled={false} label="Add" productId={1} />, document.body);
    const form = document.querySelector("form");
    const button = document.querySelector("button");

    form?.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }),
    );

    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Reload before trying again",
      ),
    );
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(button?.disabled).toBe(true);
  });
});
