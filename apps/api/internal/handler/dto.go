package handler

import (
	"time"

	"github.com/google/uuid"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// checkoutItemDTO is one requested line on the wire.
type checkoutItemDTO struct {
	ProductID uuid.UUID `json:"product_id"`
	Quantity  int       `json:"quantity"`
}

// checkoutRequestDTO is the JSON body of POST /checkout.
type checkoutRequestDTO struct {
	ClientUUID uuid.UUID         `json:"client_uuid"`
	CashierID  uuid.UUID         `json:"cashier_id"`
	Items      []checkoutItemDTO `json:"items"`
	SoldAt     *time.Time        `json:"sold_at,omitempty"`
}

func (d checkoutRequestDTO) toDomain() domain.CheckoutRequest {
	items := make([]domain.CheckoutItem, 0, len(d.Items))
	for _, it := range d.Items {
		items = append(items, domain.CheckoutItem{ProductID: it.ProductID, Quantity: it.Quantity})
	}
	req := domain.CheckoutRequest{
		ClientUUID: d.ClientUUID,
		CashierID:  d.CashierID,
		Items:      items,
	}
	if d.SoldAt != nil {
		req.SoldAt = d.SoldAt.UTC()
	}
	return req
}

// errorResponse is the canonical error envelope returned to clients.
type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	ProductID string `json:"product_id,omitempty"`
}
