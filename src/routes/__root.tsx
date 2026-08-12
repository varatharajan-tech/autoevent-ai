import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-medium">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AutoEvent AI — Raw event media → ready-to-post content" },
      { name: "description", content: "An agentic AI engine that turns hundreds of event photos into branded, platform-ready posts in minutes." },
      { property: "og:title", content: "AutoEvent AI — Event media to social content" },
      { property: "og:description", content: "An agentic AI engine that turns hundreds of raw event photos and clips into branded, platform-ready posts and reels in minutes." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "AutoEvent AI" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              name: "AutoEvent AI",
              url: "https://autoenvent-ai.lovable.app",
              publisher: { "@id": "https://autoenvent-ai.lovable.app/#organization" },
            },
            {
              "@type": "Organization",
              "@id": "https://autoenvent-ai.lovable.app/#organization",
              name: "AutoEvent AI",
              url: "https://autoenvent-ai.lovable.app",
              logo: "https://autoenvent-ai.lovable.app/favicon.png",
            },
          ],
        }),
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&family=Inter:wght@300..700&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: () => <Outlet />,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}
