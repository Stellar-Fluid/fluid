"use client";

import { useState } from "react";
import {
  FlaskConical,
  RefreshCw,
  Plus,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import type { SandboxApiKey } from "@/lib/sandbox-data";
import { cn } from "@/lib/utils";

interface SandboxPanelProps {
  initialKeys: SandboxApiKey[];
  sandboxHorizonUrl: string;
  sandboxRateLimitMax: number;
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function SandboxPanel({
  initialKeys,
  sandboxHorizonUrl,
  sandboxRateLimitMax,
}: SandboxPanelProps) {
  const [keys, setKeys] = useState<SandboxApiKey[]>(initialKeys);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetResults, setResetResults] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<{
    key: string;
    sandboxPublicKey: string;
  } | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function handleReset(sandboxApiKey: string, keyId: string) {
    setResetting(keyId);
    setResetResults((r) => ({ ...r, [keyId]: "" }));
    try {
      const res = await fetch("/api/admin/sandbox/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxApiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResetResults((r) => ({
          ...r,
          [keyId]: data.error ?? "Reset failed",
        }));
        return;
      }
      setResetResults((r) => ({
        ...r,
        [keyId]: `Reset — ${data.deletedTransactions} tx wiped, funded: ${data.funded}`,
      }));
      // Update lastResetAt in local state
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId
            ? {
                ...k,
                sandboxLastResetAt: data.resetAt ?? new Date().toISOString(),
              }
            : k,
        ),
      );
    } catch {
      setResetResults((r) => ({ ...r, [keyId]: "Network error" }));
    } finally {
      setResetting(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId.trim()) return;
    setCreating(true);
    setNewKeyResult(null);
    try {
      const res = await fetch("/api/admin/sandbox/create-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantId.trim(),
          name: "Sandbox Key",
        }),
      });
      const data = await res.json();
      if (!res.ok) return;
      setNewKeyResult({
        key: data.key,
        sandboxPublicKey: data.sandboxPublicKey,
      });
      // Add to local list
      setKeys((prev) => [
        ...prev,
        {
          id: data.id,
          key: `${data.prefix}...`,
          prefix: data.prefix,
          tenantId: tenantId.trim(),
          active: true,
          isSandbox: true,
          sandboxPublicKey: data.sandboxPublicKey,
          sandboxLastResetAt: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setTenantId("");
    } finally {
      setCreating(false);
    }
  }

  async function copyToClipboard(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <FlaskConical
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          aria-hidden
        />
        <div className="text-sm text-amber-800">
          <p className="font-semibold">Sandbox environment</p>
          <p className="mt-0.5">
            Sandbox keys run against a local Stellar Quickstart instance (
            <code className="rounded bg-amber-100 px-1 font-mono text-xs">
              {sandboxHorizonUrl}
            </code>
            ) with a rate limit of{" "}
            <strong>{sandboxRateLimitMax} req/min</strong>. Reset at any time to
            wipe transactions and re-fund the fee-payer account.
          </p>
          <a
            href={`${sandboxHorizonUrl}/health`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-medium text-amber-700 hover:underline"
          >
            Check Quickstart health
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </div>

      {/* Keys table */}
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Sandbox API Keys
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Keys prefixed <code className="font-mono text-xs">sbx_</code> are
            clearly labelled as sandbox and cannot be used against production
            endpoints.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Key
                </th>
                <th className="hidden px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 sm:table-cell">
                  Tenant
                </th>
                <th className="hidden px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 md:table-cell">
                  Last Reset
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {keys.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-sm text-slate-400"
                  >
                    No sandbox keys yet. Create one below.
                  </td>
                </tr>
              )}
              {keys.map((k) => (
                <tr key={k.id} className="transition hover:bg-slate-50">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                        Sandbox
                      </span>
                      <span className="font-mono text-sm text-slate-900">
                        {k.key}
                      </span>
                    </div>
                    {k.sandboxPublicKey && (
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400 truncate max-w-[220px]">
                        {k.sandboxPublicKey}
                      </p>
                    )}
                  </td>
                  <td className="hidden px-5 py-4 text-sm text-slate-600 sm:table-cell">
                    {k.tenantId}
                  </td>
                  <td className="hidden px-5 py-4 text-sm text-slate-500 md:table-cell">
                    {formatDate(k.sandboxLastResetAt)}
                  </td>
                  <td className="px-5 py-4">
                    {k.active ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                        Revoked
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        disabled={resetting === k.id || !k.active}
                        onClick={() => handleReset(k.key, k.id)}
                        className={cn(
                          "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition",
                          "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100",
                          (resetting === k.id || !k.active) &&
                            "cursor-not-allowed opacity-50",
                        )}
                        aria-label={`Reset sandbox key ${k.key}`}
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            resetting === k.id && "animate-spin",
                          )}
                          aria-hidden
                        />
                        {resetting === k.id ? "Resetting…" : "Reset"}
                      </button>
                      {resetResults[k.id] && (
                        <span className="text-[11px] text-slate-500">
                          {resetResults[k.id]}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create new sandbox key */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">
          Create sandbox API key
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Generates a new <code className="font-mono text-xs">sbx_</code> key
          with a dedicated Stellar keypair. The key is shown once — copy it
          immediately.
        </p>

        <form onSubmit={handleCreate} className="mt-4 flex flex-wrap gap-3">
          <input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="Tenant ID"
            required
            className="flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
          <button
            type="submit"
            disabled={creating || !tenantId.trim()}
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-700",
              (creating || !tenantId.trim()) && "cursor-not-allowed opacity-50",
            )}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {creating ? "Creating…" : "Create"}
          </button>
        </form>

        {newKeyResult && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-800">
              Sandbox key created — copy it now, it won't be shown again.
            </p>
            <div className="mt-3 space-y-2">
              <KeyCopyRow
                label="API Key"
                value={newKeyResult.key}
                id="new-key"
                copied={copied === "new-key"}
                onCopy={() => copyToClipboard(newKeyResult.key, "new-key")}
              />
              <KeyCopyRow
                label="Fee-payer public key"
                value={newKeyResult.sandboxPublicKey}
                id="new-pk"
                copied={copied === "new-pk"}
                onCopy={() =>
                  copyToClipboard(newKeyResult.sandboxPublicKey, "new-pk")
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KeyCopyRow({
  label,
  value,
  id,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  id: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 shrink-0 text-xs font-medium text-emerald-700">
        {label}
      </span>
      <code className="flex-1 truncate rounded-lg bg-white px-3 py-1.5 font-mono text-xs text-slate-800 border border-emerald-200">
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded-lg border border-emerald-200 bg-white p-1.5 text-emerald-700 transition hover:bg-emerald-50"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
