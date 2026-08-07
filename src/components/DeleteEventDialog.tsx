import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  eventId: string;
  eventName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

async function removeAll(bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) console.error(`[delete-event] storage remove failed (${bucket})`, error);
  }
}

export function DeleteEventDialog({ eventId, eventName, open, onOpenChange, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const [assetsRes, reelsRes] = await Promise.all([
        supabase.from("assets").select("storage_path").eq("event_id", eventId),
        supabase.from("generated_reels").select("storage_path").eq("event_id", eventId),
      ]);
      const assetPaths = (assetsRes.data ?? []).map((a) => a.storage_path).filter(Boolean);
      const reelPaths = (reelsRes.data ?? []).map((r) => r.storage_path).filter(Boolean);
      await Promise.all([
        assetPaths.length ? removeAll("event-media", assetPaths) : Promise.resolve(),
        reelPaths.length ? removeAll("generated", reelPaths) : Promise.resolve(),
      ]);

      const { error } = await supabase.from("events").delete().eq("id", eventId);
      if (error) throw error;

      toast.success("Event deleted");
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      console.error("[delete-event] failed", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!deleting) onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">Delete “{eventName}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the event along with all uploaded media, generated posts and rendered reels. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); void handleDelete(); }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete event"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
