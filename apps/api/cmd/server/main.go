// Command server is the entrypoint for the SPNpeet Transaction Engine.
//
// Clean Architecture composition happens in internal/server. This file owns
// process concerns: config load, pool lifecycle, graceful shutdown, and the
// `-healthcheck` flag used by the Docker/compose healthcheck.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spnpeet/spnpeet/apps/api/internal/config"
	"github.com/spnpeet/spnpeet/apps/api/internal/repository/postgres"
	"github.com/spnpeet/spnpeet/apps/api/internal/server"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe the API's own readiness and exit")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if *healthcheck {
		os.Exit(runHealthcheck())
	}

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config load failed", "error", err)
		os.Exit(1)
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.NewPool(rootCtx, cfg)
	if err != nil {
		logger.Error("db pool init failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	logger.Info("connected to postgres", "max_conns", cfg.PoolMaxConns)

	app := server.New(cfg, pool, logger)

	// Run the HTTP server in a goroutine so we can wait for shutdown signals.
	go func() {
		addr := ":" + cfg.Port
		logger.Info("transaction engine listening", "addr", addr, "env", cfg.Env)
		if err := app.Listen(addr); err != nil {
			logger.Error("server stopped", "error", err)
			stop()
		}
	}()

	<-rootCtx.Done()
	logger.Info("shutdown signal received, draining connections")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("bye")
}

// runHealthcheck performs a lightweight readiness probe for container orchestration.
func runHealthcheck() int {
	cfg, err := config.Load()
	if err != nil {
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	pool, err := postgres.NewPool(ctx, cfg)
	if err != nil {
		return 1
	}
	defer pool.Close()
	if err := server.Ping(ctx, pool); err != nil {
		return 1
	}
	return 0
}
