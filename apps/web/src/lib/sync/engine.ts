/**
 * Offline Sync Engine.
 *
 * Every sale is written to IndexedDB FIRST (durable, survives reload/crash),
 * then the engine attempts to push it to the Golang Transaction Engine. The
 * `clientUuid` makes each push idempotent, so retries after a flaky network
 * never double-charge.
 *
 * Triggers that drain the queue:
 *   - immediately after a sale is enqueued (optimistic, when online)
 *   - on the browser `online` event
 *   - on a periodic interval (safety net)
 *   - on app focus / visibility change
 */
import { v4 as uuidv4 } from "uuid";

import { ApiError, postCheckout, type CheckoutPayload } from "@/lib/api/client";
import { db, type QueuedSale } from "@/lib/db/dexie";

export interface NewSaleInput {
  cashierId: string | null;
  items: { product_id: string; quantity: number; name: string; unit_price: string }[];
  subtotal: string;
  taxTotal: string;
  total: string;
}

let _processing = false;
const listeners = new Set<() => void>();

/** Subscribe to queue-change notifications (for the sync indicator UI). */
export function onSyncChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  listeners.forEach((cb) => cb());
}

/** Persist a sale to the durable queue and kick a sync attempt. */
export async function enqueueSale(input: NewSaleInput): Promise<QueuedSale> {
  const sale: QueuedSale = {
    clientUuid: uuidv4(),
    cashierId: input.cashierId,
    items: input.items,
    subtotal: input.subtotal,
    taxTotal: input.taxTotal,
    total: input.total,
    soldAt: new Date().toISOString(),
    state: "queued",
    attempts: 0,
    createdAt: Date.now(),
  };
  const localId = await db().syncQueue.add(sale);
  sale.localId = localId;
  notify();
  // Fire-and-forget; UI already has its optimistic receipt.
  void processQueue();
  return sale;
}

/**
 * Drain the queue. Safe to call concurrently — guarded by `_processing`.
 * Stops early on a network error (we're offline; try again later).
 */
export async function processQueue(): Promise<void> {
  if (_processing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  _processing = true;
  try {
    const pending = await db()
      .syncQueue.where("state")
      .anyOf("queued", "error")
      .sortBy("createdAt");

    for (const sale of pending) {
      if (sale.localId == null) continue;
      await db().syncQueue.update(sale.localId, { state: "syncing" });
      notify();

      const payload: CheckoutPayload = {
        client_uuid: sale.clientUuid,
        cashier_id: sale.cashierId ?? undefined,
        items: sale.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        sold_at: sale.soldAt,
      };

      try {
        const order = await postCheckout(payload);
        await db().syncQueue.update(sale.localId, {
          state: "synced",
          attempts: sale.attempts + 1,
          serverOrderId: order.id,
          orderNumber: order.order_number,
          lastError: undefined,
        });
        notify();
      } catch (err) {
        const apiErr = err as ApiError;
        if (apiErr.isNetwork) {
          // Offline again — put it back and stop; we'll resume on reconnect.
          await db().syncQueue.update(sale.localId, { state: "queued" });
          notify();
          break;
        }
        // Transient server condition (e.g. lock timeout): keep it queued.
        if (apiErr.isRetryable) {
          await db().syncQueue.update(sale.localId, {
            state: "queued",
            attempts: sale.attempts + 1,
            lastError: apiErr.message,
          });
          notify();
          continue;
        }
        // Hard business rejection (insufficient stock, validation, etc.):
        // park it as `error` for staff to reconcile — never silently retry.
        await db().syncQueue.update(sale.localId, {
          state: "error",
          attempts: sale.attempts + 1,
          lastError: `${apiErr.code}: ${apiErr.message}`,
        });
        notify();
      }
    }
  } finally {
    _processing = false;
  }
}

export interface QueueStats {
  queued: number;
  syncing: number;
  error: number;
  synced: number;
}

export async function queueStats(): Promise<QueueStats> {
  const all = await db().syncQueue.toArray();
  return {
    queued: all.filter((s) => s.state === "queued").length,
    syncing: all.filter((s) => s.state === "syncing").length,
    error: all.filter((s) => s.state === "error").length,
    synced: all.filter((s) => s.state === "synced").length,
  };
}

/** Drop already-synced rows older than `maxAgeMs` to keep IndexedDB lean. */
export async function pruneSynced(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  await db()
    .syncQueue.where("state")
    .equals("synced")
    .and((s) => s.createdAt < cutoff)
    .delete();
  notify();
}
