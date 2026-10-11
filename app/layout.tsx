import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// Geist (crisp, modern geometric sans) for both headings and body text.
const geist = Geist({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LookAtMe — Web Demo",
  description: "Browser-based port of the LookAtMe eye-tracking screening tool.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body>{children}</body>
    </html>
  );
}
