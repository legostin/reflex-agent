"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InsertImageModal } from "./insert-image-modal";

interface Props {
  rootId: string;
  /**
   * If provided, the user lands on the freshly-created KB entry after
   * insert (when they ticked "Save to KB"). Otherwise we stay put and
   * the toast carries the relPath.
   */
  redirectToKb?: boolean;
}

/**
 * Header button that opens the InsertImageModal. Wired wherever a KB
 * surface needs an "Add picture" affordance — the KB viewer page is
 * the obvious first home.
 */
export function InsertImageButton({ rootId, redirectToKb = true }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useTranslations("app");
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <ImageIcon className="mr-1 h-4 w-4" /> {t("images.button")}
      </Button>
      <InsertImageModal
        rootId={rootId}
        open={open}
        onOpenChange={setOpen}
        onInsert={({ kbRelPath }) => {
          if (redirectToKb && kbRelPath) {
            const slug = kbRelPath
              .split("/")
              .map(encodeURIComponent)
              .join("/");
            router.push(`/roots/${rootId}/kb/${slug}`);
          }
        }}
      />
    </>
  );
}
