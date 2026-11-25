"use client";

import type { ReactNode } from "react";
import { useApp } from "@/providers/app-provider";
import { BottomNav } from "./bottom-nav";
import { BrandMark } from "./brand-mark";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { settings, terms } = useApp();

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar />

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:hidden">
        <BrandMark settings={settings} size={32} />
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-ink">{settings.business_name}</p>
          <p className="truncate text-[11px] text-muted">{terms.businessType}</p>
        </div>
      </header>

      <main className="pb-24 md:pb-10 md:pl-20 lg:pl-64">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 md:py-8 lg:px-8">{children}</div>
      </main>

      <BottomNav />
    </div>
  );
}
