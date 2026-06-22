package usecase

import (
	"context"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// CatalogService serves product reads used to warm the offline cache.
type CatalogService struct {
	repo domain.ProductRepository
}

func NewCatalogService(repo domain.ProductRepository) *CatalogService {
	return &CatalogService{repo: repo}
}

func (s *CatalogService) ListActive(ctx context.Context) ([]domain.Product, error) {
	return s.repo.ListActive(ctx)
}

func (s *CatalogService) GetByBarcode(ctx context.Context, barcode string) (*domain.Product, error) {
	if barcode == "" {
		return nil, domain.NewDomainError(domain.CodeValidation, "barcode is required")
	}
	return s.repo.GetByBarcode(ctx, barcode)
}
