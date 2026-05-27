import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "./_components/app-sidebar";
import { listRoots } from "@/lib/registry";

export const metadata: Metadata = {
  title: "Reflex",
  description: "Local-first knowledge base built by an agent.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const roots = await listRoots();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <div className="h-screen flex">
          <AppSidebar initialRoots={roots} />
          <main className="flex-1 min-w-0 flex flex-col">{children}</main>
        </div>
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
