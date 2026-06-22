package postgres

import (
	"math"
	"strconv"
	"strings"
)

// Money is handled as integer cents internally to avoid binary-float rounding
// errors, then formatted back to a fixed-2-decimal string for numeric(12,2).

// parseMoneyToCents turns "1.50" into 150. Tolerant of missing decimals.
func parseMoneyToCents(s string) int64 {
	s = strings.TrimSpace(s)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	parts := strings.SplitN(s, ".", 2)
	whole, _ := strconv.ParseInt(parts[0], 10, 64)
	var frac int64
	if len(parts) == 2 {
		f := (parts[1] + "00")[:2] // pad/truncate to 2 dp
		frac, _ = strconv.ParseInt(f, 10, 64)
	}
	cents := whole*100 + frac
	if neg {
		cents = -cents
	}
	return cents
}

// centsToMoney turns 150 into "1.50".
func centsToMoney(cents int64) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	whole := cents / 100
	frac := cents % 100
	sign := ""
	if neg {
		sign = "-"
	}
	return sign + strconv.FormatInt(whole, 10) + "." + pad2(frac)
}

func pad2(n int64) string {
	if n < 10 {
		return "0" + strconv.FormatInt(n, 10)
	}
	return strconv.FormatInt(n, 10)
}

// parseRate parses a tax rate like "0.0700" into a float64 multiplier.
func parseRate(s string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return f
}

// roundHalfUp rounds to the nearest whole cent (banker-free, matches SQL round).
func roundHalfUp(v float64) int64 {
	return int64(math.Floor(v + 0.5))
}
