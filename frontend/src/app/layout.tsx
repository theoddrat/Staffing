import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "The Mathematical Universe",
  description: "A guided journey from 'What is a number?' to research on P versus NP and the Riemann Hypothesis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
