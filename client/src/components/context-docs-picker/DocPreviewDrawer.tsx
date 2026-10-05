/* DocPreviewDrawer — read-only preview of one clone document, with the same
   Attach toggle as the row checkbox. Path, kind, "Used by" and tokens come from
   the listing row (no extra request); the body is the Markdown renderer only
   (never raw HTML). The kit Drawer has no Escape handling, so it is added here;
   the picker returns focus to the row's Preview button on close. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import { formatTokenCount } from "@/components/run-cost-badge";
import { useContextFile } from "@/lib/hooks/project-context";
import type { DocRow } from "./helpers";
import { s } from "./styles";

const DRAWER_WIDTH = 560;

/** One token count ("1.2K tokens"), or "—" with an accessible name when unknown. */
export function TokenCount({ tokens }: { tokens: number | null }) {
  const t = useTranslations("context");
  if (tokens === null) {
    return (
      <span role="img" aria-label={t("picker.tokensUnavailable")} style={s.rowTokens}>
        —
      </span>
    );
  }
  return <span style={s.rowTokens}>{t("picker.rowTokens", { tokens: formatTokenCount(tokens) })}</span>;
}

export function DocPreviewDrawer({
  repoId,
  row,
  onToggle,
  onClose,
}: {
  repoId: string;
  row: DocRow;
  onToggle: (path: string, next: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useContextFile(repoId, row.path);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={
        <span className="mono" style={s.drawerPath}>
          {row.path}
        </span>
      }
      subtitle={
        <span style={s.drawerMeta}>
          <Badge color="var(--text-secondary)" style={s.kindBadge}>
            {t(`kind.${row.kind}`)}
          </Badge>
          <span>{t("usedBy", { count: row.usedBy })}</span>
          <TokenCount tokens={row.tokens} />
        </span>
      }
      onClose={onClose}
      footer={
        <Button
          kind={row.attached ? "secondary" : "primary"}
          size="sm"
          icon={row.attached ? "Check" : "Plus"}
          onClick={() => onToggle(row.path, !row.attached)}
        >
          {row.attached ? t("picker.attachedState") : t("picker.attach")}
        </Button>
      }
    >
      {isError ? (
        <ErrorState title={t("previewError")} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <Skeleton height={160} />
      ) : (
        <Markdown>{data.content ?? ""}</Markdown>
      )}
    </Drawer>
  );
}
