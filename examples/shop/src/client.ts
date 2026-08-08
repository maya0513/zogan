import { start } from "zogan/client";
import AddToCart from "./islands/AddToCart";
import CartBadge from "./islands/CartBadge";
import Stock from "./islands/Stock";

start({
  islands: { AddToCart, CartBadge, Stock },
  refreshOnRestore: ["/_f/cart-badge"],
});
