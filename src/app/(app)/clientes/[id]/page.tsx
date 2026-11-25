import type { Metadata } from "next";
import { ModuleGate } from "@/components/layout/module-gate";
import { ClientDetailView } from "@/modules/clients/client-detail-view";

export const metadata: Metadata = { title: "Ficha del cliente" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ModuleGate module="clients">
      <ClientDetailView clientId={id} />
    </ModuleGate>
  );
}
