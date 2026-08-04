import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_event",
  title: "Get event",
  description: "Get one event with its analyzed assets (top picks first) for the signed-in user.",
  inputSchema: {
    event_id: z.string().uuid().describe("The event id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data: event, error } = await supabase
      .from("events")
      .select("id,name,description,status,audience,brand_color,asset_count,post_count,top_pick_count,created_at")
      .eq("id", event_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!event) return { content: [{ type: "text", text: "Event not found" }], isError: true };

    const { data: assets } = await supabase
      .from("assets")
      .select("id,filename,kind,quality_score,emotion,scene,ai_summary,is_top_pick,analyzed")
      .eq("event_id", event_id)
      .order("is_top_pick", { ascending: false })
      .order("quality_score", { ascending: false, nullsFirst: false })
      .limit(50);

    const payload = { event, assets: assets ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
