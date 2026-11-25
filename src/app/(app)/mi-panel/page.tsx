import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/ui/misc";
import { MyPanelView } from "@/modules/my-panel/my-panel-view";

export const metadata: Metadata = { title: "Mi panel" };

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <MyPanelView />
    </Suspense>
  );
}
