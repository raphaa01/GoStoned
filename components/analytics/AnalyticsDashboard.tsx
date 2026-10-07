import type { ReactNode } from "react";
import Link from "next/link";
import type { EngagementReport } from "@/lib/analytics/engagement";
import { ENGAGEMENT_PERIODS, TRAFFIC_PERIODS, type EngagementPeriod, type TrafficPeriod } from "@/lib/analytics/trafficOptions";
import type { PriceSurveyReport, ReviewAnalyticsReport } from "@/lib/analytics/reviewReport";
import type { BusinessAnalyticsReport, BusinessBreakdown } from "@/lib/analytics/businessReport";
import { analyticsAdminCopy as copy } from "@/lib/analytics/adminCopy";
import type { TrafficBreakdown, VercelTrafficReport } from "@/lib/analytics/vercelReport";
import styles from "@/app/(en)/webanalytics/webanalytics.module.css";

const numberFormatter = new Intl.NumberFormat("de-DE");
const priceFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});
const dayFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const regionNames = new Intl.DisplayNames(["de"], { type: "region" });

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function formatDay(value: string): string {
  return dayFormatter.format(new Date(value));
}

function countryName(code: string): string {
  try {
    return code.length === 2 ? regionNames.of(code.toUpperCase()) ?? code : code;
  } catch {
    return code;
  }
}

function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className={styles.panel}>
      <header><h2>{title}</h2></header>
      {children}
    </section>
  );
}

function Empty() {
  return <p className={styles.empty}>{copy.noData}</p>;
}

function TrafficTable({ rows, title, country = false, total }: {
  rows: TrafficBreakdown[];
  title: string;
  country?: boolean;
  total: number;
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? <Empty /> : (
        <div aria-label={title} className={styles.tableScroll} role="region" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">{title}</th><th scope="col">{copy.visitors}</th><th scope="col">{copy.pageviews}</th><th scope="col">{copy.share}</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{country ? countryName(row.label) : row.label}</td>
                  <td>{formatNumber(row.visitors)}</td>
                  <td>{formatNumber(row.pageviews)}</td>
                  <td>{total > 0 ? `${numberFormatter.format(Math.round(row.pageviews / total * 1000) / 10)} %` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function BusinessBreakdownTable({ rows, title }: { rows: BusinessBreakdown[]; title: string }) {
  return (
    <div className={styles.breakdownGroup}>
      <h3>{title}</h3>
      {rows.length === 0 ? <Empty /> : (
        <dl>
          {rows.map((row) => (
            <div key={row.label}><dt>{row.label}</dt><dd>{formatNumber(row.count)}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );
}

function TrafficTrend({ report }: { report: VercelTrafficReport }) {
  const maximum = Math.max(1, ...report.days.map((day) => day.pageviews));
  return (
    <Panel title={`${copy.trend} · ${report.period} ${report.period === 1 ? copy.day : copy.days}`}>
      {report.days.length === 0 ? <Empty /> : (
        <div className={styles.trend} style={{ gridTemplateColumns: `repeat(${report.days.length}, minmax(9px, 1fr))` }}>
          {report.days.map((day) => (
            <div className={styles.trendDay} key={day.date} title={`${formatDay(day.date)}: ${day.pageviews} ${copy.pageviews}`}>
              <span style={{ height: `${Math.max(3, (day.pageviews / maximum) * 100)}%` }} />
              <small>{formatDay(day.date)}</small>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function BusinessTrend({ report }: { report: BusinessAnalyticsReport }) {
  return (
    <Panel title={copy.businessTrend}>
      <div aria-label={copy.businessTrend} className={styles.tableScroll} role="region" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">{copy.date}</th><th scope="col">{copy.registrations}</th><th scope="col">{copy.games}</th><th scope="col">{copy.finished}</th></tr></thead>
          <tbody>
            {report.days.map((day) => (
              <tr key={day.date}>
                <td>{formatDay(day.date)}</td>
                <td>{formatNumber(day.accounts)}</td>
                <td>{formatNumber(day.games)}</td>
                <td>{formatNumber(day.finishedGames)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TrafficContent({ report }: { report: VercelTrafficReport }) {
  return (
    <>
      <div className={styles.metrics}>
        <Metric label={copy.periodVisitors} value={report.totals.visitors} />
        <Metric label={copy.periodPageviews} value={report.totals.pageviews} />
        <Metric label={copy.viewsPerVisitor} value={report.totals.visitors ? numberFormatter.format(Math.round(report.totals.pageviews / report.totals.visitors * 10) / 10) : "—"} />
        <Metric label={copy.totalVisitors} value={report.lifetime.visitors} />
        <Metric label={copy.totalPageviews} value={report.lifetime.pageviews} />
      </div>
      <p className={styles.note}>{copy.visitorsNote}</p>
      <TrafficTrend report={report} />
      <div className={styles.panelGrid}>
        <TrafficTable total={report.totals.pageviews} country rows={report.countries} title={copy.countries} />
        <TrafficTable total={report.totals.pageviews} rows={report.pages} title={copy.pages} />
        <TrafficTable total={report.totals.pageviews} rows={report.referrers} title={copy.referrers} />
        <TrafficTable total={report.totals.pageviews} rows={report.devices} title={copy.devices} />
        <TrafficTable total={report.totals.pageviews} rows={report.browsers} title={copy.browsers} />
        <TrafficTable total={report.totals.pageviews} rows={report.operatingSystems} title={copy.operatingSystems} />
        <TrafficTable total={report.totals.pageviews} rows={report.routes} title={copy.routes} />
      </div>
      <p className={styles.note}>{copy.vercelLimitations}</p>
    </>
  );
}

function duration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function EngagementContent({ report }: { report: EngagementReport }) {
  return <>
    <div className={styles.metrics}>
      <Metric label={copy.averageTime} value={report.views ? duration(report.milliseconds / report.views) : "—"} />
      <Metric label={copy.visibleTime} value={duration(report.milliseconds)} />
      <Metric label={copy.measuredViews} value={report.views} />
    </div>
    <Panel title={copy.pages}>
      {report.pages.length === 0 ? <Empty /> : <div className={styles.tableScroll} role="region" aria-label={copy.engagement} tabIndex={0}>
        <table>
          <thead><tr><th scope="col">{copy.pages}</th><th scope="col">{copy.measuredViews}</th><th scope="col">{copy.visibleTime}</th><th scope="col">{copy.averageTime}</th></tr></thead>
          <tbody>{report.pages.map((row) => <tr key={row.path}>
            <td>{row.path}</td><td>{formatNumber(row.views)}</td><td>{duration(row.milliseconds)}</td><td>{row.views ? duration(row.milliseconds / row.views) : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </Panel>
  </>;
}

function BusinessContent({ report }: { report: BusinessAnalyticsReport }) {
  const summary = report.summary;
  return (
    <>
      <div className={styles.metrics}>
        <Metric label={copy.accountsTotal} value={summary.accountsTotal} />
        <Metric label={copy.accountsToday} value={summary.accountsToday} />
        <Metric label={copy.accounts7d} value={summary.accounts7d} />
        <Metric label={copy.accounts30d} value={summary.accounts30d} />
        <Metric label={copy.gamesTotal} value={summary.gamesTotal} />
        <Metric label={copy.gamesToday} value={summary.gamesToday} />
        <Metric label={copy.games7d} value={summary.games7d} />
        <Metric label={copy.games30d} value={summary.games30d} />
        <Metric label={copy.activeGames} value={summary.gamesActive} />
        <Metric label={copy.finishedGames} value={summary.gamesFinished} />
        <Metric label={copy.movesTotal} value={summary.movesTotal} />
      </div>
      <BusinessTrend report={report} />
      <Panel title={copy.breakdown30d}>
        <div className={styles.breakdownGrid}>
          <BusinessBreakdownTable rows={report.boardSizes} title={copy.boardSizes} />
          <BusinessBreakdownTable rows={report.timeControls} title={copy.timeControls} />
          <BusinessBreakdownTable rows={report.gameTypes} title={copy.gameTypes} />
          <BusinessBreakdownTable rows={report.rules} title={copy.rules} />
        </div>
      </Panel>
      <div className={styles.panelGrid}>
        <Panel title={copy.recentAccounts}>
          {report.recentAccounts.length === 0 ? <Empty /> : (
            <div aria-label={copy.recentAccounts} className={styles.tableScroll} role="region" tabIndex={0}>
              <table>
                <thead><tr><th scope="col">{copy.account}</th><th scope="col">{copy.created}</th><th scope="col">{copy.games}</th><th scope="col">{copy.lastGame}</th></tr></thead>
                <tbody>
                  {report.recentAccounts.map((account) => (
                    <tr key={account.username}>
                      <td>{account.username}</td><td>{formatDate(account.createdAt)}</td>
                      <td>{formatNumber(account.games)}</td>
                      <td>{account.lastGameAt ? formatDate(account.lastGameAt) : copy.never}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title={copy.recentGames}>
          {report.recentGames.length === 0 ? <Empty /> : (
            <div aria-label={copy.recentGames} className={styles.tableScroll} role="region" tabIndex={0}>
              <table>
                <thead><tr><th scope="col">{copy.created}</th><th scope="col">{copy.players}</th><th scope="col">{copy.details}</th><th scope="col">{copy.moves}</th><th scope="col">{copy.status}</th></tr></thead>
                <tbody>
                  {report.recentGames.map((game) => (
                    <tr key={game.id}>
                      <td>{formatDate(game.startedAt)}</td>
                      <td>{game.blackName} {copy.versus} {game.whiteName}</td>
                      <td>{game.boardSize}×{game.boardSize} · {game.timeControl} · {game.rules} · {game.gameType}</td>
                      <td>{formatNumber(game.moves)}</td>
                      <td>{game.status === "active" ? copy.active : copy.complete}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function reviewStatus(status: string) {
  return status === "queued" ? copy.reviewStatusQueued : status === "running" ? copy.reviewStatusRunning
    : status === "completed" ? copy.reviewStatusCompleted : status === "failed" ? copy.reviewStatusFailed : status;
}

function ReviewContent({ report }: { report: ReviewAnalyticsReport }) {
  const summary = report.summary;
  return <>
    <div className={styles.metrics}>
      <Metric label={copy.reviewRequests} value={summary.requests} />
      <Metric label={copy.reviewStarted} value={summary.started} />
      <Metric label={copy.reviewCompleted} value={summary.completed} />
      <Metric label={copy.reviewFailed} value={summary.failed} />
      <Metric label={copy.reviewRequesters} value={summary.requesters} />
      <Metric label={copy.reviewTotal} value={summary.totalRequests} />
      <Metric label={copy.reviewTotalStarted} value={summary.totalStarted} />
      <Metric label={copy.reviewQueued} value={summary.queued} />
      <Metric label={copy.reviewRunning} value={summary.running} />
    </div>
    <Panel title={copy.reviewTrend}>
      <div aria-label={copy.reviewTrend} className={styles.tableScroll} role="region" tabIndex={0}>
        <table><thead><tr><th scope="col">{copy.date}</th><th scope="col">{copy.reviewRequestedAt}</th><th scope="col">{copy.reviewStartedAt}</th><th scope="col">{copy.reviewCompletedAt}</th></tr></thead>
          <tbody>{report.days.map((day) => <tr key={day.date}><td>{formatDay(day.date)}</td><td>{formatNumber(day.requests)}</td><td>{formatNumber(day.started)}</td><td>{formatNumber(day.completed)}</td></tr>)}</tbody>
        </table>
      </div>
    </Panel>
    <Panel title={copy.recentReviews}>
      {report.recent.length === 0 ? <Empty /> : <div aria-label={copy.recentReviews} className={styles.tableScroll} role="region" tabIndex={0}>
        <table><thead><tr><th scope="col">{copy.reviewJob}</th><th scope="col">{copy.reviewRequestedAt}</th><th scope="col">{copy.reviewStartedAt}</th><th scope="col">{copy.reviewCompletedAt}</th><th scope="col">{copy.status}</th><th scope="col">{copy.reviewAttempts}</th></tr></thead>
          <tbody>{report.recent.map((job) => <tr key={job.id}><td>{job.id}</td><td>{formatDate(job.requestedAt)}</td><td>{job.startedAt ? formatDate(job.startedAt) : "—"}</td><td>{job.completedAt ? formatDate(job.completedAt) : "—"}</td><td>{reviewStatus(job.status)}</td><td>{formatNumber(job.attempts)}</td></tr>)}</tbody>
        </table>
      </div>}
    </Panel>
    <p className={styles.note}>{copy.reviewHistoryNote}</p>
  </>;
}

function SurveyContent({ report }: { report: PriceSurveyReport }) {
  return <>
    <div className={styles.metrics}>
      <Metric label={copy.surveyVoters} value={report.voters} />
      <Metric label={copy.surveyParticipation} value={report.accounts ? `${numberFormatter.format(Math.round(report.voters / report.accounts * 1000) / 10)} %` : "—"} detail={copy.surveyParticipationNote} />
      <Metric label={copy.surveyNewVoters} value={report.newVoters} />
      <Metric label={copy.surveyUpdatedVotes} value={report.updatedVotes} />
      <Metric label={copy.surveyAverage} value={report.averagePrice === null ? "—" : priceFormatter.format(report.averagePrice)} />
    </div>
    <Panel title={copy.surveyDistribution}>
      <div aria-label={copy.surveyDistribution} className={styles.tableScroll} role="region" tabIndex={0}>
        <table><thead><tr><th scope="col">{copy.surveyMonthlyPrice}</th><th scope="col">{copy.surveyVotes}</th><th scope="col">{copy.surveyShare}</th></tr></thead>
          <tbody>{report.options.map((option) => <tr key={option.euros}><td>{priceFormatter.format(option.euros)}</td><td>{formatNumber(option.voters)}</td><td>{report.voters ? `${numberFormatter.format(Math.round(option.voters / report.voters * 1000) / 10)} %` : "—"}</td></tr>)}</tbody>
        </table>
      </div>
    </Panel>
    <Panel title={copy.surveyRecent}>
      {report.recent.length === 0 ? <Empty /> : <div aria-label={copy.surveyRecent} className={styles.tableScroll} role="region" tabIndex={0}>
        <table><thead><tr><th scope="col">{copy.surveyMonthlyPrice}</th><th scope="col">{copy.surveyCreatedAt}</th><th scope="col">{copy.surveyUpdatedAt}</th></tr></thead>
          <tbody>{report.recent.map((vote, index) => <tr key={`${vote.updatedAt}:${index}`}><td>{priceFormatter.format(vote.euros)}</td><td>{formatDate(vote.createdAt)}</td><td>{formatDate(vote.updatedAt)}</td></tr>)}</tbody>
        </table>
      </div>}
    </Panel>
  </>;
}

export function AnalyticsDashboard({
  engagement,
  engagementPeriod,
  period,
  business,
  generatedAt,
  traffic,
  reviews,
  survey,
}: {
  engagement: EngagementReport | null;
  engagementPeriod: EngagementPeriod;
  period: TrafficPeriod;
  business: BusinessAnalyticsReport | null;
  generatedAt: string;
  traffic: VercelTrafficReport | null;
  reviews: ReviewAnalyticsReport | null;
  survey: PriceSurveyReport | null;
}) {
  return (
    <div className={styles.dashboard}>
      <header className={styles.hero}>
        <p>{copy.kicker}</p>
        <h1>{copy.title}</h1>
        <span>{copy.intro}</span>
        <div><small>{copy.protected}</small><small>{copy.generated}: {formatDate(generatedAt)}</small></div>
      </header>

      <aside className={styles.privacy}>
        <strong>{copy.privacyTitle}</strong><p>{copy.privacyText}</p>
      </aside>

      <section className={styles.reportSection}>
        <header><h2>{copy.traffic}</h2><p>{copy.trafficWindow}</p></header>
        <nav aria-label={copy.period} className={styles.periods}>
          {TRAFFIC_PERIODS.map((days) => <Link key={days} prefetch={false} href={`/webanalytics?period=${days}&engagement=${engagementPeriod}`} aria-current={period === days ? "page" : undefined}>
            {days === 1 ? copy.today : `${days} ${copy.days}`}
          </Link>)}
          <a href={`/webanalytics?period=${period}&engagement=${engagementPeriod}`}>{copy.refresh}</a>
        </nav>
        {traffic ? <TrafficContent report={traffic} /> : <p className={styles.unavailable}>{copy.trafficUnavailable}</p>}
      </section>

      <section className={styles.reportSection}>
        <header><h2>{copy.engagement}</h2><p>{copy.engagementNote}</p></header>
        <p className={styles.note}>{copy.engagementWindow}</p>
        <nav aria-label={copy.engagementPeriod} className={styles.periods}>
          {ENGAGEMENT_PERIODS.map((days) => <Link key={days} prefetch={false} href={`/webanalytics?period=${period}&engagement=${days}`} aria-current={engagementPeriod === days ? "page" : undefined}>
            {days === "all" ? copy.allTime : days === 1 ? copy.today : `${days} ${copy.days}`}
          </Link>)}
        </nav>
        {engagement ? <EngagementContent report={engagement} /> : <p className={styles.unavailable}>{copy.unavailable}</p>}
      </section>

      <section className={styles.reportSection}>
        <header><h2>{copy.reviews}</h2><p>{copy.reviewsNote}</p></header>
        <p className={styles.note}>{copy.reportPeriod}: {period === 1 ? copy.today : `${period} ${copy.days}`}.</p>
        {reviews ? <ReviewContent report={reviews} /> : <p className={styles.unavailable}>{copy.unavailable}</p>}
      </section>

      <section className={styles.reportSection}>
        <header><h2>{copy.survey}</h2><p>{copy.surveyNote}</p></header>
        <p className={styles.note}>{copy.reportPeriod}: {period === 1 ? copy.today : `${period} ${copy.days}`}.</p>
        {survey ? <SurveyContent report={survey} /> : <p className={styles.unavailable}>{copy.unavailable}</p>}
      </section>

      <section className={styles.reportSection}>
        <header><h2>{copy.business}</h2><p>{copy.businessWindow}</p></header>
        {business ? <BusinessContent report={business} /> : <p className={styles.unavailable}>{copy.unavailable}</p>}
      </section>
    </div>
  );
}
