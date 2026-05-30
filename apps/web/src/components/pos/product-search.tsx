"use client";

/**
 * Manual product lookup over the LOCAL catalog (works offline). Renders a
 * grid of large tap targets — designed for fast touch entry at the register.
 */
import * as React from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { searchProducts } from "@/lib/db/catalog";
import type { CachedProduct } from "@/lib/db/dexie";
import { formatMoney } from "@/lib/utils";

interface Props {
  onSelect: (product: CachedProduct) => void;
}

export function ProductSearch({ onSelect }: Props) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CachedProduct[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      const items = await searchProducts(query);
      if (!cancelled) setResults(items);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, SKU or barcode…"
          className="pl-9"
          inputMode="search"
          autoComplete="off"
        />
      </div>

      <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
        {results.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            onClick={() => onSelect(p)}
            className="flex h-24 flex-col items-start justify-between p-3 text-left"
          >
            <span className="line-clamp-2 w-full whitespace-normal text-sm font-medium">{p.name}</span>
            <span className="flex w-full items-center justify-between">
              <span className="font-semibold text-primary">{formatMoney(p.price)}</span>
              <Badge variant={p.quantity > 0 ? "secondary" : "destructive"}>{p.quantity}</Badge>
            </span>
          </Button>
        ))}
        {results.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            No products. Pull the catalog while online to scan offline.
          </p>
        )}
      </div>
    </div>
  );
}
