import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "GoStone — Play Go Online",
    template: "%s · GoStone",
  },
  description:
    "Play Go online on 9×9, 13×13 and 19×19 boards with saved games, ratings, and live chat.",
  applicationName: "GoStone",
  openGraph: {
    title: "GoStone — Play Go Online",
    description: "A focused place to play Go, Baduk and Weiqi online.",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "GoStone — Play Go Online" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GoStone — Play Go Online",
    description: "A focused place to play Go, Baduk and Weiqi online.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
