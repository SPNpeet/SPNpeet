package domain

import "errors"

// DomainError is a typed business error carrying a stable, machine-readable
// code so the API can return atomic error codes to the offline client. The
// client uses these codes to decide whether to retry, surface to the cashier,
// or drop a queued sale.
type DomainError struct {
	Code    string // stable code, e.g. "INSUFFICIENT_STOCK"
	Message string // human-readable detail
	// ProductID is populated for stock-related failures so the UI can flag the
	// exact offending line.
	ProductID string
}

func (e *DomainError) Error() string { return e.Code + ": " + e.Message }

// NewDomainError constructs a coded error.
func NewDomainError(code, message string) *DomainError {
	return &DomainError{Code: code, Message: message}
}

// Stable atomic error codes shared with the frontend.
const (
	CodeEmptyCart         = "EMPTY_CART"
	CodeInvalidQuantity   = "INVALID_QUANTITY"
	CodeProductNotFound   = "PRODUCT_NOT_FOUND"
	CodeInsufficientStock = "INSUFFICIENT_STOCK"
	CodeLockTimeout       = "LOCK_TIMEOUT"
	CodeDuplicateRequest  = "DUPLICATE_REQUEST" // surfaced as success (idempotent)
	CodeInternal          = "INTERNAL_ERROR"
	CodeUnauthorized      = "UNAUTHORIZED"
	CodeValidation        = "VALIDATION_ERROR"
)

// AsDomainError unwraps a DomainError if present.
func AsDomainError(err error) (*DomainError, bool) {
	var de *DomainError
	if errors.As(err, &de) {
		return de, true
	}
	return nil, false
}
