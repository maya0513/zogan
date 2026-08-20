import type { TargetedSubmitEvent } from "preact";
import { useState } from "preact/hooks";
import type { JsonObject } from "zogan";
import { refreshFragment } from "zogan/client";

export type AddToCartProps = JsonObject & {
  readonly disabled: boolean;
  readonly label: string;
  readonly productId: number;
};

const CART_BADGE_FRAGMENT = "/fragments/cart-badge";
const activeSubmissions = new WeakSet<HTMLFormElement>();

export default function AddToCart({
  disabled,
  label,
  productId,
}: AddToCartProps): preact.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  const submitRequest = async (
    form: HTMLFormElement,
    submitter: SubmitEvent["submitter"],
  ): Promise<void> => {
    const data = new FormData(form, submitter);
    const quantity = Number(data.get("quantity"));
    setPending(true);

    try {
      const response = await fetch("/api/cart/items", {
        body: JSON.stringify({ productId, quantity }),
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")
      ) {
        throw new Error(`unexpected response ${response.status}`);
      }
      await response.json();
      await refreshFragment(CART_BADGE_FRAGMENT);
    } catch {
      // Once a POST has been dispatched, a network failure cannot prove that the
      // server did not commit it. Never replay the mutation automatically.
      setFailed(true);
    } finally {
      activeSubmissions.delete(form);
      setPending(false);
    }
  };

  const submit = (event: TargetedSubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    if (activeSubmissions.has(form)) return;
    activeSubmissions.add(form);
    void submitRequest(form, event.submitter);
  };

  return (
    <form action="/cart/add" method="post" onSubmit={submit}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="quantity" value="1" />
      <button type="submit" disabled={disabled || failed || pending}>
        {pending ? "Adding…" : label}
      </button>
      {failed && <p role="alert">Could not confirm the update. Reload before trying again.</p>}
    </form>
  );
}
