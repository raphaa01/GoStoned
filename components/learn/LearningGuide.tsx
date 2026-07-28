"use client";

import { ArrowRight, CircleDot, Grid3X3, Link2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";

export function LearningGuide() {
  const { dictionary, href } = useI18n();
  const copy = dictionary.learn;

  return (
    <div className="content-page">
      <header className="content-hero">
        <span className="section-kicker">{copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="content-actions">
          <Link className="button button--primary button--lg" href={href("/play?size=9")}>
            {copy.startNine} <ArrowRight size={19} />
          </Link>
          <Link className="button button--secondary button--lg" href={href("/play")}>
            {copy.chooseBoard}
          </Link>
        </div>
      </header>

      <section className="content-section" aria-labelledby="learn-foundations">
        <header>
          <h2 id="learn-foundations">{copy.foundationsTitle}</h2>
          <p>{copy.foundationsDescription}</p>
        </header>
        <ol className="content-card-grid">
          <li className="content-card">
            <span className="content-card__icon"><CircleDot size={22} /></span>
            <h3>{copy.libertiesTitle}</h3>
            <p>{copy.libertiesBody}</p>
          </li>
          <li className="content-card">
            <span className="content-card__icon"><Link2 size={22} /></span>
            <h3>{copy.lifeTitle}</h3>
            <p>{copy.lifeBody}</p>
          </li>
          <li className="content-card">
            <span className="content-card__icon"><ShieldCheck size={22} /></span>
            <h3>{copy.endingTitle}</h3>
            <p>{copy.endingBody}</p>
          </li>
        </ol>
      </section>

      <section className="content-split">
        <article className="content-panel" aria-labelledby="first-game-plan">
          <span className="content-card__icon"><Grid3X3 size={22} /></span>
          <h2 id="first-game-plan">{copy.firstGameTitle}</h2>
          <ol className="content-steps">
            <li><strong>{copy.firstStepTitle}</strong><span>{copy.firstStepBody}</span></li>
            <li><strong>{copy.secondStepTitle}</strong><span>{copy.secondStepBody}</span></li>
            <li><strong>{copy.thirdStepTitle}</strong><span>{copy.thirdStepBody}</span></li>
          </ol>
        </article>

        <article className="content-panel" aria-labelledby="go-glossary">
          <h2 id="go-glossary">{copy.glossaryTitle}</h2>
          <p>{copy.glossaryDescription}</p>
          <div className="content-glossary">
            <details><summary>{copy.libertyTerm}</summary><p>{copy.libertyDefinition}</p></details>
            <details><summary>{copy.atariTerm}</summary><p>{copy.atariDefinition}</p></details>
            <details><summary>{copy.territoryTerm}</summary><p>{copy.territoryDefinition}</p></details>
            <details><summary>{copy.koTerm}</summary><p>{copy.koDefinition}</p></details>
            <details><summary>{copy.komiTerm}</summary><p>{copy.komiDefinition}</p></details>
          </div>
        </article>
      </section>
    </div>
  );
}
