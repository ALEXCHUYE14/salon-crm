import { getSupabase, unwrap } from "@/lib/supabase/client";
import type { BusinessHour, Segment, Specialty } from "@/types/domain";

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  segment: Segment;
  duration_minutes: number;
  price: number;
}

export interface PublicStaff {
  id: string;
  name: string;
  specialty: Specialty;
  color: string;
  branch_id?: string | null;
}

export interface PublicBookingInfo {
  enabled: boolean;
  business_name?: string;
  slogan?: string | null;
  logo_url?: string | null;
  phone?: string | null;
  address?: string | null;
  currency_symbol?: string;
  locale?: string;
  days_ahead?: number;
  min_notice_minutes?: number;
  note?: string | null;
  business_hours?: BusinessHour[];
  today?: string;
  categories?: { id: string; name: string }[];
  services?: PublicService[];
  staff?: PublicStaff[];
  branches?: { id: string; name: string; address: string | null }[];
}

export interface PublicSlot {
  slot_time: string;
  staff_id: string;
}

export interface BookingRequest {
  branch_id?: string | null;
  service_id: string;
  staff_id: string | null;
  date: string;
  time: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
}

export interface BookingResult {
  reference: string;
  service: string;
  staff: string;
  date: string;
  time: string;
  duration_minutes: number;
  price: number;
}

export async function fetchBookingInfo(): Promise<PublicBookingInfo> {
  return unwrap<PublicBookingInfo>(await getSupabase().rpc("public_booking_info"));
}

export async function fetchSlots(serviceId: string, date: string, staffId: string | null, branchId?: string | null): Promise<PublicSlot[]> {
  const params: Record<string, string | null> = { p_service_id: serviceId, p_date: date, p_staff_id: staffId };
  if (branchId) params.p_branch_id = branchId;
  const rows = unwrap<PublicSlot[]>(await getSupabase().rpc("public_available_slots", params));
  return rows ?? [];
}

export async function createPublicBooking(request: BookingRequest): Promise<BookingResult> {
  return unwrap<BookingResult>(await getSupabase().rpc("public_create_booking", { p_payload: request }));
}

/** Misma regla que la función SQL staff_can_serve. */
export function staffCanServe(specialty: Specialty, segment: Segment): boolean {
  if (specialty === "none") return false;
  if (segment === "both" || specialty === "both") return true;
  if (segment === "barbershop") return specialty === "barber";
  if (segment === "beauty_salon") return specialty === "stylist";
  return false;
}
