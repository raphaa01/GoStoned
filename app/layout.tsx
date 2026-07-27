import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "KAYA — Play Go Online",
    template: "%s · KAYA",
  },
  description:
    "Play Go online on 9×9, 13×13 and 19×19 boards. Find your next match and grow your game.",
  applicationName: "KAYA",
  openGraph: {
    title: "KAYA — The quiet game, played together.",
    description: "A modern home for Go, Baduk and Weiqi.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1734,
        height: 907,
        alt: "KAYA — The quiet game, played together.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "KAYA — Play Go Online",
    description: "A modern home for Go, Baduk and Weiqi.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
