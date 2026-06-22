package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// ProductRepo implements domain.ProductRepository.
type ProductRepo struct{ pool *pgxpool.Pool }

func NewProductRepo(pool *pgxpool.Pool) *ProductRepo { return &ProductRepo{pool: pool} }

const productSelect = `
	SELECT p.id, p.sku, p.barcode::text, p.name, p.category, p.price::text, p.tax_rate::text,
	       p.is_active, COALESCE(i.quantity, 0), p.updated_at
	FROM public.products p
	LEFT JOIN public.inventory i ON i.product_id = p.id`

// ListActive returns every active product joined with on-hand quantity. The
// PWA calls this to populate IndexedDB so scanning works fully offline.
func (r *ProductRepo) ListActive(ctx context.Context) ([]domain.Product, error) {
	rows, err := r.pool.Query(ctx, productSelect+` WHERE p.is_active ORDER BY p.name`)
	if err != nil {
		return nil, fmt.Errorf("query products: %w", err)
	}
	defer rows.Close()

	var out []domain.Product
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetByBarcode resolves a single product (server-side fallback; the PWA
// normally resolves barcodes locally from IndexedDB for zero latency).
func (r *ProductRepo) GetByBarcode(ctx context.Context, barcode string) (*domain.Product, error) {
	row := r.pool.QueryRow(ctx, productSelect+` WHERE p.barcode = $1 AND p.is_active`, barcode)
	p, err := scanProduct(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.NewDomainError(domain.CodeProductNotFound, "no product with that barcode")
		}
		return nil, err
	}
	return &p, nil
}

// scannable abstracts pgx.Row and pgx.Rows for shared scanning.
type scannable interface {
	Scan(dest ...any) error
}

func scanProduct(s scannable) (domain.Product, error) {
	var p domain.Product
	var barcode *string
	if err := s.Scan(&p.ID, &p.SKU, &barcode, &p.Name, &p.Category, &p.Price, &p.TaxRate, &p.IsActive, &p.Quantity, &p.UpdatedAt); err != nil {
		return p, err
	}
	p.Barcode = barcode
	return p, nil
}
