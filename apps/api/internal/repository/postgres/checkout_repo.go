package postgres

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/spnpeet/spnpeet/apps/api/internal/config"
	"github.com/spnpeet/spnpeet/apps/api/internal/domain"
)

// CheckoutRepo implements domain.CheckoutRepository using a single explicit
// transaction with pessimistic locking. This is the heart of the engine.
type CheckoutRepo struct {
	pool *pgxpool.Pool
	cfg  *config.Config
}

func NewCheckoutRepo(pool *pgxpool.Pool, cfg *config.Config) *CheckoutRepo {
	return &CheckoutRepo{pool: pool, cfg: cfg}
}

// ProcessCheckout runs the full atomic protocol:
//
//	BEGIN  (SERIALIZABLE-safe via row locks; we use READ COMMITTED + FOR UPDATE)
//	  set app.current_user_id  -> audit attribution
//	  set local lock_timeout   -> bounded waiting -> LOCK_TIMEOUT code
//	  idempotency check on client_uuid
//	  for each item (sorted by product_id to avoid deadlocks):
//	     SELECT ... FOR UPDATE   (pessimistic lock)
//	     validate stock
//	  insert order header
//	  for each item: deduct, ledger row, order line
//	  update order totals
//	COMMIT
func (r *CheckoutRepo) ProcessCheckout(ctx context.Context, req domain.CheckoutRequest, actorID uuid.UUID) (*domain.Order, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	// Roll back unless we explicitly commit. Safe to call after commit.
	defer func() { _ = tx.Rollback(ctx) }()

	// Audit attribution: triggers read app.current_user_id via app.current_actor().
	if actorID != uuid.Nil {
		if _, err := tx.Exec(ctx, "SELECT set_config('app.current_user_id', $1, true)", actorID.String()); err != nil {
			return nil, fmt.Errorf("set actor: %w", err)
		}
	}

	// Bound how long we'll wait on a contended lock before bailing out with a
	// retryable LOCK_TIMEOUT instead of hanging the request.
	lockMs := r.cfg.LockTimeout.Milliseconds()
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL lock_timeout = '%dms'", lockMs)); err != nil {
		return nil, fmt.Errorf("set lock_timeout: %w", err)
	}

	// ---- Idempotency: has this client_uuid already been processed? ----------
	existing, err := r.findOrderByClientUUID(ctx, tx, req.ClientUUID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		existing.Idempotent = true
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit (idempotent): %w", err)
		}
		return existing, nil
	}

	if len(req.Items) == 0 {
		return nil, domain.NewDomainError(domain.CodeEmptyCart, "cart contains no items")
	}

	// Merge duplicate product lines and sort by product_id for a deterministic
	// lock-acquisition order (deadlock avoidance across concurrent checkouts).
	merged := mergeItems(req.Items)
	ids := make([]uuid.UUID, 0, len(merged))
	for id := range merged {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })

	// ---- Phase 1+2: lock + validate ----------------------------------------
	type lockedProduct struct {
		price    string
		taxRate  string
		sku      string
		name     string
		onHand   int
		quantity int
	}
	locked := make(map[uuid.UUID]*lockedProduct, len(ids))

	for _, pid := range ids {
		qty := merged[pid]
		if qty <= 0 {
			de := domain.NewDomainError(domain.CodeInvalidQuantity, "quantity must be positive")
			de.ProductID = pid.String()
			return nil, de
		}

		// Single query: lock the inventory row AND read the product, joined.
		// FOR UPDATE OF inventory locks only the on-hand row.
		var lp lockedProduct
		var isActive bool
		row := tx.QueryRow(ctx, `
			SELECT p.sku, p.name, p.price::text, p.tax_rate::text, p.is_active, i.quantity
			FROM public.inventory i
			JOIN public.products  p ON p.id = i.product_id
			WHERE i.product_id = $1
			FOR UPDATE OF i`, pid)
		if err := row.Scan(&lp.sku, &lp.name, &lp.price, &lp.taxRate, &isActive, &lp.onHand); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				de := domain.NewDomainError(domain.CodeProductNotFound, "product does not exist")
				de.ProductID = pid.String()
				return nil, de
			}
			if isLockTimeout(err) {
				return nil, domain.NewDomainError(domain.CodeLockTimeout, "inventory row is busy, retry")
			}
			return nil, fmt.Errorf("lock product %s: %w", pid, err)
		}
		if !isActive {
			de := domain.NewDomainError(domain.CodeProductNotFound, "product is inactive")
			de.ProductID = pid.String()
			return nil, de
		}
		if lp.onHand < qty {
			de := domain.NewDomainError(domain.CodeInsufficientStock,
				fmt.Sprintf("requested %d but only %d on hand", qty, lp.onHand))
			de.ProductID = pid.String()
			return nil, de
		}
		lp.quantity = qty
		locked[pid] = &lp
	}

	// ---- Create the order header -------------------------------------------
	soldAt := req.SoldAt
	if soldAt.IsZero() {
		soldAt = time.Now().UTC()
	}
	var cashier any
	if req.CashierID != uuid.Nil {
		cashier = req.CashierID
	}

	order := &domain.Order{ClientUUID: req.ClientUUID, Status: "completed", SoldAt: soldAt}
	if req.CashierID != uuid.Nil {
		cid := req.CashierID
		order.CashierID = &cid
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO public.orders (client_uuid, status, subtotal, tax_total, total, cashier_id, sold_at)
		VALUES ($1, 'completed', 0, 0, 0, $2, $3)
		RETURNING id, order_number`,
		req.ClientUUID, cashier, soldAt,
	).Scan(&order.ID, &order.OrderNumber)
	if err != nil {
		// Unique violation on client_uuid => a concurrent request won the race;
		// treat as idempotent success.
		if isUniqueViolation(err) {
			again, ferr := r.findOrderByClientUUID(ctx, tx, req.ClientUUID)
			if ferr == nil && again != nil {
				again.Idempotent = true
				if cerr := tx.Commit(ctx); cerr != nil {
					return nil, fmt.Errorf("commit (race idempotent): %w", cerr)
				}
				return again, nil
			}
		}
		return nil, fmt.Errorf("insert order: %w", err)
	}

	// ---- Phase 3: deduct, ledger, lines ------------------------------------
	var subtotalCents, taxCents int64
	for _, pid := range ids {
		lp := locked[pid]
		priceCents := parseMoneyToCents(lp.price)
		taxRate := parseRate(lp.taxRate)
		lineCents := priceCents * int64(lp.quantity)
		lineTaxCents := roundHalfUp(float64(lineCents) * taxRate)
		subtotalCents += lineCents
		taxCents += lineTaxCents

		var newQty int
		if err := tx.QueryRow(ctx, `
			UPDATE public.inventory SET quantity = quantity - $2
			WHERE product_id = $1
			RETURNING quantity`, pid, lp.quantity).Scan(&newQty); err != nil {
			return nil, fmt.Errorf("deduct %s: %w", pid, err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO public.inventory_transactions
			  (product_id, delta, resulting_qty, txn_type, order_id, actor_id, note)
			VALUES ($1, $2, $3, 'sale', $4, $5, 'POS checkout')`,
			pid, -lp.quantity, newQty, order.ID, nullableUUID(actorID)); err != nil {
			return nil, fmt.Errorf("ledger %s: %w", pid, err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO public.order_items
			  (order_id, product_id, sku, name, unit_price, tax_rate, quantity, line_total)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			order.ID, pid, lp.sku, lp.name, lp.price, lp.taxRate, lp.quantity, centsToMoney(lineCents)); err != nil {
			return nil, fmt.Errorf("order line %s: %w", pid, err)
		}

		order.Lines = append(order.Lines, domain.OrderLine{
			ProductID: pid, SKU: lp.sku, Name: lp.name,
			UnitPrice: lp.price, Quantity: lp.quantity, LineTotal: centsToMoney(lineCents),
		})
	}

	totalCents := subtotalCents + taxCents
	if _, err := tx.Exec(ctx, `
		UPDATE public.orders SET subtotal = $2, tax_total = $3, total = $4 WHERE id = $1`,
		order.ID, centsToMoney(subtotalCents), centsToMoney(taxCents), centsToMoney(totalCents)); err != nil {
		return nil, fmt.Errorf("update totals: %w", err)
	}

	order.Subtotal = centsToMoney(subtotalCents)
	order.TaxTotal = centsToMoney(taxCents)
	order.Total = centsToMoney(totalCents)

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return order, nil
}

func (r *CheckoutRepo) findOrderByClientUUID(ctx context.Context, tx pgx.Tx, clientUUID uuid.UUID) (*domain.Order, error) {
	o := &domain.Order{}
	var cashier *uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT id, order_number, client_uuid, status, subtotal::text, tax_total::text, total::text, cashier_id, sold_at
		FROM public.orders WHERE client_uuid = $1`, clientUUID,
	).Scan(&o.ID, &o.OrderNumber, &o.ClientUUID, &o.Status, &o.Subtotal, &o.TaxTotal, &o.Total, &cashier, &o.SoldAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup client_uuid: %w", err)
	}
	o.CashierID = cashier
	return o, nil
}

// mergeItems collapses duplicate product lines into summed quantities.
func mergeItems(items []domain.CheckoutItem) map[uuid.UUID]int {
	m := make(map[uuid.UUID]int, len(items))
	for _, it := range items {
		m[it.ProductID] += it.Quantity
	}
	return m
}

func nullableUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// ---- pg error classification ----------------------------------------------

func isLockTimeout(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		// 55P03 lock_not_available, 57014 query_canceled (statement/lock timeout)
		return pgErr.Code == "55P03" || pgErr.Code == "57014"
	}
	return false
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}
