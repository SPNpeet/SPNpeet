// Package middleware holds Fiber middlewares (auth, request context).
package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ContextUserID is the Fiber locals key holding the authenticated user uuid.
const ContextUserID = "user_id"

// AuthConfig configures the JWT middleware.
type AuthConfig struct {
	// JWTSecret is the Supabase project JWT secret (HS256).
	JWTSecret string
	// AllowAnonymous, when true (dev only), lets unauthenticated requests
	// through with a Nil user id. Production MUST set this false.
	AllowAnonymous bool
}

// SupabaseClaims models the subset of Supabase JWT claims we rely on.
type SupabaseClaims struct {
	jwt.RegisteredClaims
	Role  string `json:"role"`
	Email string `json:"email"`
}

// JWT returns middleware that verifies a Supabase-issued bearer token and puts
// the user id into Fiber locals. On failure it returns 401 with a stable code.
func JWT(cfg AuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		auth := c.Get("Authorization")
		if auth == "" || !strings.HasPrefix(strings.ToLower(auth), "bearer ") {
			if cfg.AllowAnonymous {
				c.Locals(ContextUserID, uuid.Nil)
				return c.Next()
			}
			return unauthorized(c, "missing bearer token")
		}

		tokenStr := strings.TrimSpace(auth[len("Bearer "):])
		claims := &SupabaseClaims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			return unauthorized(c, "invalid or expired token")
		}

		uid, err := uuid.Parse(claims.Subject)
		if err != nil {
			return unauthorized(c, "token subject is not a valid user id")
		}
		c.Locals(ContextUserID, uid)
		return c.Next()
	}
}

// UserID extracts the authenticated user id from the request context.
func UserID(c *fiber.Ctx) uuid.UUID {
	if v, ok := c.Locals(ContextUserID).(uuid.UUID); ok {
		return v
	}
	return uuid.Nil
}

func unauthorized(c *fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
		"error": fiber.Map{"code": "UNAUTHORIZED", "message": msg},
	})
}
