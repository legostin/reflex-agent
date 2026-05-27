import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DirectoryPicker } from "./_components/directory-picker";
import { homeDir } from "@/lib/server/fs";

export default async function NewRootPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <header className="mb-8">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
          <Link href="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">
          Add a directory
        </h1>
        <p className="text-muted-foreground mt-1">
          Pick the directory you want Reflex to index. After it's registered,
          you can run the initial analysis from the directory page.
        </p>
      </header>
      <DirectoryPicker initialPath={homeDir()} />
    </main>
  );
}
