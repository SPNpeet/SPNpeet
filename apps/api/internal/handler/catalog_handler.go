package handler

import (
	"github.com/gofiber/fiber/v2"

	"github.com/spnpeet/spnpeet/apps/api/internal/usecase"
)

// CatalogHandler serves read-only catalog endpoints used to warm the PWA cache.
type CatalogHandler struct {
	svc *usecase.CatalogService
}

func NewCatalogHandler(svc *usecase.CatalogService) *CatalogHandler {
	return &CatalogHandler{svc: svc}
}

func (h *CatalogHandler) Register(r fiber.Router) {
	r.Get("/products", h.list)
	r.Get("/products/barcode/:barcode", h.byBarcode)
}

// list returns all active products (the offline catalog snapshot).
func (h *CatalogHandler) list(c *fiber.Ctx) error {
	products, err := h.svc.ListActive(c.Context())
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"products": products, "count": len(products)})
}

// byBarcode is a server-side fallback lookup.
func (h *CatalogHandler) byBarcode(c *fiber.Ctx) error {
	product, err := h.svc.GetByBarcode(c.Context(), c.Params("barcode"))
	if err != nil {
		return respondError(c, err)
	}
	return c.JSON(fiber.Map{"product": product})
}
