import type { OperatingMode, Segment, TechnicalRecordType } from "@/types/domain";

export interface Terminology {
  businessType: string;
  professional: string;
  professionals: string;
  station: string;
  stations: string;
}

export function getTerminology(mode: OperatingMode): Terminology {
  switch (mode) {
    case "barbershop":
      return { businessType: "Barbería", professional: "Barbero", professionals: "Barberos", station: "Silla", stations: "Sillas" };
    case "beauty_salon":
      return {
        businessType: "Salón de belleza",
        professional: "Estilista",
        professionals: "Estilistas",
        station: "Tocador",
        stations: "Tocadores",
      };
    case "hybrid":
    default:
      return {
        businessType: "Barbería y salón",
        professional: "Especialista",
        professionals: "Especialistas",
        station: "Puesto",
        stations: "Puestos",
      };
  }
}

/** Segmentos visibles según el modo operativo. */
export function segmentsForMode(mode: OperatingMode): Segment[] {
  if (mode === "barbershop") return ["barbershop", "both"];
  if (mode === "beauty_salon") return ["beauty_salon", "both"];
  return ["barbershop", "beauty_salon", "both"];
}

export function isSegmentVisible(segment: Segment, mode: OperatingMode): boolean {
  return segmentsForMode(mode).includes(segment);
}

export function recordTypesForMode(mode: OperatingMode): TechnicalRecordType[] {
  if (mode === "barbershop") return ["barber"];
  if (mode === "beauty_salon") return ["color", "hair_diagnosis", "treatment", "nails", "skin"];
  return ["barber", "color", "hair_diagnosis", "treatment", "nails", "skin"];
}
