import type { Metadata } from "next";
import { Vazirmatn, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const vazir = Vazirmatn({
  variable: "--font-vazir",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "نئوتنیس مارکوف کوانت v7.0 | NeoTennis Live-Odds 3-Line Edition",
  description:
    "ترمینال کمّی مهندسی تنیس حرفه‌ای ATP/WTA — رادار سه‌بعدی چشم شاهین، زنجیره مارکوف ۴ لایه، مهندسی معکوس ضرایب، سوپروایزر ۳ الگویی با سهمیه تایید ۶۵٪ و کارنامه SHA-256 در سطح مسابقه",
  keywords: [
    "tennis",
    "ATP",
    "WTA",
    "Markov chain",
    "quant",
    "hawk-eye",
    "aineobet",
    "نئوتنیس",
  ],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <body
        className={`${vazir.variable} ${geistMono.variable} antialiased bg-background text-foreground font-[family-name:var(--font-vazir)]`}
      >
        <TooltipProvider delayDuration={200}>
          {children}
        </TooltipProvider>
        <Toaster />
        <SonnerToaster position="bottom-left" richColors closeButton />
      </body>
    </html>
  );
}
