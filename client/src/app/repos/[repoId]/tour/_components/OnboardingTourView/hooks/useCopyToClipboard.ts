"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/providers/toast";

/** Copy text and toast the outcome (AC-11, AC-14, EC-10). Resolves `false` when
 *  the clipboard is missing or the write is rejected. */
export function useCopyToClipboard() {
  const t = useTranslations("onboarding");
  const toast = useToast();

  return React.useCallback(
    async (text: string, kind: "link" | "command"): Promise<boolean> => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(text);
        toast.success(t(kind === "link" ? "linkCopied" : "commandCopied"));
        return true;
      } catch {
        toast.error(t("copyFailed"));
        return false;
      }
    },
    [t, toast],
  );
}
