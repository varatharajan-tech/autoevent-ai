import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_reels",
  title: "List rendered reels",
  description: "List reels rendered for one of the user's events, each with a short-lived signed download URL.",
  inputSchema: {
    event_id: z.string().uuid().describe("The event id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("generated_reels")
      .select("id,platform,mood,duration_sec,slide_count,file_size,mime_type,storage_path,created_at")
      .eq("event_id", event_id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const reels = await Promise.all(
      (data ?? []).map(async (reel) => {
        const { data: signed } = await supabase.storage
          .from("generated")
          .createSignedUrl(reel.storage_path, 60 * 60);
        const { storage_path: _omit, ...rest } = reel;
        return { ...rest, download_url: signed?.signedUrl ?? null };
      }),
    );
    return {
      content: [{ type: "text", text: JSON.stringify(reels) }],
      structuredContent: { reels },
    };
  },
});
