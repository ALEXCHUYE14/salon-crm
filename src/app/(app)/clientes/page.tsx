import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { ClientsView } from "@/modules/clients/clients-view";

export const metadata: Metadata = { title: "Clientes" };

export default function Page() {
  return (
    <ModuleGate module="clients">
      <Suspense fallback={<Spinner />}>
        <ClientsView />
      </Suspense>
    </ModuleGate>
  );
}
