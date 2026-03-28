import type { Metadata } from "next";
import { getPortalLinks } from "@/lib/portal-links";
import { loadPlugins } from "@/lib/plugins";
import { PluginMarketplace } from "@/components/developer-portal/PluginMarketplace";

export async function generateMetadata(): Promise<Metadata> {
  const { siteUrl } = getPortalLinks();
  const title = "Fluid Plugin Marketplace";
  const description =
    "Discover community-built plugins, adapters, and integrations for Fluid. Extend fee sponsorship to React, Vue, Python, Go, Soroban, and more.";

  return {
    title,
    description,
    keywords: [
      "Fluid",
      "plugin",
      "marketplace",
      "Stellar",
      "Soroban",
      "React",
      "Vue",
      "Python",
      "Go",
      "adapter",
      "integration",
    ],
    metadataBase: new URL(siteUrl),
    alternates: { canonical: "/plugins" },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/plugins`,
      siteName: "Fluid",
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default function PluginsPage() {
  const plugins = loadPlugins();
  return <PluginMarketplace plugins={plugins} />;
}
