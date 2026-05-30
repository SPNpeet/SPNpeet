// Package usecase contains application business rules. It depends only on the
// domain ports, never on pgx/fiber — keeping the core testable and framework
// agnostic.
package usecase

import (
	"context"

	"github.com/google/uuid"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// CheckoutService orchestrates the checkout use case.
type CheckoutService struct {
	repo domain.CheckoutRepository
}

func NewCheckoutService(repo domain.CheckoutRepository) *CheckoutService {
	return &CheckoutService{repo: repo}
}

// Execute validates the request then delegates the atomic work to the repo.
// actorID comes from the verified JWT and is used purely for audit attribution
// (it may differ from req.CashierID in supervised-override scenarios).
func (s *CheckoutService) Execute(ctx context.Context, req domain.CheckoutRequest, actorID uuid.UUID) (*domain.Order, error) {
	if req.ClientUUID == uuid.Nil {
		return nil, domain.NewDomainError(domain.CodeValidation, "client_uuid is required for idempotent checkout")
	}
	if len(req.Items) == 0 {
		return nil, domain.NewDomainError(domain.CodeEmptyCart, "cart contains no items")
	}
	for _, it := range req.Items {
		if it.ProductID == uuid.Nil {
			return nil, domain.NewDomainError(domain.CodeValidation, "each item requires product_id")
		}
		if it.Quantity <= 0 {
			de := domain.NewDomainError(domain.CodeInvalidQuantity, "quantity must be > 0")
			de.ProductID = it.ProductID.String()
			return nil, de
		}
	}
	return s.repo.ProcessCheckout(ctx, req, actorID)
}
