# SPNpeet POS — Web (Next.js PWA)

Offline-first Point-of-Sale terminal. App Router + Tailwind + shadcn/ui,
Workbox service worker, IndexedDB (Dexie) sync queue, and a WASM barcode
scanner (ZXing).

## Offline architecture

```
            ┌─────────────────────────── Browser ───────────────────────────┐
 Scan/Tap ─▶│  Cart (zustand)                                                 │
            │      │ Charge                                                    │
            │      ▼                                                           │
            │  enqueueSale ─▶ IndexedDB syncQueue  (DURABLE, persist-first)    │
            │                        │                                         │
            │                Sync Engine (src/lib/sync/engine.ts)             │
            │     online? online event / interval / focus ─┐                  │
            │                        ▼                      │                  │
            │           POST /api/v1/checkout  (idempotent via client_uuid)    │
            └────────────────────────┼──────────────────────────────────────┘
                                      ▼
                          Golang Transaction Engine
```

- **Persist-first:** a sale is written to IndexedDB *before* the network is
  touched, so a crash/reload/offline never loses a transaction.
- **Idempotent sync:** each queued sale carries a device-generated `client_uuid`;
  the engine returns the same order on replay, so retries never double-charge.
- **Zero-latency scanning:** scanned barcodes resolve against the local product
  cache in IndexedDB — the network is never on the scan hot path.
- **Catalog cache:** `NetworkFirst` for `/api/v1/products` (fresh online, cached
  offline) plus an explicit pull into IndexedDB on app boot.

## Key modules

| Path | Responsibility |
|------|----------------|
| `src/lib/db/dexie.ts`        | IndexedDB schema (products, syncQueue) |
| `src/lib/db/catalog.ts`      | local catalog ops + barcode lookup |
| `src/lib/sync/engine.ts`     | durable queue + drain logic |
| `src/lib/sync/catalog-sync.ts` | pull catalog into IndexedDB |
| `src/lib/api/client.ts`      | typed engine client + atomic error codes |
| `src/components/pos/barcode-scanner.tsx` | ZXing rear-camera scanner |
| `src/store/cart.ts`          | cart state |
| `src/app/pos/page.tsx`       | the register |

## Develop

```bash
pnpm install
pnpm --filter @spnpeet/web dev    # http://localhost:3000  (PWA disabled in dev)
pnpm --filter @spnpeet/web build  # production build (service worker generated)
```

Env (see repo-root `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`.

> The service worker is disabled in development to avoid stale caches; it is
> generated and active in production builds only.
