import { ImageResponse } from "next/og";

/**
 * Íconos PNG para la PWA (Android) y la pantalla de inicio de iOS.
 * Mismo diseño que src/app/icon.svg, a sangre completa: Android aplica su máscara
 * y iOS redondea las esquinas por su cuenta. Las tijeras quedan dentro de la zona
 * segura del 80 % para que el ícono "maskable" no se recorte.
 * Las rutas terminan en .png para que el middleware de sesión no las intercepte.
 */
const SIZES: Record<string, number> = {
  "icon-192.png": 192,
  "icon-512.png": 512,
  "apple-touch-icon.png": 180,
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(SIZES).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const size = SIZES[file];
  if (!size) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#3F5E4D" }}>
        <svg width={size} height={size} viewBox="0 0 64 64">
          <g fill="none" stroke="#F7F5F0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="21" cy="21" r="6" />
            <circle cx="21" cy="43" r="6" />
            <path d="M25.5 25 46 45" />
            <path d="M25.5 39 46 19" />
          </g>
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
