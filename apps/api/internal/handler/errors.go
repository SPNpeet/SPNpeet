package handler

import (
	"github.com/gofiber/fiber/v2"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// httpStatusForCode maps stable domain error codes to HTTP statuses. The body
// always carries the same machine-readable code so the offline client can act
// on it deterministically regardless of status.
func httpStatusForCode(code string) int {
	switch code {
	case domain.CodeEmptyCart, domain.CodeInvalidQuantity, domain.CodeValidation:
		return fiber.StatusBadRequest
	case domain.CodeProductNotFound:
		return fiber.StatusNotFound
	case domain.CodeInsufficientStock:
		// 409: the request was well-formed but conflicts with current state.
		return fiber.StatusConflict
	case domain.CodeLockTimeout:
		// 503 + Retry-After hint: transient contention, client should retry.
		return fiber.StatusServiceUnavailable
	case domain.CodeUnauthorized:
		return fiber.StatusUnauthorized
	default:
		return fiber.StatusInternalServerError
	}
}

// respondError converts any error into the canonical envelope.
func respondError(c *fiber.Ctx, err error) error {
	if de, ok := domain.AsDomainError(err); ok {
		status := httpStatusForCode(de.Code)
		if de.Code == domain.CodeLockTimeout {
			c.Set("Retry-After", "1")
		}
		return c.Status(status).JSON(errorResponse{Error: errorBody{
			Code: de.Code, Message: de.Message, ProductID: de.ProductID,
		}})
	}
	// Unknown error: do not leak internals.
	return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: errorBody{
		Code: domain.CodeInternal, Message: "an unexpected error occurred",
	}})
}
