import type { MetadataRoute } from "next";

/** The web app manifest (`/manifest.webmanifest`): name, colors and home-screen icons. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SecureCargo",
    short_name: "SecureCargo",
    description: "Physics-tested cargo securement.",
    start_url: "/app",
    display: "standalone",
    background_color: "#F8F8F3",
    theme_color: "#F8F8F3",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
