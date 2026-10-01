import type { Metadata } from "next";
import { Fraunces, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Fraunces (soft, high-contrast display serif) for headings; Source Serif 4
// (sturdy, highly legible text serif) for everything else.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LookAtMe — Web Demo",
  description: "Browser-based port of the LookAtMe eye-tracking screening tool.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
