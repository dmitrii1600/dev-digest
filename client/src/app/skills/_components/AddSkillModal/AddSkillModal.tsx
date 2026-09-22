/* AddSkillModal — the one "Add Skill" entry point, opened from the `/skills`
   grid header, its empty state, and the editor rail, so every screen adds a
   skill the same way. A `Modal` with three `Tabs`: Create (hand-typed),
   From file (.md / .zip upload → preview → confirm) and Import from URL
   (fetch → preview → import). Each tab owns its form state and its own
   action row; switching tabs discards that state on purpose — the tabs are
   three different sources, not three steps of one form. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Tabs } from "@devdigest/ui";
import { CreateTab } from "./_components/CreateTab";
import { FileTab } from "./_components/FileTab";
import { UrlTab } from "./_components/UrlTab";
import { ADD_SKILL_TABS, MODAL_WIDTH, type AddSkillTab } from "./constants";
import { s } from "./styles";

export function AddSkillModal({
  onClose,
  initialTab = "create",
}: {
  onClose: () => void;
  initialTab?: AddSkillTab;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<AddSkillTab>(initialTab);

  return (
    <Modal width={MODAL_WIDTH} title={t("drawer.title")} subtitle={t("drawer.subtitle")} onClose={onClose}>
      <Tabs
        tabs={ADD_SKILL_TABS.map((d) => ({ key: d.key, label: t(d.labelKey), icon: d.icon }))}
        value={tab}
        onChange={(k) => setTab(k as AddSkillTab)}
        pad="0 24px"
      />
      <div style={s.body}>
        {tab === "create" && <CreateTab onClose={onClose} />}
        {tab === "file" && <FileTab onClose={onClose} />}
        {tab === "url" && <UrlTab onClose={onClose} />}
      </div>
    </Modal>
  );
}
