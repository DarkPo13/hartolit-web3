import type { MetadataRoute } from "next";

/** Lets operators and admins add the app to a phone's home screen. No service
 * worker: signed-in pages hold private records and must not be cached on a device.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hartolit Field Passport",
    short_name: "Hartolit",
    description: "Паспорти обробки полів: чернетки, докази та перевірка.",
    lang: "uk",
    start_url: "/start",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf7",
    theme_color: "#10b981",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The logo sits well inside the maskable safe zone on a full-bleed background.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
