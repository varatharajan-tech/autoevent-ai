import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s['next'] === "string" ? s['next'] : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in — AutoEvent AI" }] }),
});

/** Only same-origin relative paths are allowed as a post-login destination. */
function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function AuthPage() {
  const nav = useNavigate();
  const { next } = Route.useSearch();
  const dest = safeNext(next);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  function goNext() {
    if (dest) window.location.href = dest;
    else nav({ to: "/dashboard" });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) goNext();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, dest]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}${dest ?? "/dashboard"}` },
        });
        if (error) throw error;
        toast.success("Welcome aboard!");
        goNext();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        goNext();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + (dest ?? "/dashboard"),
    });
    if (r.error) toast.error("Google sign-in failed");
  }


  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-paper">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-ink text-paper grain relative">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-paper text-ink grid place-items-center"><Sparkles className="size-4" /></div>
          <span className="font-display text-xl">AutoEvent<span className="text-primary">.</span></span>
        </Link>
        <div>
          <h2 className="font-display text-5xl leading-[1.05]">
            "We turned 8 hours of editing into <em className="text-primary not-italic">a single coffee break</em>."
          </h2>
          <p className="mt-6 text-paper/60 text-sm">— StepOne content team</p>
        </div>
        <div className="text-xs text-paper/50 uppercase tracking-[0.2em]">Agentic · Multimodal · Brand-aware</div>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-4xl">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to manage your events." : "Start turning media into posts."}
          </p>

          <Button variant="outline" className="w-full mt-6" onClick={google} type="button">
            <svg className="size-4 mr-2" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1h-9.17v2.96h5.27c-.23 1.5-1.71 4.4-5.27 4.4-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.93 4.27 14.83 3.3 12.18 3.3 6.94 3.3 2.7 7.54 2.7 12.78s4.24 9.48 9.48 9.48c5.47 0 9.09-3.84 9.09-9.25 0-.62-.07-1.1-.16-1.91z"/></svg>
            Continue with Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> OR <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground text-center">
            {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
            <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-primary font-medium hover:underline">
              {mode === "signin" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
