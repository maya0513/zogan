export interface Product {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  price: number;
  inventory: number;
  image: string;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface Cart {
  version: number;
  lines: CartLine[];
}

export interface CartSnapshot {
  version: number;
  count: number;
  total: number;
}

export interface Order {
  id: string;
  total: number;
  status: string;
  createdAt: string;
  lines: CartLine[];
}
