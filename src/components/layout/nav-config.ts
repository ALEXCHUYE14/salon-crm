import {
  BarChart3,
  CalendarDays,
  HeartHandshake,
  LayoutDashboard,
  Package,
  Scissors,
  Settings,
  UserCog,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Terminology } from "@/lib/terminology";
import type { ModuleKey } from "@/types/domain";

/** "my_panel" no es un módulo configurable: lo ve todo el personal que atiende citas. */
export type NavKey = ModuleKey | "my_panel";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  icon: LucideIcon;
}

export function getNavItems(terms: Terminology): NavItem[] {
  return [
    { key: "dashboard", href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
    { key: "my_panel", href: "/mi-panel", label: "Mi panel", icon: UserRound },
    { key: "agenda", href: "/agenda", label: "Agenda", icon: CalendarDays },
    { key: "pos", href: "/caja", label: "Caja", icon: Wallet },
    { key: "clients", href: "/clientes", label: "Clientes", icon: Users },
    { key: "services", href: "/servicios", label: "Servicios", icon: Scissors },
    { key: "team", href: "/equipo", label: terms.professionals, icon: UserCog },
    { key: "inventory", href: "/inventario", label: "Inventario", icon: Package },
    { key: "loyalty", href: "/fidelizacion", label: "Fidelización", icon: HeartHandshake },
    { key: "reports", href: "/reportes", label: "Reportes", icon: BarChart3 },
    { key: "settings", href: "/ajustes", label: "Ajustes", icon: Settings },
  ];
}

/** Accesos fijos de la barra inferior en móvil (el resto va en "Más"). */
export const MOBILE_PRIMARY: NavKey[] = ["dashboard", "agenda", "pos", "clients"];

export function isNavAllowed(item: NavItem, can: (module: ModuleKey) => boolean, isBookable: boolean): boolean {
  return item.key === "my_panel" ? isBookable : can(item.key);
}
