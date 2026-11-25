"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { MODULE_LABELS } from "@/lib/constants";
import { useApp } from "@/providers/app-provider";
import type { ModuleKey } from "@/types/domain";

export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { can } = useApp();
  if (can(module)) return <>{children}</>;
  return (
    <Card>
      <EmptyState
        icon={Lock}
        title={`Sin acceso a ${MODULE_LABELS[module]}`}
        description="El módulo está desactivado en Ajustes o tu rol no tiene permiso para usarlo."
        action={
          <Link href="/dashboard" className={buttonClasses({ variant: "outline" })}>
            Volver al inicio
          </Link>
        }
      />
    </Card>
  );
}
