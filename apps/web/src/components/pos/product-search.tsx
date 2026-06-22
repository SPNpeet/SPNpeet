"use client";

/**
 * Manual product lookup over the LOCAL catalog (works offline). Category chips
 * + free-text search render a grid of large tap targets — designed for fast
 * touch entry at the register. UI in Thai (ร้านขายอาหารปลา).
 */
import * as React from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listCategories, searchProductsByCategory } from "@/lib/db/catalog";
import type { CachedProduct } from "@/lib/db/dexie";
import { formatMoney, cn } from "@/lib/utils";

interface Props {
  onSelect: (product: CachedProduct) => void;
}

export function ProductSearch({ onSelect }: Props) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(""); // "" = ทั้งหมด
  const [categories, setCategories] = React.useState<string[]>([]);
  const [results, setResults] = React.useState<CachedProduct[]>([]);

  React.useEffect(() => {
    void listCategories().then(setCategories);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      const items = await searchProductsByCategory(query, category);
      if (!cancelled) setResults(items);
      // refresh chips in case the catalog was just synced
      void listCategories().then((c) => !cancelled && setCategories(c));
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query, category]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อสินค้า, รหัส หรือบาร์โค้ด…"
          className="pl-9"
          inputMode="search"
          autoComplete="off"
        />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5">
        <Chip active={category === ""} onClick={() => setCategory("")}>
          ทั้งหมด
        </Chip>
        {categories.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {c}
          </Chip>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
        {results.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            onClick={() => onSelect(p)}
            className="flex h-28 flex-col items-start justify-between p-3 text-left"
          >
            <span className="line-clamp-3 w-full whitespace-normal text-sm font-medium leading-snug">
              {p.name}
            </span>
            <span className="flex w-full items-center justify-between">
              <span className="font-semibold text-primary">{formatMoney(p.price)}</span>
              <Badge variant={p.quantity > 0 ? "secondary" : "destructive"}>
                {p.quantity > 0 ? `คงเหลือ ${p.quantity}` : "หมด"}
              </Badge>
            </span>
          </Button>
        ))}
        {results.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            ไม่พบสินค้า — เชื่อมต่ออินเทอร์เน็ตแล้วกดซิงก์แคตตาล็อกเพื่อใช้งานออฟไลน์
          </p>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
