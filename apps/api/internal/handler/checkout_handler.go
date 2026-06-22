package handler

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
	"github.com/spnpeet/spnpeet/apps/api/internal/middleware"
	"github.com/spnpeet/spnpeet/apps/api/internal/usecase"
)

// CheckoutHandler exposes the transaction engine over HTTP.
type CheckoutHandler struct {
	svc *usecase.CheckoutService
}

func NewCheckoutHandler(svc *usecase.CheckoutService) *CheckoutHandler {
	return &CheckoutHandler{svc: svc}
}

// Register mounts the checkout routes onto the router group.
func (h *CheckoutHandler) Register(r fiber.Router) {
	r.Post("/checkout", h.checkout)
}

// checkout handles POST /checkout.
//
// Returns 201 for a newly created order, 200 for an idempotent replay, or a
// coded error envelope. The authenticated user id (from JWT) is used for audit
// attribution; the cashier id in the body identifies who rang the sale.
func (h *CheckoutHandler) checkout(c *fiber.Ctx) error {
	var body checkoutRequestDTO
	if err := c.BodyParser(&body); err != nil {
		return respondError(c, domain.NewDomainError(domain.CodeValidation, "malformed JSON body"))
	}

	actor := middleware.UserID(c)
	req := body.toDomain()
	// If no explicit cashier supplied, attribute the sale to the actor.
	if req.CashierID == uuid.Nil && actor != uuid.Nil {
		req.CashierID = actor
	}

	order, err := h.svc.Execute(c.Context(), req, actor)
	if err != nil {
		return respondError(c, err)
	}

	status := fiber.StatusCreated
	if order.Idempotent {
		status = fiber.StatusOK
	}
	return c.Status(status).JSON(fiber.Map{"order": order})
}
