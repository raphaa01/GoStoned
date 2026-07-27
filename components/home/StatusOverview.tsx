"use client";

import { Activity, Database, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";

type HealthState = "checking" | "online" | "offline";

export function StatusOverview() {
  const [backend, setBackend] = useState<HealthState>("checking");
  const [database, setDatabase] = useState<HealthState>("checking");

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      fetch("/api/health").then((response) => {
        if (!response.ok) throw new Error("Backend unavailable");
        return response.json();
      }),
      fetch("/api/db-health").then((response) => {
        if (!response.ok) throw new Error("Database unavailable");
        return response.json();
      }),
    ]).then(([backendResult, databaseResult]) => {
      if (!active) return;
      setBackend(backendResult.status === "fulfilled" ? "online" : "offline");
      setDatabase(databaseResult.status === "fulfilled" ? "online" : "offline");
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="platform-overview" id="stats">
      <div className="section-heading">
        <div>
          <span className="section-kicker">Platform pulse</span>
          <h2>Everything you need to enter the flow.</h2>
        </div>
        <p>Play fast, learn deeply, and keep every game in one calm place.</p>
      </div>

      <div className="overview-grid">
        <Card className="overview-card overview-card--accent">
          <div className="overview-icon"><Users size={22} /></div>
          <span className="overview-label">Players online</span>
          <strong>1,284</strong>
          <small><i /> 12% more this week</small>
        </Card>
        <Card className="overview-card">
          <div className="overview-icon"><Activity size={22} /></div>
          <span className="overview-label">Live games</span>
          <strong>376</strong>
          <small>Across all board sizes</small>
        </Card>
        <Card className="overview-card">
          <div className="overview-icon"><ShieldCheck size={22} /></div>
          <span className="overview-label">Game service</span>
          <strong className="status-value">
            <i className={`status-dot status-dot--${backend}`} />
            {backend === "checking" ? "Checking" : backend === "online" ? "Online" : "Offline"}
          </strong>
          <small>Server-authoritative play</small>
        </Card>
        <Card className="overview-card">
          <div className="overview-icon"><Database size={22} /></div>
          <span className="overview-label">Game archive</span>
          <strong className="status-value">
            <i className={`status-dot status-dot--${database}`} />
            {database === "checking" ? "Checking" : database === "online" ? "Connected" : "Setup needed"}
          </strong>
          <small>PostgreSQL persistence</small>
        </Card>
      </div>
    </section>
  );
}
