import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creater AI Dashboard",
  description: "Personal AI Assistant - Local First Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 antialiased">
        {children}
      </body>
    </html>
  );
}
