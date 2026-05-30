package domain

import (
	"context"

	"github.com/google/uuid"
)

// CheckoutRepository is the persistence port for the checkout use case. The
// concrete implementation (postgres) is responsible for running the whole
// operation inside ONE transaction with pessimistic row locks.
type CheckoutRepository interface {
	// ProcessCheckout atomically validates stock, locks inventory rows
	// (SELECT ... FOR UPDATE), deducts, writes the ledger and persists the
	// order. It must be idempotent on req.ClientUUID. actorID is stamped into
	// the audit trail (app.current_user_id GUC).
	ProcessCheckout(ctx context.Context, req CheckoutRequest, actorID uuid.UUID) (*Order, error)
}

// ProductRepository serves catalog reads (used to warm the PWA's offline cache).
type ProductRepository interface {
	ListActive(ctx context.Context) ([]Product, error)
	GetByBarcode(ctx context.Context, barcode string) (*Product, error)
}

// HealthChecker verifies downstream dependencies are reachable.
type HealthChecker interface {
	Ping(ctx context.Context) error
}
