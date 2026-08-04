import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_event",
  title: "Create event",
  description: "Create a new event for the signed-in user. Media is uploaded in the app afterwards.",
  inputSchema: {
    name: z.string().trim().min(1).describe("Event name."),
    description: z.string().trim().optional().describe("Short description of the event."),
    brand_color: z.string().trim().optional().describe("Hex brand color, e.g. #7C3AED."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ name, description, brand_color }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const userId = ctx.getUserId();
    if (!userId) return { content: [{ type: "text", text: "Missing user identity" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("events")
      .insert({ user_id: userId, name, description: description ?? null, brand_color: brand_color ?? null })
      .select("id,name,status,created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { event: data },
    };
  },
});
