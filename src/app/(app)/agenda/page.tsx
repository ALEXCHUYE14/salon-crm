import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { AgendaView } from "@/modules/agenda/agenda-view";

export const metadata: Metadata = { title: "Agenda" };

export default function Page() {
  return (
    <ModuleGate module="agenda">
      <Suspense fallback={<Spinner />}>
        <AgendaView />
      </Suspense>
    </ModuleGate>
  );
}
