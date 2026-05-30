/**
 * IndexedDB schema (Dexie) — the offline backbone of the POS.
 *
 * Three stores:
 *   products    : the catalog snapshot, refreshed from the API when online.
 *                 Indexed by `barcode` and `sku` for ZERO-LATENCY scan lookups.
 *   syncQueue   : sales rung while offline (or that failed to reach the server).
 *                 Drained by the sync engine when connectivity returns.
 *   orders      : a local record of completed/synced sales for receipt reprint.
 */
import Dexie, { type Table } from "dexie";

export interface CachedProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price: string; // numeric string, e.g. "1.50"
  tax_rate: string;
  quantity: number; // last-known on-hand (advisory; server is source of truth)
  is_active: boolean;
  updated_at: string;
}

export type SyncState = "queued" | "syncing" | "synced" | "error";

export interface QueuedSale {
  /** Local autoincrement key. */
  localId?: number;
  /** Device-generated idempotency key sent to the engine as client_uuid. */
  clientUuid: string;
  cashierId: string | null;
  items: { product_id: string; quantity: number; name: string; unit_price: string }[];
  /** Cached totals for instant UI / receipt; server recomputes authoritatively. */
  subtotal: string;
  taxTotal: string;
  total: string;
  soldAt: string; // ISO timestamp captured on-device
  state: SyncState;
  attempts: number;
  lastError?: string;
  /** Populated once the server confirms the order. */
  serverOrderId?: string;
  orderNumber?: number;
  createdAt: number;
}

class SpnpeetDB extends Dexie {
  products!: Table<CachedProduct, string>;
  syncQueue!: Table<QueuedSale, number>;

  constructor() {
    super("spnpeet-pos");
    this.version(1).stores({
      // & = primary key (unique), no prefix = plain index.
      products: "&id, &sku, barcode, name, is_active",
      syncQueue: "++localId, clientUuid, state, createdAt",
    });
  }
}

// A single shared instance. Guarded so it only instantiates in the browser.
let _db: SpnpeetDB | null = null;

export function db(): SpnpeetDB {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!_db) _db = new SpnpeetDB();
  return _db;
}
