"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) {
      // Dev mode: no Supabase configured — proceed unauthenticated.
      toast.message("โหมดทดสอบ: เข้าใช้งานโดยไม่ต้องเข้าสู่ระบบ");
      router.push("/pos");
      return;
    }
    setLoading(true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error("เข้าสู่ระบบไม่สำเร็จ", { description: error.message });
      return;
    }
    router.push("/pos");
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScanLine className="size-6" />
          </div>
          <CardTitle className="text-xl">ร้านขายอาหารปลา</CardTitle>
          <p className="text-sm text-muted-foreground">เข้าสู่ระบบสำหรับพนักงาน</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">อีเมล</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required={isSupabaseConfigured}
                placeholder="staff@fishfood.co.th"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required={isSupabaseConfigured}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" size="lg" disabled={loading} className="mt-2">
              {loading ? <Loader2 className="mr-2 animate-spin" /> : <LogIn className="mr-2" />}
              {isSupabaseConfigured ? "เข้าสู่ระบบ" : "เข้าใช้งาน (โหมดทดสอบ)"}
            </Button>
          </form>
          {!isSupabaseConfigured && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              ยังไม่ได้ตั้งค่า Supabase — กำลังทำงานในโหมดทดสอบ
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
