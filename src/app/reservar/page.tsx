import type { Metadata } from "next";
import { PublicBooking } from "@/modules/booking/public-booking";

export const metadata: Metadata = {
  title: "Reservar cita",
  description: "Elige tu servicio, profesional y horario disponible.",
};

export default function ReservarPage() {
  return <PublicBooking />;
}
