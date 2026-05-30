package handler

import (
	"github.com/gofiber/fiber/v2"

	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// HealthHandler exposes liveness/readiness probes.
type HealthHandler struct {
	checker domain.HealthChecker
}

func NewHealthHandler(checker domain.HealthChecker) *HealthHandler {
	return &HealthHandler{checker: checker}
}

func (h *HealthHandler) Register(app *fiber.App) {
	// Liveness: process is up.
	app.Get("/healthz", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})
	// Readiness: dependencies (DB) reachable.
	app.Get("/readyz", func(c *fiber.Ctx) error {
		if err := h.checker.Ping(c.Context()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status": "unavailable", "db": "down",
			})
		}
		return c.JSON(fiber.Map{"status": "ready", "db": "up"})
	})
}
