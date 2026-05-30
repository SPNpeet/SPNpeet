"use client";

import * as React from "react";
import { Minus, Plus, Trash2, Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/store/cart";
import { enqueueSale } from "@/lib/sync/engine";
import { formatMoney, money2 } from "@/lib/utils";

interface Props {
  cashierId: string | null;
  online: boolean;
}

export function CartPanel({ cashierId, online }: Props) {
  const { lines, increment, decrement, remove, clear, subtotal, taxTotal, total, itemCount } = useCart();
  const [submitting, setSubmitting] = React.useState(false);

  const handleCheckout = async () => {
    if (lines.length === 0) return;
    setSubmitting(true);
    try {
      // Persist-first: the sale is durable in IndexedDB before we touch the
      // network. enqueueSale also triggers an immediate sync attempt.
      await enqueueSale({
        cashierId,
        items: lines.map((l) => ({
          product_id: l.productId,
          quantity: l.quantity,
          name: l.name,
          unit_price: l.unitPrice,
        })),
        subtotal: money2(subtotal()),
        taxTotal: money2(taxTotal()),
        total: money2(total()),
      });

      toast.success(
        online ? "Sale recorded — syncing to server" : "Saved offline — will sync when back online",
        { description: `${itemCount()} item(s) · ${formatMoney(total())}` },
      );
      clear();
    } catch (e) {
      toast.error("Could not record sale", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingCart className="size-5" /> Cart
          {itemCount() > 0 && <span className="text-sm text-muted-foreground">({itemCount()})</span>}
        </h2>
        {lines.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      <Separator />

      <div className="flex-1 overflow-y-auto p-2">
        {lines.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Scan or tap a product to begin.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {lines.map((l) => (
              <li key={l.productId} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(l.unitPrice)} × {l.quantity}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="size-9" onClick={() => decrement(l.productId)}>
                    <Minus className="size-4" />
                  </Button>
                  <span className="w-8 text-center font-semibold tabular-nums">{l.quantity}</span>
                  <Button variant="outline" size="icon" className="size-9" onClick={() => increment(l.productId)}>
                    <Plus className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-destructive"
                    onClick={() => remove(l.productId)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <span className="w-20 text-right font-semibold tabular-nums">
                  {formatMoney(Number(l.unitPrice) * l.quantity)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />
      <div className="space-y-1 p-4">
        <Row label="Subtotal" value={formatMoney(subtotal())} />
        <Row label="Tax" value={formatMoney(taxTotal())} />
        <div className="flex items-center justify-between pt-1 text-xl font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(total())}</span>
        </div>
        <Button
          size="pos"
          className="mt-3 w-full"
          disabled={lines.length === 0 || submitting}
          onClick={handleCheckout}
        >
          {submitting ? <Loader2 className="mr-2 animate-spin" /> : null}
          Charge {formatMoney(total())}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
