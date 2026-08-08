import type { Cart, Order, Product } from "../domain/types";

type ProductRow = Product;

interface CartRow extends ProductRow {
  quantity: number;
  version: number;
}

export class VersionConflictError extends Error {}
export class InventoryError extends Error {}

export class ShopRepository {
  constructor(private readonly db: D1Database) {}

  async products(filters: {
    category?: string;
    page: number;
    pageSize: number;
  }): Promise<Product[]> {
    const offset = (filters.page - 1) * filters.pageSize;
    if (filters.category) {
      const result = await this.db
        .prepare("SELECT * FROM products WHERE category = ? ORDER BY id LIMIT ? OFFSET ?")
        .bind(filters.category, filters.pageSize, offset)
        .all<ProductRow>();
      return result.results;
    }
    const result = await this.db
      .prepare("SELECT * FROM products ORDER BY id LIMIT ? OFFSET ?")
      .bind(filters.pageSize, offset)
      .all<ProductRow>();
    return result.results;
  }

  async product(slug: string): Promise<Product | null> {
    return this.db.prepare("SELECT * FROM products WHERE slug = ?").bind(slug).first<ProductRow>();
  }

  async cart(userId: string): Promise<Cart> {
    await this.db
      .prepare("INSERT OR IGNORE INTO carts (user_id, version) VALUES (?, 0)")
      .bind(userId)
      .run();
    const result = await this.db
      .prepare(
        "SELECT p.*, cl.quantity, c.version FROM carts c LEFT JOIN cart_lines cl ON cl.user_id = c.user_id LEFT JOIN products p ON p.id = cl.product_id WHERE c.user_id = ? ORDER BY p.id",
      )
      .bind(userId)
      .all<CartRow>();
    const version = result.results[0]?.version ?? 0;
    return {
      version,
      lines: result.results
        .filter((row) => row.id !== null && row.quantity !== null)
        .map((row) => ({ product: row, quantity: row.quantity })),
    };
  }

  async add(
    userId: string,
    productId: number,
    quantity: number,
    expectedVersion: number,
  ): Promise<Cart> {
    const mutation = crypto.randomUUID();
    const results = await this.db.batch([
      this.db
        .prepare(
          "UPDATE carts SET version = version + 1, last_mutation = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND version = ?",
        )
        .bind(mutation, userId, expectedVersion),
      this.db
        .prepare(
          "INSERT INTO cart_lines (user_id, product_id, quantity) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM carts WHERE user_id = ? AND last_mutation = ?) ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity",
        )
        .bind(userId, productId, quantity, userId, mutation),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1)
      throw new VersionConflictError("cart version changed");
    return this.cart(userId);
  }

  async checkout(userId: string): Promise<Order> {
    const cart = await this.cart(userId);
    if (cart.lines.length === 0) throw new InventoryError("cart is empty");
    if (cart.lines.some((line) => line.quantity > line.product.inventory)) {
      throw new InventoryError("one or more products are no longer available");
    }
    const id = crypto.randomUUID();
    const total = cart.lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
    const statements = [
      ...cart.lines.map((line) =>
        this.db
          .prepare("UPDATE products SET inventory = inventory - ? WHERE id = ? AND inventory >= ?")
          .bind(line.quantity, line.product.id, line.quantity),
      ),
      this.db
        .prepare("INSERT INTO orders (id, user_id, total, status) VALUES (?, ?, ?, 'confirmed')")
        .bind(id, userId, total),
      ...cart.lines.map((line) =>
        this.db
          .prepare(
            "INSERT INTO order_lines (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(id, line.product.id, line.product.name, line.product.price, line.quantity),
      ),
      this.db.prepare("DELETE FROM cart_lines WHERE user_id = ?").bind(userId),
      this.db
        .prepare(
          "UPDATE carts SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
        )
        .bind(userId),
    ];
    const results = await this.db.batch(statements);
    if (results.slice(0, cart.lines.length).some((result) => result.meta.changes !== 1)) {
      throw new InventoryError("inventory changed during checkout");
    }
    return {
      id,
      total,
      status: "confirmed",
      createdAt: new Date().toISOString(),
      lines: cart.lines,
    };
  }

  async order(userId: string, id: string): Promise<Order | null> {
    const header = await this.db
      .prepare(
        "SELECT id, total, status, created_at as createdAt FROM orders WHERE id = ? AND user_id = ?",
      )
      .bind(id, userId)
      .first<Omit<Order, "lines">>();
    if (!header) return null;
    const lines = await this.db
      .prepare(
        "SELECT ol.quantity, p.* FROM order_lines ol JOIN products p ON p.id = ol.product_id WHERE ol.order_id = ?",
      )
      .bind(id)
      .all<CartRow>();
    return {
      ...header,
      lines: lines.results.map((row) => ({ product: row, quantity: row.quantity })),
    };
  }
}
