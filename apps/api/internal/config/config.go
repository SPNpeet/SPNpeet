// Package config loads and validates runtime configuration from the
// environment. Fails fast on missing critical values in production.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env              string
	Port             string
	DatabaseURL      string
	PoolMaxConns     int32
	PoolMinConns     int32
	LockTimeout      time.Duration
	CORSOrigins      []string
	SupabaseJWTSecret string
}

// Load reads configuration from the environment, applying sane defaults.
func Load() (*Config, error) {
	cfg := &Config{
		Env:               getEnv("API_ENV", "development"),
		Port:              getEnv("API_PORT", "8080"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		PoolMaxConns:      int32(getEnvInt("DB_POOL_MAX_CONNS", 20)),
		PoolMinConns:      int32(getEnvInt("DB_POOL_MIN_CONNS", 2)),
		LockTimeout:       time.Duration(getEnvInt("DB_LOCK_TIMEOUT_MS", 3000)) * time.Millisecond,
		CORSOrigins:       splitCSV(getEnv("CORS_ORIGINS", "http://localhost:3000")),
		SupabaseJWTSecret: os.Getenv("SUPABASE_JWT_SECRET"),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	// In production the JWT secret is mandatory; in dev we allow an unauthed
	// mode for local POS testing but warn loudly at startup (see main).
	if cfg.IsProduction() && cfg.SupabaseJWTSecret == "" {
		return nil, fmt.Errorf("SUPABASE_JWT_SECRET is required in production")
	}
	return cfg, nil
}

func (c *Config) IsProduction() bool { return strings.EqualFold(c.Env, "production") }

func getEnv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
