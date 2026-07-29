import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper Graph",
  description: "계층형 연구 논문 라이브러리",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
