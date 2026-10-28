import { Geist, Geist_Mono } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import { cn } from "@/lib/cn";

// The landing page has its own type (one family, and its mono for code and figures); the docs keep theirs.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <div className={cn(geist.variable, geistMono.variable, "flex flex-1 flex-col bg-lp-bg font-lp text-lp-ink")}>
      <a
        href="#main"
        className="lp-focus fixed top-4 left-4 z-[60] -translate-y-20 rounded-lg bg-lp-ink px-4 py-2 text-sm font-semibold text-lp-bg focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteNav />
      {children}
    </div>
  );
}
