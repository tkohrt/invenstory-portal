import type { Metadata } from "next";
import { Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const heading = Cormorant_Garamond({ weight: ["600", "700"], subsets: ["latin"], variable: "--font-heading" });

export const metadata: Metadata = {
  title: "Inven(s)tory Portal — For Granted",
  description: "Your story, organized and fundable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={heading.variable}>{children}</body>
    </html>
  );
}
