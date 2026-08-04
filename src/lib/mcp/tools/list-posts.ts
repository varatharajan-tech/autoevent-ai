import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_posts",
  title: "List generated posts",
  description: "List AI-generated social posts (caption, hashtags, platform, timing) for one of the user's events.",
  inputSchema: {
    event_id: z.string().uuid().describe("The event id."),
    platform: z.enum(["instagram", "linkedin", "twitter", "facebook"]).optional().describe("Filter by platform."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id, platform }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("generated_posts")
      .select("id,platform,format,caption,hashtags,audience,best_time,predicted_engagement,engagement_score,created_at")
      .eq("event_id", event_id)
      .order("created_at", { ascending: false });
    if (platform) query = query.eq("platform", platform);
    const { data, error } = await query.limit(60);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { posts: data ?? [] },
    };
  },
});
