import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { ToastProvider } from "@/app/components/toast/toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NRAIAlgo",
  description: "Multi-tenant algorithmic trading platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Apply the saved palette before paint; only a fixed allowlisted value
            is written. The server cannot read browser-local preferences. */}
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('nraialgo-theme')==='light'?'light':'dark'}catch{}` }} />
        {/* Material Symbols is an icon font, not a text typeface --
            next/font doesn't cover variable icon fonts like this, so
            it's loaded the same way the reference design does: a
            plain stylesheet link. The no-page-custom-font rule is
            written for the Pages Router's per-page _document.js; the
            App Router's single root layout (this file) is the actual
            equivalent "loaded once for the whole app" location. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
