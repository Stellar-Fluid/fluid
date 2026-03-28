"use client";

import { motion } from "framer-motion";
import { Box, Layers, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getPortalLinks } from "@/lib/portal-links";
import { cn } from "@/lib/utils";

const SDK_SNIPPET = `import { FluidClient } from "fluid-client";

const client = new FluidClient({
  serverUrl: "https://api.example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
});

// User-signed transaction XDR → Fluid returns a fee-bump wrapper
const { xdr, status, hash } = await client.requestFeeBump(signedXdr, true);
console.log(status, hash);`;

export function DeveloperPortalLanding() {
  const { docs, github, discord } = getPortalLinks();
  const [copied, setCopied] = useState(false);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(SDK_SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <section
        className="relative isolate overflow-hidden border-b border-border/80"
        aria-labelledby="hero-heading"
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.18),transparent)]"
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
              Developer portal
            </motion.p>
            <motion.h1
              id="hero-heading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl"
            >
              Ship gasless Stellar experiences at scale
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mt-6 text-lg text-muted-foreground sm:text-xl"
            >
              Fluid sponsors network fees so your users never hold XLM for gas. Sign
              locally, bump fees on the server, and go live on testnet or mainnet with
              the same SDK.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Button size="lg" className="min-w-[200px] text-base shadow-lg" asChild>
                <Link href="/login">Get API Key</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href={docs} target="_blank" rel="noopener noreferrer">
                  Read the docs
                </a>
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      <section
        id="features"
        className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
        aria-labelledby="features-heading"
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center"
        >
          <h2 id="features-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
            Built for real-world Stellar apps
          </h2>
          <p className="mt-4 text-muted-foreground">
            Everything you need to abstract fees while keeping users in control of their keys.
          </p>
        </motion.div>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {[
            {
              icon: Zap,
              title: "Gasless by design",
              body: "End users sign transactions; Fluid wraps them in fee-bump transactions so your app covers XLM network costs without exposing fee payer keys.",
            },
            {
              icon: Layers,
              title: "Multi-asset flows",
              body: "Sponsor fees while users move SAC tokens, liquidity pool shares, or any Stellar asset—stay aligned with how your product actually settles value.",
            },
            {
              icon: Box,
              title: "Soroban-ready",
              body: "Pair Horizon and Soroban RPC in one client: build smart contract calls, then let Fluid handle the fee bump so contract invocations stay seamless.",
            },
          ].map((item, index) => (
            <motion.article
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: index * 0.08, duration: 0.45 }}
              className={cn(
                "flex flex-col rounded-2xl border border-border bg-card p-8 shadow-sm",
                "hover:border-primary/30 hover:shadow-md transition-colors",
              )}
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <item.icon className="h-6 w-6" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </motion.article>
          ))}
        </div>
      </section>

      <section
        className="border-y border-border bg-muted/30"
        aria-labelledby="sdk-heading"
      >
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45 }}
            className="mx-auto max-w-3xl text-center"
          >
            <h2 id="sdk-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              Integrate in minutes
            </h2>
            <p className="mt-4 text-muted-foreground">
              The TypeScript SDK talks to your Fluid deployment over HTTPS—drop it into web or
              Node and start requesting fee bumps.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="relative mx-auto mt-10 max-w-4xl overflow-hidden rounded-2xl border border-border bg-zinc-950 shadow-xl dark:bg-zinc-950"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <span className="text-xs font-medium text-zinc-400">quickstart.ts</span>
              <button
                type="button"
                onClick={copySnippet}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre
              className="overflow-x-auto p-4 text-left text-sm leading-relaxed text-zinc-100"
              tabIndex={0}
            >
              <code>{SDK_SNIPPET}</code>
            </pre>
          </motion.div>
        </div>
      </section>

      <footer
        className="mt-auto border-t border-border bg-card/50"
        role="contentinfo"
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold text-foreground">Fluid</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Fee sponsorship infrastructure for Stellar developers.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3" aria-label="Footer">
            <a
              href={docs}
              className="text-sm font-medium text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Documentation
            </a>
            <Link
              href="/plugins"
              className="text-sm font-medium text-primary hover:underline"
            >
              Plugin Marketplace
            </Link>
            <a
              href={github}
              className="text-sm font-medium text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href={discord}
              className="text-sm font-medium text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Discord
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
