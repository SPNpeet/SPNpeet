// Package domain holds the enterprise business entities and the ports
// (interfaces) the outer layers must satisfy. It has ZERO dependencies on
// frameworks, the database driver, or HTTP — the core of Clean Architecture.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Product is the catalog entity.
type Product struct {
	ID        uuid.UUID `json:"id"`
	SKU       string    `json:"sku"`
	Barcode   *string   `json:"barcode,omitempty"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	Price     string    `json:"price"`    // numeric as string to avoid float drift
	TaxRate   string    `json:"tax_rate"` // e.g. "0.0700"
	IsActive  bool      `json:"is_active"`
	Quantity  int       `json:"quantity"` // current on-hand (joined from inventory)
	UpdatedAt time.Time `json:"updated_at"`
}

// CheckoutItem is a single requested line in a checkout.
type CheckoutItem struct {
	ProductID uuid.UUID `json:"product_id"`
	Quantity  int       `json:"quantity"`
}

// CheckoutRequest is the validated input to the checkout use case.
type CheckoutRequest struct {
	// ClientUUID is generated on-device and guarantees idempotency across
	// offline-sync retries. Required.
	ClientUUID uuid.UUID      `json:"client_uuid"`
	CashierID  uuid.UUID      `json:"cashier_id"`
	Items      []CheckoutItem `json:"items"`
	// SoldAt is when the sale happened on the device (may predate sync).
	SoldAt time.Time `json:"sold_at"`
}

// OrderLine is a persisted sale line returned to the caller.
type OrderLine struct {
	ProductID uuid.UUID `json:"product_id"`
	SKU       string    `json:"sku"`
	Name      string    `json:"name"`
	UnitPrice string    `json:"unit_price"`
	Quantity  int       `json:"quantity"`
	LineTotal string    `json:"line_total"`
}

// Order is the result of a successful checkout.
type Order struct {
	ID          uuid.UUID   `json:"id"`
	OrderNumber int64       `json:"order_number"`
	ClientUUID  uuid.UUID   `json:"client_uuid"`
	Status      string      `json:"status"`
	Subtotal    string      `json:"subtotal"`
	TaxTotal    string      `json:"tax_total"`
	Total       string      `json:"total"`
	CashierID   *uuid.UUID  `json:"cashier_id,omitempty"`
	SoldAt      time.Time   `json:"sold_at"`
	Lines       []OrderLine `json:"lines,omitempty"`
	// Idempotent indicates the order already existed (a no-op replay).
	Idempotent bool `json:"idempotent"`
}
