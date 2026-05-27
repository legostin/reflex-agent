import { notFound } from "next/navigation";
import { getRoot } from "@/lib/registry";

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await getRoot(id);
  if (!entry) notFound();
  // Per-route screens place the command bar themselves so it lives inside the
  // right column instead of spanning under the sidebar.
  return <div className="flex-1 flex flex-col min-h-0">{children}</div>;
}
