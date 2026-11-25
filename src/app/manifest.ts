import type { MetadataRoute } from "next";

/** Manifest de la PWA: permite instalar el sistema como app en Android e iPhone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gestión de Barbería y Salón",
    short_name: "Salón",
    description: "CRM, agenda, caja, comisiones e inventario para barberías y salones de belleza.",
    lang: "es",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#F7F5F0",
    theme_color: "#F7F5F0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
