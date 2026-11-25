import type { Service, ServiceCategory, StaffMember } from "@/types/domain";

/**
 * Caché en memoria (por pestaña) del catálogo: equipo, servicios y categorías.
 * Evita descargarlos de nuevo en cada pantalla (menos egress, menos logs y
 * navegación instantánea). Se invalida al guardar cambios y caduca a los 5 minutos.
 */
export interface CatalogData {
  staff: StaffMember[];
  services: Service[];
  categories: ServiceCategory[];
}

const TTL_MS = 5 * 60_000;

let cached: { at: number; data: CatalogData } | null = null;
let inflight: { version: number; promise: Promise<CatalogData> } | null = null;
let version = 0;

export function readCatalogCache(): CatalogData | null {
  return cached && Date.now() - cached.at < TTL_MS ? cached.data : null;
}

/** Llamar después de crear/editar/borrar personal, servicios, categorías o sedes. */
export function invalidateCatalog(): void {
  version += 1;
  cached = null;
  inflight = null;
}

export async function loadCatalog(fetcher: () => Promise<CatalogData>, force = false): Promise<CatalogData> {
  if (!force) {
    const fresh = readCatalogCache();
    if (fresh) return fresh;
    if (inflight && inflight.version === version) return inflight.promise;
  }
  const started = version;
  const promise = fetcher().then((data) => {
    // Si alguien invalidó mientras se descargaba, no se guarda un resultado viejo
    if (started === version) cached = { at: Date.now(), data };
    return data;
  });
  inflight = { version: started, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}
