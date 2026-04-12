import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/globals.css";
import Navbar from "@/components/Navbar";
import AudioPlayer from "@/components/AudioPlayer";
import MainContent from "@/components/MainContent";
import Footer from "@/components/Footer";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";
import QueryProvider from "@/components/QueryProvider";


const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Podlog",
  description: "Self-hosted podcast transcription and search",
  icons: {
    icon: "/brand/podlog-favicon.png",
    shortcut: "/brand/podlog-favicon.png",
    apple: "/brand/podlog-favicon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen bg-background flex flex-col`}>
        <QueryProvider>
          <AudioPlayerProvider>
            <Navbar />
            <MainContent>
              {children}
            </MainContent>
            <Footer />
            {/* Global persistent player — fixed to bottom, persists across navigation */}
            <AudioPlayer />
          </AudioPlayerProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
