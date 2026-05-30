"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, LogOut, ScanLine, Package } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BarcodeScanner } from "@/components/pos/barcode-scanner";
import { ProductSearch } from "@/components/pos/product-search";
import { CartPanel } from "@/components/pos/cart-panel";
import { SyncIndicator } from "@/components/pos/sync-indicator";
import { useSync } from "@/hooks/use-sync";
import { useCart } from "@/store/cart";
import { refreshCatalog } from "@/lib/sync/catalog-sync";
import { catalogCount } from "@/lib/db/catalog";
import { supabase, getUserId } from "@/lib/supabase/client";
import type { CachedProduct } from "@/lib/db/dexie";

export default function PosPage() {
  const router = useRouter();
  const { online, stats } = useSync();
  const addProduct = useCart((s) => s.addProduct);

  const [cashierId, setCashierId] = React.useState<string | null>(null);
  const [catalogSize, setCatalogSize] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [tab, setTab] = React.useState<"scan" | "search">("search");

  const syncCatalog = React.useCallback(async () => {
    setRefreshing(true);
    const res = await refreshCatalog();
    setCatalogSize(await catalogCount());
    setRefreshing(false);
    if (res.ok) toast.success(`Catalog updated — ${res.count} products`);
    else toast.message("Using cached catalog (offline)");
  }, []);

  // Bootstrap: identify cashier + warm the offline catalog.
  React.useEffect(() => {
    void (async () => {
      setCashierId(await getUserId());
      setCatalogSize(await catalogCount());
      await syncCatalog();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProduct = React.useCallback(
    (p: CachedProduct) => {
      addProduct(p);
      toast.success(`Added ${p.name}`);
    },
    [addProduct],
  );

  const handleUnknown = React.useCallback((barcode: string) => {
    toast.error("Unknown barcode", { description: barcode });
  }, []);

  const handleLogout = async () => {
    await supabase()?.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="flex h-dvh flex-col bg-muted/30">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b bg-background px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ScanLine className="size-5 text-primary" />
          <span className="font-semibold">SPNpeet POS</span>
          <Badge variant="outline" className="ml-1 gap-1">
            <Package className="size-3" />
            {catalogSize}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <SyncIndicator online={online} stats={stats} />
          <Button variant="ghost" size="icon" onClick={syncCatalog} disabled={refreshing} title="Refresh catalog">
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
            <LogOut />
          </Button>
        </div>
      </header>

      {/* Body: input area + cart */}
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_400px]">
        <section className="flex flex-col gap-3 overflow-hidden p-3">
          <div className="flex gap-2">
            <Button
              variant={tab === "search" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setTab("search")}
            >
              Browse
            </Button>
            <Button
              variant={tab === "scan" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setTab("scan")}
            >
              Scan
            </Button>
          </div>

          <div className="flex-1 overflow-hidden">
            {tab === "scan" ? (
              <BarcodeScanner onProduct={handleProduct} onUnknown={handleUnknown} />
            ) : (
              <ProductSearch onSelect={handleProduct} />
            )}
          </div>
        </section>

        <Separator orientation="vertical" className="hidden lg:block" />

        <aside className="border-t bg-background lg:border-l lg:border-t-0">
          <CartPanel cashierId={cashierId} online={online} />
        </aside>
      </div>
    </div>
  );
}
