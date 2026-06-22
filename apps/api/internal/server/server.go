// Package server wires together config, the pgx pool, repositories, use cases,
// handlers and middleware into a runnable Fiber application.
package server

import (
	"context"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/spnpeet/spnpeet/apps/api/internal/config"
	"github.com/spnpeet/spnpeet/apps/api/internal/handler"
	"github.com/spnpeet/spnpeet/apps/api/internal/middleware"
	"github.com/spnpeet/spnpeet/apps/api/internal/repository/postgres"
	"github.com/spnpeet/spnpeet/apps/api/internal/usecase"
)

// New builds the Fiber app with all dependencies wired in.
func New(cfg *config.Config, pool *pgxpool.Pool, logger *slog.Logger) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:               "SPNpeet Transaction Engine",
		DisableStartupMessage: true,
		ReadTimeout:           15 * time.Second,
		WriteTimeout:          15 * time.Second,
		BodyLimit:             1 * 1024 * 1024, // 1MB; carts are tiny
	})

	app.Use(requestid.New())
	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     joinOrigins(cfg.CORSOrigins),
		AllowMethods:     "GET,POST,OPTIONS",
		AllowHeaders:     "Authorization,Content-Type",
		AllowCredentials: false,
	}))

	// ---- dependency wiring (composition root) ------------------------------
	checkoutRepo := postgres.NewCheckoutRepo(pool, cfg)
	productRepo := postgres.NewProductRepo(pool)
	healthRepo := postgres.NewHealthRepo(pool)

	checkoutSvc := usecase.NewCheckoutService(checkoutRepo)
	catalogSvc := usecase.NewCatalogService(productRepo)

	// ---- health (unauthenticated) ------------------------------------------
	handler.NewHealthHandler(healthRepo).Register(app)

	// ---- authenticated API group -------------------------------------------
	allowAnon := !cfg.IsProduction() && cfg.SupabaseJWTSecret == ""
	if allowAnon {
		logger.Warn("AUTH DISABLED: running without JWT verification (dev only)")
	}
	api := app.Group("/api/v1", middleware.JWT(middleware.AuthConfig{
		JWTSecret:      cfg.SupabaseJWTSecret,
		AllowAnonymous: allowAnon,
	}))

	handler.NewCheckoutHandler(checkoutSvc).Register(api)
	handler.NewCatalogHandler(catalogSvc).Register(api)

	return app
}

// Ping is a convenience used by the -healthcheck CLI flag.
func Ping(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return pool.Ping(ctx)
}

func joinOrigins(origins []string) string {
	out := ""
	for i, o := range origins {
		if i > 0 {
			out += ","
		}
		out += o
	}
	if out == "" {
		return "*"
	}
	return out
}
