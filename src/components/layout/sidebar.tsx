"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/misc";
import { ROLE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import { BrandMark } from "./brand-mark";
import { BranchSwitcher } from "@/modules/branches/branch-switcher";
import { getNavItems, isNavAllowed } from "./nav-config";

/** md: riel compacto (tableta) · lg: barra lateral completa (PC). */
export function Sidebar() {
  const pathname = usePathname();
  const { settings, staff, terms, can, signOut } = useApp();
  const items = getNavItems(terms).filter((item) => isNavAllowed(item, can, staff.is_bookable));

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-line bg-surface md:flex lg:w-64">
      <div className="flex h-16 items-center gap-3 border-b border-line px-4 lg:px-5">
        <BrandMark settings={settings} />
        <div className="hidden min-w-0 lg:block">
          <p className="truncate font-display text-sm font-semibold text-ink">{settings.business_name}</p>
          <p className="truncate text-xs text-muted">{terms.businessType}</p>
        </div>
      </div>

      <BranchSwitcher className="mx-3 mt-3 hidden lg:flex" />
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Navegación principal">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.key}
              href={item.href}
              title={item.label}
              className={cn(
                "flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm",
                active ? "bg-sage-soft text-sage-dark" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon icon={item.icon} className="h-5 w-5 lg:h-[18px] lg:w-[18px]" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-lg px-1 py-2 lg:px-2">
          <div className="hidden lg:block">
            <Avatar name={staff.full_name} color={staff.color} size="sm" />
          </div>
          <div className="hidden min-w-0 flex-1 lg:block">
            <p className="truncate text-sm font-medium text-ink">{staff.full_name}</p>
            <p className="truncate text-xs text-muted">{ROLE_LABELS[staff.role]}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink lg:mx-0"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <Icon icon={LogOut} className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );
}
