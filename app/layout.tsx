import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "GoStoned — Play Go Online",
    template: "%s · GoStoned",
  },
  description:
    "Play Go online on 9×9, 13×13 and 19×19 boards with saved games, ratings, and live chat.",
  applicationName: "GoStoned",
  openGraph: {
    title: "GoStoned — Play Go Online",
    description: "A focused place to play Go, Baduk and Weiqi online.",
    type: "website",
    images: [{ url: "/og.png", width: 1734, height: 907, alt: "GoStoned — Play Go Online" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GoStoned — Play Go Online",
    description: "A focused place to play Go, Baduk and Weiqi online.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
