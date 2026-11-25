/* eslint-disable @next/next/no-img-element */
import { Scissors } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { BusinessSettings } from "@/types/domain";

export function BrandMark({ settings, size = 40 }: { settings: Pick<BusinessSettings, "logo_url" | "business_name">; size?: number }) {
  if (settings.logo_url) {
    return (
      <img
        src={settings.logo_url}
        alt={settings.business_name}
        width={size}
        height={size}
        className="shrink-0 rounded-lg border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-lg bg-ink text-canvas" style={{ width: size, height: size }}>
      <Icon icon={Scissors} className="h-5 w-5" />
    </span>
  );
}
