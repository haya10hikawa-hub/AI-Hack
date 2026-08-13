import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Re:Memory",
    template: "%s | Re:Memory",
  },
  description:
    "写真と確かな根拠から、あとで辿れる記憶をつくるプライベートなメモリーアーカイブ。",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F7F3EA",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          メインコンテンツへ移動
        </a>
        {children}
      </body>
    </html>
  );
}
