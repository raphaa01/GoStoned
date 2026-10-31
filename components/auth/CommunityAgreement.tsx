"use client";
import { useId, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { getCommunityCopy } from "@/lib/i18n/community";
import { ModalDialog } from "@/components/ui/ModalDialog";
import { CommunityRules } from "@/components/legal/CommunityRules";
export function CommunityAgreement({ disabled = false }: { disabled?: boolean }) {
  const { locale } = useI18n(); const copy = getCommunityCopy(locale); const title = useId(); const [open, setOpen] = useState(false);
  return <><label className="community-agreement"><input type="checkbox" name="communityRules" required disabled={disabled} />
    <span>{copy.agree}{" "}<button className="community-rules-link" type="button" onClick={() => setOpen(true)}>{copy.rules}</button>.</span>
  </label><ModalDialog open={open} onDismiss={() => setOpen(false)} titleId={title} className="community-rules-dialog">
    <h2 id={title}>{copy.title}</h2><CommunityRules /><button className="button" type="button" onClick={() => setOpen(false)}>{copy.cancel}</button>
  </ModalDialog></>;
}
