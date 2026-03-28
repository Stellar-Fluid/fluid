import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSandboxPageData } from "@/lib/sandbox-data";
import { SandboxPanel } from "@/components/dashboard/SandboxPanel";

export default async function AdminSandboxPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { keys, sandboxHorizonUrl, sandboxRateLimitMax, source } =
    await getSandboxPageData();

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-600">
                Fluid Admin
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">
                Sandbox Environment
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {source === "live"
                  ? "Live server data"
                  : "Sample data — server unreachable"}
              </p>
            </div>
            <Link
              href="/admin/dashboard"
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <SandboxPanel
          initialKeys={keys}
          sandboxHorizonUrl={sandboxHorizonUrl}
          sandboxRateLimitMax={sandboxRateLimitMax}
        />
      </main>
    </div>
  );
}
