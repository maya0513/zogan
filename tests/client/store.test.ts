import { computed, signal } from "@preact/signals";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { parseHTMLFragment } from "../../src/client/dom";
import { __resetStores, clientStore, mergeSnapshots } from "../../src/client/store";

interface Cart {
  version: number;
  count: number;
}

const snapshotNodes = (name: string, json: string) =>
  parseHTMLFragment(`<script type="application/json" data-store="${name}">${json}</script>`);

beforeEach(() => {
  __resetStores();
  document.body.innerHTML = "";
});

describe("§5.1 base は version が手元より大きい時のみ上書き", () => {
  test("新しい version は通る", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots(snapshotNodes("cart", '{"version":41,"count":3}'));
    expect(cart.value).toEqual({ version: 41, count: 3 });
  });

  test("古い snapshot は無視する（到着順は保証されない・§5.1.1）", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots(snapshotNodes("cart", '{"version":41,"count":3}'));
    mergeSnapshots(snapshotNodes("cart", '{"version":40,"count":99}'));
    expect(cart.value.count).toBe(3);
  });

  test("同じ version も無視する（<= で判定）", () => {
    const cart = clientStore<Cart>("cart", { version: 5, count: 1 });
    mergeSnapshots(snapshotNodes("cart", '{"version":5,"count":9}'));
    expect(cart.value.count).toBe(1);
  });

  test("同じ name が複数あれば version が最大のものが残る（§5.2.1）", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots([
      ...snapshotNodes("cart", '{"version":10,"count":1}'),
      ...snapshotNodes("cart", '{"version":42,"count":7}'),
      ...snapshotNodes("cart", '{"version":11,"count":2}'),
    ]);
    expect(cart.value).toEqual({ version: 42, count: 7 });
  });
});

describe("§5.2.3 マージ手順", () => {
  test("ノード自身が snapshot の場合も拾う", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    // マーカー直下に置かれた <script data-store> がまさにこの形
    mergeSnapshots(snapshotNodes("cart", '{"version":1,"count":1}'));
    expect(cart.value.count).toBe(1);
  });

  test("子孫の snapshot も拾う", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots(
      parseHTMLFragment(
        '<div><script type="application/json" data-store="cart">{"version":2,"count":5}</script></div>',
      ),
    );
    expect(cart.value.count).toBe(5);
  });

  test("壊れた JSON は警告して続行する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots(snapshotNodes("cart", "{oops"));
    expect(cart.value.version).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("version が無い snapshot は無視する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots(snapshotNodes("cart", '{"count":9}'));
    expect(cart.value.count).toBe(0);
    warn.mockRestore();
  });

  test.each(["null", '"string"'])("object でない snapshot は無視する: %s", (json) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots(snapshotNodes("cart", json));
    expect(cart.value.version).toBe(0);
    warn.mockRestore();
  });

  test("空の data-store 名は無視する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergeSnapshots(snapshotNodes("", '{"version":1}'));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test("null textContent は不正 JSON として安全に無視する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nodes = snapshotNodes("cart", "");
    Object.defineProperty(nodes[0], "textContent", { value: null });
    mergeSnapshots(nodes);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("JSON 警告時に data-store が消えていても安全", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nodes = snapshotNodes("cart", "invalid");
    const element = nodes[0] as Element;
    const original = element.getAttribute.bind(element);
    let dataStoreReads = 0;
    element.getAttribute = (name) => {
      if (name !== "data-store") return original(name);
      dataStoreReads += 1;
      return dataStoreReads === 1 ? "cart" : null;
    };
    mergeSnapshots(nodes);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("走査対象は渡されたノードだけ。文書全体を走査しない", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    document.body.innerHTML =
      '<script type="application/json" data-store="cart">{"version":99,"count":99}</script>';
    mergeSnapshots(parseHTMLFragment("<div>無関係</div>"));
    expect(cart.value.version).toBe(0);
  });

  test("Record 形式でも受ける（BroadcastChannel 経路・§8.2）", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    mergeSnapshots({ cart: { version: 7, count: 2 } });
    expect(cart.value).toEqual({ version: 7, count: 2 });
  });
});

describe("§5.2.3 未登録の Store と遅延マージ", () => {
  test("未登録なら保持し、clientStore の登録時に適用する", () => {
    // Island の遅延読み込みでは start() の走査時点でまだ登録されていない
    mergeSnapshots(snapshotNodes("cart", '{"version":41,"count":3}'));
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    expect(cart.value).toEqual({ version: 41, count: 3 });
  });

  test("遅延分も version 比較を通る。初期値のほうが新しければ適用しない", () => {
    mergeSnapshots(snapshotNodes("cart", '{"version":3,"count":3}'));
    const cart = clientStore<Cart>("cart", { version: 10, count: 1 });
    expect(cart.value.count).toBe(1);
  });

  test("保持するのは version が最大のものだけ", () => {
    mergeSnapshots(snapshotNodes("cart", '{"version":5,"count":5}'));
    mergeSnapshots(snapshotNodes("cart", '{"version":9,"count":9}'));
    mergeSnapshots(snapshotNodes("cart", '{"version":6,"count":6}'));
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    expect(cart.value.count).toBe(9);
  });

  test("適用後は破棄する（DOM から外れた要素を持ち続けない）", () => {
    mergeSnapshots(snapshotNodes("cart", '{"version":5,"count":5}'));
    clientStore<Cart>("cart", { version: 0, count: 0 });
    __resetStores();
    const again = clientStore<Cart>("cart", { version: 0, count: 0 });
    expect(again.value.version).toBe(0);
  });
});

describe("§5.1 base + pending の二層", () => {
  test("読み取り専用ビュー越しでも computed が追従する", () => {
    const base = clientStore<Cart>("cart", { version: 0, count: 0 });
    const pending = signal<number[]>([]);
    const cart = computed(() => ({
      count: base.value.count + pending.value.reduce((a, b) => a + b, 0),
    }));

    // 1. delta を積む → 即座に反応する
    pending.value = [1];
    expect(cart.value.count).toBe(1);

    // 2〜3. サーバ応答の snapshot をマージ
    mergeSnapshots(snapshotNodes("cart", '{"version":42,"count":1}'));
    // 4. delta を取り除く → 表示は 1 のまま（成功時）
    pending.value = [];
    expect(cart.value.count).toBe(1);
  });

  test("サーバが拒否した場合は version だけ進み、delta の除去で自動ロールバックする", () => {
    const base = clientStore<Cart>("cart", { version: 41, count: 3 });
    const pending = signal<number[]>([1]);
    const cart = computed(() => base.value.count + pending.value.reduce((a, b) => a + b, 0));
    expect(cart.value).toBe(4);

    // 在庫切れ。カートは変更されないが version は進む（§8.2.1）
    mergeSnapshots(snapshotNodes("cart", '{"version":42,"count":3}'));
    pending.value = [];
    expect(cart.value).toBe(3);
  });
});

describe("§5.1 / 付録 A.2.2 書き込み口を塞ぐ", () => {
  test("clientStore の戻り値へ代入できない", () => {
    const cart = clientStore<Cart>("cart", { version: 0, count: 0 });
    expect(() => {
      (cart as { value: Cart }).value = { version: 100, count: 100 };
    }).toThrow();
    expect(cart.value.version).toBe(0);
  });

  test("同じ名前で 2 回登録すると例外", () => {
    clientStore<Cart>("cart", { version: 0, count: 0 });
    expect(() => clientStore<Cart>("cart", { version: 0, count: 0 })).toThrow(/cart/);
  });

  test("不正な Store 名は例外", () => {
    expect(() => clientStore("ca rt", { version: 0 })).toThrow(/ca rt/);
  });
});
