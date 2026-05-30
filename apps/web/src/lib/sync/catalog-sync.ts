/**
 * Pulls the catalog from the engine into IndexedDB so scanning works offline.
 * Falls back silently to the existing cache when the network is unavailable.
 */
import { fetchProducts } from "@/lib/api/client";
import { replaceCatalog } from "@/lib/db/catalog";
import type { CachedProduct } from "@/lib/db/dexie";

export async function refreshCatalog(): Promise<{ ok: boolean; count: number }> {
  try {
    const products = await fetchProducts();
    const mapped: CachedProduct[] = products.map((p) => ({
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      price: p.price,
      tax_rate: p.tax_rate,
      quantity: p.quantity,
      is_active: p.is_active,
      updated_at: p.updated_at,
    }));
    await replaceCatalog(mapped);
    return { ok: true, count: mapped.length };
  } catch {
    // Offline or server down: keep whatever snapshot we already have.
    return { ok: false, count: 0 };
  }
}
