"use client-only";

import { computed, signal } from "@preact/signals";
import { clientStore } from "zogan/client";
import type { CartSnapshot } from "../domain/types";

export const cartBase = clientStore<CartSnapshot>("cart", { version: 0, count: 0, total: 0 });
export const pendingAdds = signal(0);
export const visibleCartCount = computed(() => cartBase.value.count + pendingAdds.value);
