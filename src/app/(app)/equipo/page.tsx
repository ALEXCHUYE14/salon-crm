import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { TeamView } from "@/modules/team/team-view";

export const metadata: Metadata = { title: "Equipo y comisiones" };

export default function Page() {
  return (
    <ModuleGate module="team">
      <Suspense fallback={<Spinner />}>
        <TeamView />
      </Suspense>
    </ModuleGate>
  );
}
