import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/globals.css";
import Navbar from "@/components/Navbar";
import AudioPlayer from "@/components/AudioPlayer";
import Footer from "@/components/Footer";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";
import QueryProvider from "@/components/QueryProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Podlog",
  description: "Self-hosted podcast transcription and search",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen bg-background`}>
        <QueryProvider>
          <AudioPlayerProvider>
            <Navbar />
            <main className="max-w-5xl mx-auto px-4 py-8 pb-24">
              {children}
            </main>
            <Footer />
            {/* Global persistent player — fixed to bottom, persists across navigation */}
            <AudioPlayer />
          </AudioPlayerProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
