import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Camera, Wand2, Layout, Send, Clock, Check } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "AutoEvent AI — Event photos to ready-to-post content" },
      { name: "description", content: "Drop in raw event media. Get top picks, captions, and branded social posts in minutes — not hours." },
      { property: "og:title", content: "AutoEvent AI — Event photos to ready-to-post content" },
      { property: "og:description", content: "Drop in raw event media. Get top picks, captions, and branded social posts in minutes — not hours." },
      { property: "og:url", content: "https://autoenvent-ai.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://autoenvent-ai.lovable.app/" }],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />

      {/* Hero */}
      <section className="relative grain">
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" /> Agentic content engine
            </span>
            <h1 className="mt-6 font-display text-6xl md:text-8xl leading-[0.95] tracking-tight">
              From <em className="text-primary not-italic">1,000 photos</em><br/>
              to ready-to-post,<br/>in minutes.
            </h1>
            <p className="mt-8 text-lg text-muted-foreground max-w-xl leading-relaxed">
              AutoEvent AI is a multi-agent system that ingests raw event media,
              picks the best moments, writes context-aware captions, and renders
              branded social posts — without a designer in the loop.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link to="/auth">
                <Button size="lg" className="group">
                  Try it free <ArrowRight className="ml-1 size-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <a href="#how"><Button size="lg" variant="outline">See how it works</Button></a>
            </div>
            <div className="mt-12 flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><Clock className="size-4 text-primary" /> 8 hours → 60 seconds</span>
              <span className="flex items-center gap-2"><Check className="size-4 text-primary" /> Brand-consistent output</span>
              <span className="flex items-center gap-2"><Check className="size-4 text-primary" /> Instagram · Story · LinkedIn</span>
            </div>
          </div>
        </div>
      </section>

      {/* Agents */}
      <section id="how" className="border-t border-border/60 bg-cream">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-12">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">The pipeline</p>
              <h2 className="mt-2 font-display text-4xl md:text-5xl">Five agents. One output.</h2>
            </div>
            <p className="max-w-md text-muted-foreground">
              Each agent has one job and reports back to the orchestrator —
              you watch the work happen live.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Camera, title: "Media Agent", body: "Vision-scores every photo for quality, faces, energy, and brand moments." },
              { icon: Wand2, title: "Content Agent", body: "Writes captions and hashtags tuned to platform tone and event context." },
              { icon: Layout, title: "Design Agent", body: "Renders branded posts in your colors — 1:1, 9:16, 16:9, ready to ship." },
              { icon: Send, title: "Output Agent", body: "Packages downloadable assets and copy, sized per platform." },
            ].map((a, i) => (
              <div key={a.title} className="bg-card rounded-xl p-6 shadow-soft border border-border/60 hover:shadow-lift transition-shadow">
                <div className="text-xs text-muted-foreground font-mono">0{i+1}</div>
                <a.icon className="mt-3 size-6 text-primary" />
                <h3 className="mt-4 font-display text-xl">{a.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="font-display text-5xl md:text-6xl tracking-tight">
            Stop editing.<br/><em className="text-primary not-italic">Start publishing.</em>
          </h2>
          <p className="mt-6 text-muted-foreground max-w-xl mx-auto">
            Spin up an event, drop in your media, and let the agents handle the rest.
          </p>
          <Link to="/auth"><Button size="lg" className="mt-10">Start your first event</Button></Link>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} AutoEvent AI · Built for StepOne
      </footer>
    </div>
  );
}
