import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { InventoryView } from "@/modules/inventory/inventory-view";

export const metadata: Metadata = { title: "Inventario" };

export default function Page() {
  return (
    <ModuleGate module="inventory">
      <Suspense fallback={<Spinner />}>
        <InventoryView />
      </Suspense>
    </ModuleGate>
  );
}
