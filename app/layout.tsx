import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Voting Legislation Impact Coder",
  description:
    "Deterministic provision-level coding of voting legislation: restrictive, expansive, election interference, or neutral — one record per impact per bill.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
