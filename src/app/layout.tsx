import type { Metadata } from "next";
import "./globals.css";
import "./scanner.css";

export const metadata: Metadata = {
  title: "Cardhaus — Your cards, your market",
  description: "A personal trading card portfolio and independent card marketplace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
