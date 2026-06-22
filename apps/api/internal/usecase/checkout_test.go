package usecase

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// fakeRepo is an in-memory stand-in for the postgres CheckoutRepository so the
// use-case validation rules can be unit-tested without a database.
type fakeRepo struct {
	called bool
	order  *domain.Order
}

func (f *fakeRepo) ProcessCheckout(_ context.Context, req domain.CheckoutRequest, _ uuid.UUID) (*domain.Order, error) {
	f.called = true
	return &domain.Order{ID: uuid.New(), ClientUUID: req.ClientUUID, Status: "completed"}, nil
}

func TestExecute_RejectsMissingClientUUID(t *testing.T) {
	svc := NewCheckoutService(&fakeRepo{})
	_, err := svc.Execute(context.Background(), domain.CheckoutRequest{
		Items: []domain.CheckoutItem{{ProductID: uuid.New(), Quantity: 1}},
	}, uuid.New())
	assertCode(t, err, domain.CodeValidation)
}

func TestExecute_RejectsEmptyCart(t *testing.T) {
	svc := NewCheckoutService(&fakeRepo{})
	_, err := svc.Execute(context.Background(), domain.CheckoutRequest{
		ClientUUID: uuid.New(),
	}, uuid.New())
	assertCode(t, err, domain.CodeEmptyCart)
}

func TestExecute_RejectsNonPositiveQuantity(t *testing.T) {
	svc := NewCheckoutService(&fakeRepo{})
	_, err := svc.Execute(context.Background(), domain.CheckoutRequest{
		ClientUUID: uuid.New(),
		Items:      []domain.CheckoutItem{{ProductID: uuid.New(), Quantity: 0}},
	}, uuid.New())
	assertCode(t, err, domain.CodeInvalidQuantity)
}

func TestExecute_HappyPathDelegates(t *testing.T) {
	repo := &fakeRepo{}
	svc := NewCheckoutService(repo)
	order, err := svc.Execute(context.Background(), domain.CheckoutRequest{
		ClientUUID: uuid.New(),
		Items:      []domain.CheckoutItem{{ProductID: uuid.New(), Quantity: 2}},
	}, uuid.New())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.called {
		t.Fatal("expected repo.ProcessCheckout to be called")
	}
	if order.Status != "completed" {
		t.Fatalf("expected completed, got %s", order.Status)
	}
}

func assertCode(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error with code %s, got nil", want)
	}
	de, ok := domain.AsDomainError(err)
	if !ok {
		t.Fatalf("expected DomainError, got %T", err)
	}
	if de.Code != want {
		t.Fatalf("expected code %s, got %s", want, de.Code)
	}
}
