import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { ServicesView } from "@/modules/services/services-view";

export const metadata: Metadata = { title: "Servicios" };

export default function Page() {
  return (
    <ModuleGate module="services">
      <Suspense fallback={<Spinner />}>
        <ServicesView />
      </Suspense>
    </ModuleGate>
  );
}
