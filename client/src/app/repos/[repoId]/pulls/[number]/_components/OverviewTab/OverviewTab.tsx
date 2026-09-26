"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { BlastRadiusPanel } from "../BlastRadiusPanel";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** PR row uuid — null until the pulls list resolves it. The blast panel
      mounts only once it is set, by which point `GET /pulls/:id` has already
      refreshed `pr_files` for this PR (spec 07). */
  prId: string | null;
  repoFullName: string | null;
  headSha: string;
  /** Repo uuid, for the blast panel's resync button (P3-c). */
  repoId: string;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha, repoId }: OverviewTabProps) {
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
      {prId && (
        <BlastRadiusPanel prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
      )}
    </>
  );
}
