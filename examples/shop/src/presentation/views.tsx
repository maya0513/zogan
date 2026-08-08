import type { ComponentChildren } from "preact";
import { Island, Partial, StoreSnapshot } from "zogan";
import { cartSnapshot, formatPrice } from "../domain/cart";
import type { Cart, Order, Product } from "../domain/types";

const clientEntry = import.meta.env.DEV ? "/src/client.ts" : "/assets/client.js";

export const Layout = ({ children }: { children?: ComponentChildren }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Zogan Objects</title>
      <link rel="stylesheet" href="/styles.css" />
      <script type="module" src={clientEntry} />
    </head>
    <body data-client-nav>
      <header class="site-header">
        <a class="brand" href="/products">
          Zogan Objects
        </a>
        <nav aria-label="Primary">
          <a href="/products">Browse</a>
          <Island name="CartBadge" fragment="/_f/cart-badge" trigger="load">
            <a class="cart-badge" href="/cart">
              Cart <span>—</span>
            </a>
          </Island>
        </nav>
      </header>
      {children}
      <footer>Built as a local Workers + D1 demonstration.</footer>
    </body>
  </html>
);

const AddForm = ({ product, label }: { product: Product; label?: string }) => (
  <Island name="AddToCart" props={{ productId: product.id, label }} trigger="load">
    <form action="/cart/add" method="post">
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="quantity" value="1" />
      <button type="submit" disabled={product.inventory < 1}>
        {label ?? "Add to cart"}
      </button>
    </form>
  </Island>
);

const ProductCard = ({ product }: { product: Product }) => (
  <article class="product-card">
    <a href={`/products/${product.slug}`}>
      <img src={product.image} width="720" height="540" alt="" />
      <p class="eyebrow">{product.category}</p>
      <h2>{product.name}</h2>
    </a>
    <div class="product-meta">
      <strong>{formatPrice(product.price)}</strong>
      <AddForm product={product} />
    </div>
  </article>
);

export const ProductsPage = ({
  products,
  category,
  page,
}: {
  products: Product[];
  category?: string;
  page: number;
}) => {
  const query = (next: number) =>
    `/products?page=${next}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  return (
    <main>
      <section class="hero">
        <p class="eyebrow">Useful things, quietly made</p>
        <h1>Objects for everyday rituals.</h1>
      </section>
      <form class="filters" action="/products" method="get" data-partial="count,catalog,pager">
        <label>
          Category
          <select name="category">
            <option value="">All</option>
            {["bags", "home", "stationery"].map((value) => (
              <option value={value} selected={category === value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>
      <Partial name="count">
        <p class="result-count">{products.length} items on this page</p>
      </Partial>
      <Partial name="catalog">
        <section class="product-grid" aria-label="Products">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </section>
      </Partial>
      <Partial name="pager">
        <nav class="pager" aria-label="Pagination">
          {page > 1 && (
            <a href={query(page - 1)} data-partial="count,catalog,pager">
              Previous
            </a>
          )}
          <span>Page {page}</span>
          {products.length === 4 && (
            <a href={query(page + 1)} data-partial="count,catalog,pager">
              Next
            </a>
          )}
        </nav>
      </Partial>
    </main>
  );
};

export const ProductPage = ({ product }: { product: Product }) => (
  <main class="detail">
    <img src={product.image} width="960" height="720" alt="" />
    <section>
      <p class="eyebrow">{product.category}</p>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <strong class="price">{formatPrice(product.price)}</strong>
      <Island
        name="Stock"
        fragment={`/_f/stock/${product.id}`}
        props={{ inventory: product.inventory }}
      >
        <span>{product.inventory} available</span>
      </Island>
      <AddForm product={product} label="Add one" />
    </section>
  </main>
);

export const CartBadgeFragment = ({ cart }: { cart: Cart }) => {
  const snapshot = cartSnapshot(cart);
  return (
    <>
      <StoreSnapshot name="cart" data={snapshot} />
      <a class="cart-badge" href="/cart">
        Cart <span>{snapshot.count}</span>
      </a>
    </>
  );
};

export const CartPage = ({ cart }: { cart: Cart }) => {
  const snapshot = cartSnapshot(cart);
  return (
    <main>
      <StoreSnapshot name="cart" data={snapshot} />
      <h1>Your cart</h1>
      {cart.lines.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          <ul class="cart-lines">
            {cart.lines.map((line) => (
              <li>
                <span>
                  {line.product.name} × {line.quantity}
                </span>
                <strong>{formatPrice(line.product.price * line.quantity)}</strong>
              </li>
            ))}
          </ul>
          <p class="cart-total">
            Total <strong>{formatPrice(snapshot.total)}</strong>
          </p>
          <form action="/checkout" method="post">
            <button type="submit">Place demo order</button>
          </form>
        </>
      )}
    </main>
  );
};

export const OrderPage = ({ order }: { order: Order }) => (
  <main class="confirmation">
    <p class="eyebrow">Order confirmed</p>
    <h1>Thank you.</h1>
    <p>
      Reference <code>{order.id}</code>
    </p>
    <ul>
      {order.lines.map((line) => (
        <li>
          {line.product.name} × {line.quantity}
        </li>
      ))}
    </ul>
    <strong>{formatPrice(order.total)}</strong>
    <p>
      <a href="/products">Continue browsing</a>
    </p>
  </main>
);

export const FormsPage = ({ values = [] }: { values?: string[] }) => (
  <main>
    <h1>Form behavior</h1>
    <form action="/forms" method="get" data-partial="form-result">
      <input type="hidden" name="action" value="base" />
      <label>
        <input type="checkbox" name="tag" value="linen" checked /> Linen
      </label>
      <label>
        <input type="checkbox" name="tag" value="home" checked /> Home
      </label>
      <button type="submit" name="action" value="preview">
        Preview values
      </button>
    </form>
    <Partial name="form-result">
      <section aria-live="polite" data-form-result>
        <h2>Submitted values</h2>
        <output>{values.join(" | ") || "Nothing submitted"}</output>
      </section>
    </Partial>
    <form action="/native-fallback" method="post" data-fragment="/_f/cart-badge">
      <input type="hidden" name="source" value="fallback" />
      <button type="submit">Exercise native fallback</button>
    </form>
  </main>
);
