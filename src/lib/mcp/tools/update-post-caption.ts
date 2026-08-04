import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "update_post_caption",
  title: "Update post caption",
  description: "Rewrite the caption and/or hashtags of one generated post owned by the signed-in user.",
  inputSchema: {
    post_id: z.string().uuid().describe("The generated post id."),
    caption: z.string().trim().optional().describe("New caption text."),
    hashtags: z.array(z.string()).optional().describe("Hashtags without the # prefix."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ post_id, caption, hashtags }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    if (caption === undefined && hashtags === undefined) {
      return { content: [{ type: "text", text: "Provide caption and/or hashtags" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const patch: { caption?: string; hashtags?: string[] } = {};
    if (caption !== undefined) patch.caption = caption;
    if (hashtags !== undefined) patch.hashtags = hashtags.map((h) => h.replace(/^#/, "").toLowerCase());
    const { data, error } = await supabase
      .from("generated_posts")
      .update(patch)
      .eq("id", post_id)
      .select("id,platform,caption,hashtags")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Post not found" }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { post: data },
    };
  },
});
