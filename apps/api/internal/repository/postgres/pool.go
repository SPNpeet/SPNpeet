// Package postgres provides pgx-backed implementations of the domain ports.
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/spnpeet/spnpeet/apps/api/internal/config"
)

// NewPool builds a tuned pgx connection pool.
func NewPool(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	poolCfg.MaxConns = cfg.PoolMaxConns
	poolCfg.MinConns = cfg.PoolMinConns
	poolCfg.MaxConnLifetime = time.Hour
	poolCfg.MaxConnIdleTime = 30 * time.Minute
	poolCfg.HealthCheckPeriod = time.Minute

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return pool, nil
}

// HealthRepo implements domain.HealthChecker.
type HealthRepo struct{ pool *pgxpool.Pool }

func NewHealthRepo(pool *pgxpool.Pool) *HealthRepo { return &HealthRepo{pool: pool} }

func (h *HealthRepo) Ping(ctx context.Context) error { return h.pool.Ping(ctx) }
