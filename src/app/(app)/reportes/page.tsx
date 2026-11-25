import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { ReportsView } from "@/modules/reports/reports-view";

export const metadata: Metadata = { title: "Reportes" };

export default function Page() {
  return (
    <ModuleGate module="reports">
      <Suspense fallback={<Spinner />}>
        <ReportsView />
      </Suspense>
    </ModuleGate>
  );
}
