"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, MoreHorizontal } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { ROLE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useApp } from "@/providers/app-provider";
import { BranchSwitcher } from "@/modules/branches/branch-switcher";
import { getNavItems, isNavAllowed, MOBILE_PRIMARY } from "./nav-config";

/** Barra de navegación inferior fija (móvil). */
export function BottomNav() {
  const pathname = usePathname();
  const { staff, terms, can, signOut } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);

  const allowed = getNavItems(terms).filter((item) => isNavAllowed(item, can, staff.is_bookable));
  const primary = allowed.filter((item) => MOBILE_PRIMARY.includes(item.key));
  const secondary = allowed.filter((item) => !MOBILE_PRIMARY.includes(item.key));
  const secondaryActive = secondary.some((item) => pathname.startsWith(item.href));

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur md:hidden"
        aria-label="Navegación inferior"
      >
        <div className="grid grid-cols-5">
          {primary.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-sage" : "text-muted",
                )}
              >
                <Icon icon={item.icon} className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
          {Array.from({ length: Math.max(0, 4 - primary.length) }).map((_, i) => (
            <span key={`spacer-${i}`} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium",
              secondaryActive ? "text-sage" : "text-muted",
            )}
          >
            <Icon icon={MoreHorizontal} className="h-5 w-5" />
            Más
          </button>
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Más opciones" size="sm">
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
          <Avatar name={staff.full_name} color={staff.color} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{staff.full_name}</p>
            <p className="text-xs text-muted">{ROLE_LABELS[staff.role]}</p>
          </div>
        </div>
        <BranchSwitcher className="mb-4" />
        <div className="grid grid-cols-3 gap-2">
          {secondary.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setMoreOpen(false)}
              className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface text-xs font-medium text-ink hover:bg-surface-2"
            >
              <Icon icon={item.icon} className="h-5 w-5 text-sage" />
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface text-xs font-medium text-clay hover:bg-clay-soft"
          >
            <Icon icon={LogOut} className="h-5 w-5" />
            Salir
          </button>
        </div>
      </Modal>
    </>
  );
}
