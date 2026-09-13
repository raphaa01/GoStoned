import type { ReactNode } from "react";
import type { BusinessAnalyticsReport, BusinessBreakdown } from "@/lib/analytics/businessReport";
import { analyticsAdminCopy as copy } from "@/lib/analytics/adminCopy";
import type { TrafficBreakdown, VercelTrafficReport } from "@/lib/analytics/vercelReport";
import styles from "@/app/(en)/webanalytics/webanalytics.module.css";

const numberFormatter = new Intl.NumberFormat("de-DE");
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

function Metric({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
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

function TrafficTable({ rows, title, country = false }: {
  rows: TrafficBreakdown[];
  title: string;
  country?: boolean;
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? <Empty /> : (
        <div aria-label={title} className={styles.tableScroll} role="region" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">{title}</th><th scope="col">{copy.visitors}</th><th scope="col">{copy.pageviews}</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{country ? countryName(row.label) : row.label}</td>
                  <td>{formatNumber(row.visitors)}</td>
                  <td>{formatNumber(row.pageviews)}</td>
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
    <Panel title={copy.trafficTrend}>
      {report.days.length === 0 ? <Empty /> : (
        <div className={styles.trend}>
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
        <Metric label={copy.totalVisitors} value={report.lifetime.visitors} />
        <Metric label={copy.totalPageviews} value={report.lifetime.pageviews} />
      </div>
      <TrafficTrend report={report} />
      <div className={styles.panelGrid}>
        <TrafficTable country rows={report.countries} title={copy.countries} />
        <TrafficTable rows={report.pages} title={copy.pages} />
        <TrafficTable rows={report.referrers} title={copy.referrers} />
        <TrafficTable rows={report.devices} title={copy.devices} />
        <TrafficTable rows={report.browsers} title={copy.browsers} />
        <TrafficTable rows={report.operatingSystems} title={copy.operatingSystems} />
      </div>
    </>
  );
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

export function AnalyticsDashboard({
  business,
  generatedAt,
  traffic,
}: {
  business: BusinessAnalyticsReport | null;
  generatedAt: string;
  traffic: VercelTrafficReport | null;
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
        {traffic ? <TrafficContent report={traffic} /> : <p className={styles.unavailable}>{copy.unavailable}</p>}
      </section>

      <section className={styles.reportSection}>
        <header><h2>{copy.business}</h2><p>{copy.businessWindow}</p></header>
        {business ? <BusinessContent report={business} /> : <p className={styles.unavailable}>{copy.unavailable}</p>}
      </section>
    </div>
  );
}
