import { mergeSnapshots } from "zogan/client";
import { pendingAdds } from "../stores/cart";

interface Props {
  productId: number;
  label?: string;
}

export default function AddToCart({ productId, label = "Add to cart" }: Props) {
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const body = new URLSearchParams();
    for (const [name, value] of new FormData(form, event.submitter).entries()) {
      if (typeof value === "string") body.append(name, value);
    }
    pendingAdds.value += 1;
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body,
        credentials: "same-origin",
        redirect: "manual",
        headers: { Accept: "application/json", "X-Zogan-Request": "fragment" },
      });
      if (
        !response.ok ||
        !response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")
      ) {
        throw new Error(`unexpected response ${response.status}`);
      }
      mergeSnapshots({ cart: await response.json() });
    } catch {
      HTMLFormElement.prototype.submit.call(form);
    } finally {
      pendingAdds.value -= 1;
    }
  };

  return (
    <form action="/cart/add" method="post" onSubmit={submit}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="quantity" value="1" />
      <button type="submit">{pendingAdds.value > 0 ? "Adding…" : label}</button>
    </form>
  );
}
