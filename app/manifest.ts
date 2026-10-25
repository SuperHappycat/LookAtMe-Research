import type { MetadataRoute } from "next";

/** PWA manifest (offline mode, spec §5.4). Colours match app/globals.css. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LookAtMe Research",
    short_name: "LookAtMe",
    description:
      "เครื่องมือคัดกรองออทิซึมด้วยการติดตามสายตาผ่านกล้อง ใช้คัดกรองเท่านั้น ไม่ใช่การวินิจฉัย / Webcam eye-tracking autism screening aid for schools, clinics and hospitals — screening only, not a diagnosis.",
    lang: "th",
    start_url: "/r",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f7fc",
    theme_color: "#2563eb",
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
