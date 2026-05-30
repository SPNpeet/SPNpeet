/**
 * Catalog cache operations: bulk-refresh from the API and the zero-latency
 * local lookups the scanner relies on.
 */
import { db, type CachedProduct } from "./dexie";

/** Replace the local catalog snapshot with the latest from the server. */
export async function replaceCatalog(products: CachedProduct[]): Promise<void> {
  const d = db();
  await d.transaction("rw", d.products, async () => {
    await d.products.clear();
    await d.products.bulkPut(products);
  });
}

/** Resolve a scanned barcode against the LOCAL cache — no network, no latency. */
export async function findByBarcode(barcode: string): Promise<CachedProduct | undefined> {
  return db().products.where("barcode").equals(barcode).first();
}

/** Free-text search over name / sku for manual lookup. */
export async function searchProducts(query: string, limit = 24): Promise<CachedProduct[]> {
  const q = query.trim().toLowerCase();
  const all = await db().products.filter((p) => p.is_active).toArray();
  if (!q) return all.slice(0, limit);
  return all
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
    )
    .slice(0, limit);
}

export async function catalogCount(): Promise<number> {
  return db().products.count();
}
