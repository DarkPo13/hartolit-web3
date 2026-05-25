import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Crimson_Pro } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const crimson = Crimson_Pro({
  subsets: ["latin"],
  variable: "--font-crimson",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Hartolit Digital Field Passport",
    template: "%s · Hartolit",
  },
  description:
    "Immutable on-chain certificates (NFTs) for agricultural drone treatments. " +
    "Issued on BNB Chain, signed with Diia KEP, pinned to IPFS.",
  applicationName: "Hartolit Field Passport",
  authors: [{ name: "VANTREXIS" }],
  keywords: [
    "Hartolit",
    "agriculture",
    "drone",
    "NFT",
    "BNB Chain",
    "Diia",
    "KEP",
    "field passport",
  ],
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://dapp.hartolit-agro.com"),
  openGraph: {
    type: "website",
    siteName: "Hartolit Field Passport",
    title: "Hartolit Digital Field Passport",
    description: "On-chain certificates for every agricultural drone treatment.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10b981",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="uk"
      className={`${geistSans.variable} ${geistMono.variable} ${crimson.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
