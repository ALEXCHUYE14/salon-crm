import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AppProvider } from "@/providers/app-provider";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
