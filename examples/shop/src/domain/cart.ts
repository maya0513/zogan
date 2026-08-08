import type { Cart, CartSnapshot } from "./types";

export const cartSnapshot = (cart: Cart): CartSnapshot => ({
  version: cart.version,
  count: cart.lines.reduce((sum, line) => sum + line.quantity, 0),
  total: cart.lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0),
});

export const unavailableLines = (cart: Cart): Cart["lines"] =>
  cart.lines.filter((line) => line.quantity > line.product.inventory);

export const formatPrice = (value: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
