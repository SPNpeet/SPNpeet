import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ร้านขายอาหารปลา POS",
  description: "ระบบขายหน้าร้านและจัดการสต๊อกอาหารปลา ใช้งานได้แบบออฟไลน์",
  manifest: "/manifest.json",
  applicationName: "ร้านขายอาหารปลา",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ร้านขายอาหารปลา",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
