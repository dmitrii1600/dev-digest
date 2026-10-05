/* useSpecDraft — the editing state of the selected spec file: the text in the
   editor, the baseline and version it was loaded at, and Save / Delete / Reload.
   The draft is derived, not synced: until the user types, saves or reloads, the
   effective draft IS the loaded document, so no effect copies server data into
   state. While the text differs from the baseline it registers the app-wide
   leave blocker (AC-9). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ContextConflictDetails, SpecFile } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import {
  conflictOf,
  useDeleteContextFile,
  useSaveContextFile,
} from "@/lib/hooks/project-context";
import { useNavigationGuard } from "@/providers/navigation-guard";
import { isDirty, toLf } from "./helpers";

interface Draft {
  path: string;
  baseline: string;
  version: string | null;
  text: string;
}

export interface SpecDraft {
  text: string;
  dirty: boolean;
  setText: (text: string) => void;
  save: () => void;
  /** Re-send the text against `version` (the conflict's `current_version`; `null` recreates). */
  overwrite: (version: string | null) => void;
  remove: () => void;
  /** Re-read the file from disk and replace the draft; clears the selection if it is gone. */
  reload: () => Promise<void>;
  /** Drop the draft (selection moved away). */
  discard: () => void;
  saving: boolean;
  deleting: boolean;
  saveConflict: ContextConflictDetails | null;
  /** A save failed for a reason other than a version conflict. */
  saveFailed: boolean;
  deleteConflict: ContextConflictDetails | null;
  deleteFailed: boolean;
}

function fromDoc(path: string, doc: SpecFile): Draft {
  const content = doc.content ?? "";
  return { path, baseline: content, version: doc.version ?? null, text: content };
}

export function useSpecDraft({
  repoId,
  path,
  doc,
  refetchDoc,
  onClear,
}: {
  repoId: string;
  path: string | null;
  doc: SpecFile | undefined;
  refetchDoc: () => Promise<{ data?: SpecFile; error: unknown }>;
  /** The open file is gone (deleted, or missing on reload): clear the selection. */
  onClear: () => void;
}): SpecDraft | null {
  const t = useTranslations("context");
  const { setBlocker } = useNavigationGuard();
  const saveMut = useSaveContextFile(repoId);
  const delMut = useDeleteContextFile(repoId);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const effective: Draft | null =
    path && draft?.path === path ? draft : path && doc ? fromDoc(path, doc) : null;
  const dirty = effective ? isDirty(effective.text, effective.baseline) : false;

  const message = dirty && path ? t("confirm.leave", { path }) : null;
  React.useEffect(() => {
    setBlocker(message);
    return () => setBlocker(null);
  }, [message, setBlocker]);

  if (!path || !effective) return null;

  // Only the open file's failure counts; a stale one from another path is ignored.
  const saveError = saveMut.isError && saveMut.variables?.path === path ? saveMut.error : null;
  const delError = delMut.isError && delMut.variables?.path === path ? delMut.error : null;

  const send = (version: string | null) => {
    if (saveMut.isPending) return;
    const sent = effective.text;
    saveMut.mutate(
      { path, content: sent, version },
      {
        onSuccess: (saved) =>
          setDraft((d) => ({
            path,
            baseline: toLf(sent),
            version: saved.version ?? null,
            text: d?.path === path ? d.text : sent,
          })),
      },
    );
  };

  const resetErrors = () => {
    saveMut.reset();
    delMut.reset();
  };

  return {
    text: effective.text,
    dirty,
    setText: (text) => setDraft({ ...effective, text }),
    save: () => send(effective.version),
    overwrite: send,
    remove: () => {
      if (delMut.isPending) return;
      delMut.mutate(
        { path, version: effective.version ?? "" },
        {
          onSuccess: () => {
            setDraft(null);
            onClear();
          },
        },
      );
    },
    reload: async () => {
      const res = await refetchDoc();
      if (res.data && !res.error) {
        setDraft(fromDoc(path, res.data));
        resetErrors();
      } else if (res.error instanceof ApiError && (res.error.status === 404 || res.error.status === 422)) {
        // The server answers 404 for a vanished root file and 422 ("not in the listing") otherwise.
        setDraft(null);
        resetErrors();
        onClear();
      }
    },
    discard: () => {
      setDraft(null);
      resetErrors();
    },
    saving: saveMut.isPending,
    deleting: delMut.isPending,
    saveConflict: conflictOf(saveError),
    saveFailed: !!saveError && !conflictOf(saveError),
    deleteConflict: conflictOf(delError),
    deleteFailed: !!delError && !conflictOf(delError),
  };
}
