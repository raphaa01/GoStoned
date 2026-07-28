"use client";

import { ArrowRight, CheckCircle2, Gamepad2, ListChecks, Search } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/components/i18n/I18nProvider";

export function ReviewGuide() {
  const { user, loading, error, refresh } = useAuth();
  const { dictionary, href } = useI18n();
  const copy = dictionary.review;

  const accountAction = loading ? (
    <span className="button button--primary button--lg content-action-status" role="status">
      {copy.checkingAccount}
    </span>
  ) : error ? (
    <button className="button button--primary button--lg" onClick={() => refresh().catch(() => undefined)} type="button">
      {copy.retryAccount}
    </button>
  ) : (
    <Link
      className="button button--primary button--lg"
      href={href(user ? "/profile#game-history" : "/register")}
    >
      {user ? copy.openGames : copy.saveFuture} <ArrowRight size={19} />
    </Link>
  );

  return (
    <div className="content-page">
      <header className="content-hero">
        <span className="section-kicker">{copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="content-actions">
          {accountAction}
          <Link className="button button--secondary button--lg" href={href("/play")}>
            <Gamepad2 size={19} /> {copy.playAgain}
          </Link>
        </div>
        {error ? <p className="content-auth-error" role="alert">{error}</p> : null}
      </header>

      <section className="content-section" aria-labelledby="review-method">
        <header>
          <h2 id="review-method">{copy.methodTitle}</h2>
          <p>{copy.methodDescription}</p>
        </header>
        <ol className="content-card-grid">
          <li className="content-card">
            <span className="content-card__icon"><Search size={22} /></span>
            <h3>{copy.revisitTitle}</h3>
            <p>{copy.revisitBody}</p>
          </li>
          <li className="content-card">
            <span className="content-card__icon"><ListChecks size={22} /></span>
            <h3>{copy.understandTitle}</h3>
            <p>{copy.understandBody}</p>
          </li>
          <li className="content-card">
            <span className="content-card__icon"><CheckCircle2 size={22} /></span>
            <h3>{copy.practiceTitle}</h3>
            <p>{copy.practiceBody}</p>
          </li>
        </ol>
      </section>

      <section className="content-split content-split--review">
        <article className="content-panel" aria-labelledby="review-questions">
          <h2 id="review-questions">{copy.questionsTitle}</h2>
          <ul className="review-questions">
            <li>{copy.questionOne}</li>
            <li>{copy.questionTwo}</li>
            <li>{copy.questionThree}</li>
          </ul>
        </article>
        <aside className="content-panel content-panel--trust" aria-labelledby="verified-record">
          <span className="content-card__icon"><CheckCircle2 size={22} /></span>
          <h2 id="verified-record">{copy.recordTitle}</h2>
          <p>{copy.recordBody}</p>
        </aside>
      </section>
    </div>
  );
}
