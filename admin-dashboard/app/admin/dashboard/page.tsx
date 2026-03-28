import { auth } from "@/auth";
import Link from "next/link";
import {
  SignersTable,
  TransactionsTable,
} from "@/components/dashboard/ResponsiveTables";
import { getDashboardPageData } from "@/lib/dashboard-data";
import { StatCard } from "@/components/dashboard/StatCard";
import { UsageLeaderboard } from "@/components/dashboard/UsageLeaderboard";
import { BillingTopUp } from "@/components/dashboard/BillingTopUp";
import { SubscriptionTierManager } from "@/components/dashboard/SubscriptionTierManager";
import { getTenantLeaderboard } from "@/lib/transaction-history";
import { getSubscriptionTierPageData } from "@/lib/subscription-tiers-data";
import { SpendChart } from "@/components/dashboard/SpendChart";
import { Coins, CheckCircle, Wallet, Zap } from "lucide-react";

export default async function AdminDashboard() {
  const session = await auth();
  const { signers, transactions, source } = await getDashboardPageData();
  const tenantUsage = await getTenantLeaderboard();
  const subscriptionTierData = await getSubscriptionTierPageData();

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-sky-600">
                Fluid Admin
              </p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">
                Node Operations Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Transaction and signer visibility is optimized for mobile-first
                admin checks.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <div className="font-medium text-slate-900">
                  {session?.user?.email}
                </div>
                <div>
                  {source === "live"
                    ? "Live server data"
                    : "Sample dashboard data"}
                </div>
              </div>
              <ConnectDeviceDialog
                serverUrl={fluidServerUrl}
                adminToken={fluidAdminToken}
              />
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Stat Cards */}
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total XLM Sponsored"
            value="1,250,000"
            delta="+5% from last week"
            icon={Coins}
          />
          <StatCard
            title="Successful Transactions"
            value="45,678"
            delta="+12% from last week"
            icon={CheckCircle}
          />
          <StatCard
            title="Available Balance"
            value="500,000 XLM"
            delta="-2% from last week"
            icon={Wallet}
          />
          <StatCard
            title="Current TPS"
            value="12.5"
            delta="+8% from last week"
            icon={Zap}
          />
        </section>

        {/* Spend Analytics Chart */}
        <section className="mt-6">
          <SpendChart />
        </section>

        {/* Tables */}
        <section className="mt-6 space-y-6">
          <div className="flex flex-wrap justify-end gap-3">
            <Link
              href="/admin/webhooks"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Webhook settings
            </Link>
            <Link
              href="/admin/sandbox"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-700 transition hover:border-amber-400 hover:bg-amber-100"
            >
              Sandbox
            </Link>
            <Link
              href="/admin/signers"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Manage signer pool
            </Link>
            <Link
              href="/admin/transactions"
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Open transaction history
            </Link>
          </div>
          <TransactionsTable transactions={transactions} />
          <SignersTable signers={signers} />
          <UsageLeaderboard rows={tenantUsage} />
        </section>

        <section className="mt-6">
          <BillingTopUp tenantId={session?.user?.email ?? "default"} />
        </section>

        <section className="mt-6">
          <SubscriptionTierManager
            tiers={subscriptionTierData.tiers}
            tenants={subscriptionTierData.tenants}
            initialTenant={subscriptionTierData.tenant}
            source={subscriptionTierData.source}
          />
        </section>
      </main>
    </div>
  );
}
