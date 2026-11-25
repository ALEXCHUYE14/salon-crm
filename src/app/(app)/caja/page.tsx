import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { CashView } from "@/modules/pos/cash-view";

export const metadata: Metadata = { title: "Caja" };

export default function Page() {
  return (
    <ModuleGate module="pos">
      <Suspense fallback={<Spinner />}>
        <CashView />
      </Suspense>
    </ModuleGate>
  );
}
