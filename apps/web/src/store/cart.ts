"use client";

import { create } from "zustand";

import type { CachedProduct } from "@/lib/db/dexie";

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unitPrice: string; // numeric string
  taxRate: string;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  addProduct: (p: CachedProduct, qty?: number) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  setQuantity: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  // Derived selectors.
  subtotal: () => number;
  taxTotal: () => number;
  total: () => number;
  itemCount: () => number;
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],

  addProduct: (p, qty = 1) =>
    set((state) => {
      const existing = state.lines.find((l) => l.productId === p.id);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.productId === p.id ? { ...l, quantity: l.quantity + qty } : l,
          ),
        };
      }
      return {
        lines: [
          ...state.lines,
          {
            productId: p.id,
            sku: p.sku,
            name: p.name,
            unitPrice: p.price,
            taxRate: p.tax_rate,
            quantity: qty,
          },
        ],
      };
    }),

  increment: (id) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.productId === id ? { ...l, quantity: l.quantity + 1 } : l)),
    })),

  decrement: (id) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.productId === id ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0),
    })),

  setQuantity: (id, qty) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.productId === id ? { ...l, quantity: Math.max(0, Math.floor(qty)) } : l))
        .filter((l) => l.quantity > 0),
    })),

  remove: (id) => set((state) => ({ lines: state.lines.filter((l) => l.productId !== id) })),

  clear: () => set({ lines: [] }),

  subtotal: () => get().lines.reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity, 0),

  taxTotal: () =>
    get().lines.reduce((sum, l) => sum + Number(l.unitPrice) * l.quantity * Number(l.taxRate), 0),

  total: () => {
    const s = get();
    return s.subtotal() + s.taxTotal();
  },

  itemCount: () => get().lines.reduce((sum, l) => sum + l.quantity, 0),
}));
