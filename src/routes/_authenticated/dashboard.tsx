import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Image as ImageIcon, Calendar, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DeleteEventDialog } from "@/components/DeleteEventDialog";


export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

type Event = {
  id: string; name: string; description: string | null; status: string;
  asset_count: number; post_count: number; brand_color: string; created_at: string;
};

function Dashboard() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("#c2410c");
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Event | null>(null);


  // Auth guard handled by _authenticated layout

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("events").select("*").order("created_at", { ascending: false });
      setEvents((data ?? []) as Event[]);
    };
    load();
    const ch = supabase.channel("events-rt").on("postgres_changes",
      { event: "*", schema: "public", table: "events" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase.from("events").insert({
      user_id: user.id, name, description: desc || null, brand_color: color,
    }).select().single();
    setCreating(false);
    if (error) { console.error("[dashboard] create event failed", error); toast.error("Couldn't create event. Please try again."); return; }
    setOpen(false); setName(""); setDesc("");
    nav({ to: "/events/$id", params: { id: data.id } });
  }

  if (loading || !user) return <div className="min-h-screen bg-paper" />;

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Your workspace</p>
            <h1 className="font-display text-5xl mt-2">Events</h1>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="lg"><Plus className="size-4 mr-1" /> New event</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display text-2xl">New event</DialogTitle></DialogHeader>
              <form onSubmit={createEvent} className="space-y-4">
                <div><Label>Event name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand activation — Mumbai" className="mt-1" /></div>
                <div><Label>Description</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Audience, tone, key moments…" className="mt-1" rows={3} /></div>
                <div>
                  <Label>Brand color</Label>
                  <div className="flex gap-2 mt-1 items-center">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="size-10 rounded-md border border-border cursor-pointer" />
                    <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono" />
                  </div>
                </div>
                <Button type="submit" disabled={creating} className="w-full">{creating ? "Creating…" : "Create event"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {events.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-2xl p-16 text-center bg-cream/50">
            <Calendar className="size-10 mx-auto text-muted-foreground" />
            <h3 className="font-display text-2xl mt-4">No events yet</h3>
            <p className="text-muted-foreground mt-2">Create your first event to start uploading media.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((ev) => (
              <div key={ev.id} className="relative group">
                <button
                  type="button"
                  aria-label={`Delete ${ev.name}`}
                  onClick={() => setToDelete(ev)}
                  className="absolute top-3 right-3 z-10 rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
                >
                  <Trash2 className="size-4" />
                </button>
                <Link to="/events/$id" params={{ id: ev.id }}
                  className="block bg-card border border-border/60 rounded-xl p-6 shadow-soft hover:shadow-lift transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="size-3 rounded-full" style={{ background: ev.brand_color }} />
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground capitalize group-hover:opacity-0 transition-opacity">{ev.status}</span>
                  </div>
                  <h3 className="font-display text-2xl mt-4 line-clamp-1">{ev.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2 min-h-[2.5rem]">{ev.description || "No description"}</p>
                  <div className="mt-6 pt-4 border-t border-border/60 flex justify-between text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground"><ImageIcon className="size-3.5" /> {ev.asset_count} assets</span>
                    <span className="text-primary font-medium flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">Open <ArrowRight className="size-3.5" /></span>
                  </div>
                </Link>
              </div>
            ))}

          </div>
        )}
      </main>
    </div>
  );
}
