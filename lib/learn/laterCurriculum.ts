import type { LearnStage } from "./curriculum";
import { t } from "./laterLessonTools";
import { STAGE_FOUR } from "./stageFour";
import { STAGE_FIVE } from "./stageFive";
import { STAGE_SIX } from "./stageSix";
import { STAGE_SEVEN } from "./stageSeven";
import { STAGE_EIGHT } from "./stageEight";

export const LATER_STAGES: readonly LearnStage[] = [
  { id:4,title:t("Taktischer Werkzeugkasten","Tactical toolkit"),lessons:STAGE_FOUR },
  { id:5,title:t("Gute 9×9-Partien spielen","Playing good 9×9 games"),lessons:STAGE_FIVE },
  { id:6,title:t("Das 13×13-Brett","The 13×13 board"),lessons:STAGE_SIX },
  { id:7,title:t("Das 19×19-Brett","The 19×19 board"),lessons:STAGE_SEVEN },
  { id:8,title:t("Selbstständig weiterlernen","Continuing independently"),lessons:STAGE_EIGHT },
];
