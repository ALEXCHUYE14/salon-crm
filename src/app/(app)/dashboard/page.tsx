import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { DashboardView } from "@/modules/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Inicio" };

export default function Page() {
  return (
    <ModuleGate module="dashboard">
      <Suspense fallback={<Spinner />}>
        <DashboardView />
      </Suspense>
    </ModuleGate>
  );
}
