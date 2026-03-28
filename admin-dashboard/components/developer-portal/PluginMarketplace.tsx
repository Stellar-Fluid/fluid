"use client";

import { motion } from "framer-motion";
import { ExternalLink, Package, Star, Tag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getPortalLinks } from "@/lib/portal-links";
import { filterByTag, getAllTags, type Plugin } from "@/lib/plugins";
import { cn } from "@/lib/utils";

interface PluginMarketplaceProps {
  plugins: Plugin[];
}

export function PluginMarketplace({ plugins }: PluginMarketplaceProps) {
  const { github } = getPortalLinks();
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = getAllTags(plugins);
  const featured = plugins.filter((p) => p.featured);
  const filtered = filterByTag(plugins, activeTag);

  const submitUrl = `${github}/issues/new?title=Plugin+submission%3A+&body=%23%23+Plugin+details%0A%0A**Name**%3A%0A**Author**%3A%0A**Description**%3A%0A**Install+command**%3A%0A**GitHub+URL**%3A%0A**Tags**%3A`;

  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        className="relative isolate overflow-hidden border-b border-border/80"
        aria-labelledby="marketplace-heading"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.15),transparent)]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mb-4 text-sm font-semibold uppercase tracking-widest text-primary"
            >
              Plugin marketplace
            </motion.p>
            <motion.h1
              id="marketplace-heading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl"
            >
              Extend Fluid for every stack
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mt-6 text-lg text-muted-foreground sm:text-xl"
            >
              Community-built plugins, adapters, and integrations that bring Fluid fee
              sponsorship to React, Vue, Python, Go, Soroban, and beyond.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Button size="lg" className="min-w-[200px] text-base shadow-lg" asChild>
                <a href={submitUrl} target="_blank" rel="noopener noreferrer">
                  Submit a Plugin
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/">Back to docs</Link>
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Featured ─────────────────────────────────────────────────────── */}
      {featured.length > 0 && (
        <section
          className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8"
          aria-labelledby="featured-heading"
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5 }}
          >
            <h2
              id="featured-heading"
              className="text-2xl font-bold tracking-tight sm:text-3xl"
            >
              Featured plugins
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Handpicked integrations recommended by the Fluid team.
            </p>
          </motion.div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((plugin, index) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                index={index}
                highlight
              />
            ))}
          </div>
        </section>
      )}

      {/* ── All plugins ──────────────────────────────────────────────────── */}
      <section
        className="border-t border-border bg-muted/30"
        aria-labelledby="all-plugins-heading"
      >
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5 }}
            className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <h2
                id="all-plugins-heading"
                className="text-2xl font-bold tracking-tight sm:text-3xl"
              >
                All plugins
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {filtered.length} plugin{filtered.length !== 1 ? "s" : ""}
                {activeTag ? ` tagged "${activeTag}"` : " available"}
              </p>
            </div>

            {/* Tag filter */}
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Filter by tag"
            >
              <TagButton
                label="All"
                active={activeTag === null}
                onClick={() => setActiveTag(null)}
              />
              {allTags.map((tag) => (
                <TagButton
                  key={tag}
                  label={tag}
                  active={activeTag === tag}
                  onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                />
              ))}
            </div>
          </motion.div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((plugin, index) => (
              <PluginCard key={plugin.id} plugin={plugin} index={index} />
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="mt-12 text-center text-sm text-muted-foreground">
              No plugins match the selected tag.
            </p>
          )}
        </div>
      </section>

      {/* ── Submit CTA ───────────────────────────────────────────────────── */}
      <section className="border-t border-border" aria-labelledby="submit-heading">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-10 text-center shadow-sm"
          >
            <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Package className="h-7 w-7" aria-hidden />
            </div>
            <h2
              id="submit-heading"
              className="text-2xl font-bold tracking-tight sm:text-3xl"
            >
              Built something for Fluid?
            </h2>
            <p className="mt-4 text-muted-foreground">
              Open a GitHub issue using our plugin-submission template and we'll
              review it for listing in the marketplace.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="shadow-lg" asChild>
                <a href={submitUrl} target="_blank" rel="noopener noreferrer">
                  Submit a Plugin
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href={github} target="_blank" rel="noopener noreferrer">
                  View on GitHub
                </a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-border bg-card/50" role="contentinfo">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold text-foreground">Fluid</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Fee sponsorship infrastructure for Stellar developers.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3" aria-label="Footer">
            <Link
              href="/"
              className="text-sm font-medium text-primary hover:underline"
            >
              Developer portal
            </Link>
            <a
              href={github}
              className="text-sm font-medium text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface PluginCardProps {
  plugin: Plugin;
  index: number;
  highlight?: boolean;
}

function PluginCard({ plugin, index, highlight = false }: PluginCardProps) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: index * 0.06, duration: 0.45 }}
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-colors",
        highlight
          ? "border-primary/30 hover:border-primary/60 hover:shadow-md"
          : "border-border hover:border-primary/30 hover:shadow-md",
      )}
      aria-label={plugin.name}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold leading-tight">{plugin.name}</h3>
          <a
            href={plugin.authorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            @{plugin.author}
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
          <span>{plugin.stars.toLocaleString()}</span>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {plugin.description}
      </p>

      {/* Install command */}
      <div className="mt-4 flex items-center gap-2 overflow-hidden rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
        <span className="shrink-0 text-muted-foreground">$</span>
        <span className="truncate text-foreground">{plugin.installCommand}</span>
      </div>

      {/* Tags */}
      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
        {plugin.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2.5 py-0.5 text-xs font-medium text-primary"
          >
            <Tag className="h-2.5 w-2.5" aria-hidden />
            {tag}
          </span>
        ))}
      </div>

      {/* Footer link */}
      <a
        href={plugin.githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        aria-label={`View ${plugin.name} on GitHub`}
      >
        View on GitHub
        <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
      </a>
    </motion.article>
  );
}

interface TagButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function TagButton({ label, active, onClick }: TagButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
