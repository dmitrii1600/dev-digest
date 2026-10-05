"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
import { BlastRadiusPanel } from "../BlastRadiusPanel";
import { IntentCard } from "./_components/IntentCard";
import { PrBrief } from "./_components/PrBrief";
import { shownBrief } from "./_components/PrBrief/helpers";
import { RiskAreas } from "./_components/RiskAreas";
import { ReviewFocus } from "./_components/ReviewFocus";
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
  /** Jump to a `file[:line]` ref in Files changed (risk pills, review focus). */
  onJump: (ref: string) => void;
}

export function OverviewTab({ prId, prBody, repoFullName, headSha, repoId, onJump }: OverviewTabProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);
  const mutation = useGenerateBrief(prId ?? "_");
  const { data: reviews } = usePrReviews(prId);

  // Risk areas and Review focus are the brief's own body: never shown while it
  // is (re)generating (the skeleton owns that spot); the rule lives in `shownBrief`.
  const brief = shownBrief({ data, mutation });

  return (
    <>
      <PrBrief data={data} isLoading={isLoading} mutation={mutation} reviews={reviews} />

      <div style={s.topRow}>
        <div style={s.leftCol}>
          <IntentCard prId={prId} />
          {brief && (
            <section>
              <SectionLabel icon="AlertTriangle">{t("block.risks")}</SectionLabel>
              <RiskAreas risks={brief.risks} onJump={onJump} />
            </section>
          )}
        </div>
        {prId && (
          <BlastRadiusPanel prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
        )}
      </div>

      {brief && <ReviewFocus items={brief.review_focus} onJump={onJump} />}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
