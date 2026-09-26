"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { BlastRadiusPanel } from "../BlastRadiusPanel";
import { IntentCard } from "./_components/IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  /** PR row uuid — null until the pulls list resolves it. The intent card
      and the blast panel both key off it; the blast panel mounts only once it
      is set, by which point `GET /pulls/:id` has already refreshed `pr_files`
      for this PR (spec 09). */
  prId: string | null;
  prBody: string | null | undefined;
  repoFullName: string | null;
  headSha: string;
  /** Repo uuid, for the blast panel's resync button (P3-c). */
  repoId: string;
}

export function OverviewTab({ prId, prBody, repoFullName, headSha, repoId }: OverviewTabProps) {
  return (
    <>
      <div style={s.topRow}>
        <IntentCard prId={prId} />
        {prId && (
          <BlastRadiusPanel prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
        )}
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
