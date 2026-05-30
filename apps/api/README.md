# SPNpeet Transaction Engine (Go)

Clean-Architecture POS checkout & inventory service. Owns the **critical**
business logic: stock validation, **pessimistic locking**, inventory deduction,
order creation — all in one atomic DB transaction with idempotency.

## Layers

```
cmd/server            process entrypoint, graceful shutdown, -healthcheck
internal/domain       entities, typed errors, ports (interfaces)   <- no deps
internal/usecase      application rules (validation + orchestration)
internal/repository   pgx implementations of the ports (FOR UPDATE here)
internal/handler      Fiber HTTP handlers + DTOs + error mapping
internal/middleware   Supabase JWT verification
internal/server       composition root (wires everything)
internal/config       env loading
```

Dependencies point INWARD only: handler → usecase → domain ← repository.

## Endpoints

| Method | Path                                | Auth | Purpose |
|--------|-------------------------------------|------|---------|
| GET    | `/healthz`                          | no   | liveness |
| GET    | `/readyz`                           | no   | readiness (DB ping) |
| GET    | `/api/v1/products`                  | yes  | offline catalog snapshot |
| GET    | `/api/v1/products/barcode/:barcode` | yes  | server-side barcode lookup |
| POST   | `/api/v1/checkout`                  | yes  | atomic checkout |

### `POST /api/v1/checkout`

```json
{
  "client_uuid": "0f9c...",          // device-generated, idempotency key
  "cashier_id": "uuid (optional)",
  "items": [{ "product_id": "uuid", "quantity": 2 }],
  "sold_at": "2026-05-30T10:00:00Z"  // optional; defaults to now
}
```

Returns `201` (created) or `200` (idempotent replay) with `{ "order": {...} }`,
or a coded error envelope:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "product_id": "..." } }
```

Atomic error codes: `EMPTY_CART`, `INVALID_QUANTITY`, `PRODUCT_NOT_FOUND`,
`INSUFFICIENT_STOCK` (409), `LOCK_TIMEOUT` (503, retryable), `VALIDATION_ERROR`,
`UNAUTHORIZED`, `INTERNAL_ERROR`.

## Run locally

```bash
export DATABASE_URL=postgres://spnpeet:supersecret_change_me@localhost:5432/spnpeet_pos?sslmode=disable
go run ./cmd/server          # or: air
go test ./...
```

If `SUPABASE_JWT_SECRET` is unset in development, auth is disabled (logged
loudly). It is mandatory in production.
