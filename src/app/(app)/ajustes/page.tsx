import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { SettingsView } from "@/modules/settings/settings-view";

export const metadata: Metadata = { title: "Ajustes" };

export default function Page() {
  return (
    <ModuleGate module="settings">
      <Suspense fallback={<Spinner />}>
        <SettingsView />
      </Suspense>
    </ModuleGate>
  );
}
