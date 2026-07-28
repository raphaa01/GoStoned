"use client";

import { ArrowRight, Grid3X3, ShieldCheck, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";
import { GermanLanguageHint } from "@/components/i18n/LanguageSwitcher";

export function Hero({ suggestGerman = false }: { suggestGerman?: boolean }) {
  const { user } = useAuth();
  const { dictionary, href } = useI18n();
  const copy = dictionary.home;

  return (
    <section className="home-hero">
      <div className="home-hero-copy">
        {suggestGerman ? <GermanLanguageHint /> : null}
        <span className="section-kicker">{copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="hero-actions">
          <Link className="button button--primary button--lg" href={href("/play")}>
            {copy.playOnline} <ArrowRight size={19} />
          </Link>
          <Link className="button button--secondary button--lg" href={href(user ? "/profile" : "/register")}>
            {user ? copy.viewProfile : <><UserRoundPlus size={19} /> {copy.createAccount}</>}
          </Link>
        </div>
        <div className="hero-trust">
          <span><ShieldCheck size={16} /> {copy.serverChecked}</span>
          <span><ShieldCheck size={16} /> {copy.savedGames}</span>
        </div>
      </div>

      <div className="hero-board-choice">
        <header>
          <span><Grid3X3 size={18} /></span>
          <div><strong>{copy.chooseBoard}</strong><small>{copy.chooseBoardDescription}</small></div>
        </header>
        <div className="hero-board-options">
          {([
            { size: 9, label: copy.boardQuick },
            { size: 13, label: copy.boardBalanced },
            { size: 19, label: copy.boardClassic },
          ] as const).map((option) => (
            <Link href={href(`/play?size=${option.size}`)} key={option.size}>
              <strong>{option.size}×{option.size}</strong>
              <span>{option.label}</span>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>
        <ol className="hero-steps">
          <li><span>1</span><div><strong>{copy.choose}</strong><small>{copy.chooseDescription}</small></div></li>
          <li><span>2</span><div><strong>{copy.match}</strong><small>{copy.matchDescription}</small></div></li>
          <li><span>3</span><div><strong>{copy.play}</strong><small>{copy.playDescription}</small></div></li>
        </ol>
      </div>
    </section>
  );
}
