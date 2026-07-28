import { Hero } from "@/components/home/Hero";
import { StatusOverview } from "@/components/home/StatusOverview";
import { AppShell } from "@/components/layout/AppShell";

export default function GermanHomePage() {
  return (
    <AppShell>
      <Hero />
      <StatusOverview />
    </AppShell>
  );
}
