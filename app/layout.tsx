import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.CF_PAGES_URL ??
  "http://localhost:3000";

export const metadata: Metadata = {
  title: "StackUp",
  description: "Claim daily on Stacks. Earn on-chain streak badge NFTs.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: "website",
    title: "StackUp",
    description: "Claim daily on Stacks. Earn on-chain streak badge NFTs.",
    url: "/",
    siteName: "StackUp",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "StackUp",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StackUp",
    description: "Claim daily on Stacks. Earn on-chain streak badge NFTs.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/icons/favicon.ico" },
      { url: "/icons/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/icons/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
