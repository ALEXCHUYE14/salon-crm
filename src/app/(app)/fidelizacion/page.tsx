import type { Metadata } from "next";
import { Suspense } from "react";
import { ModuleGate } from "@/components/layout/module-gate";
import { Spinner } from "@/components/ui/misc";
import { LoyaltyView } from "@/modules/loyalty/loyalty-view";

export const metadata: Metadata = { title: "Fidelización" };

export default function Page() {
  return (
    <ModuleGate module="loyalty">
      <Suspense fallback={<Spinner />}>
        <LoyaltyView />
      </Suspense>
    </ModuleGate>
  );
}
