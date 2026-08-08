import { visibleCartCount } from "../stores/cart";

export default function CartBadge() {
  return (
    <a class="cart-badge" href="/cart" aria-label={`${visibleCartCount.value} items in cart`}>
      Cart <span>{visibleCartCount.value}</span>
    </a>
  );
}
