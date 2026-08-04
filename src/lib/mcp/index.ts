import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listEventsTool from "./tools/list-events";
import createEventTool from "./tools/create-event";
import getEventTool from "./tools/get-event";
import listPostsTool from "./tools/list-posts";
import updatePostCaptionTool from "./tools/update-post-caption";
import listReelsTool from "./tools/list-reels";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "event-spark-import",
  title: "Event Spark Import",
  version: "0.1.0",
  instructions:
    "Tools for AutoEvent AI. Use `list_events` to find the user's events, `get_event` for one event and its analyzed photos/clips, `create_event` to start a new event, `list_posts` and `update_post_caption` for AI-generated social copy, and `list_reels` for rendered reel downloads. All tools act as the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listEventsTool,
    getEventTool,
    createEventTool,
    listPostsTool,
    updatePostCaptionTool,
    listReelsTool,
  ],
});
