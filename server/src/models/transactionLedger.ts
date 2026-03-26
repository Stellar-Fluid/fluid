import prisma from "../utils/db";

export interface SponsoredTransactionRecord {
  id: string;
  tenantId: string;
  feeStroops: number;
  createdAt: Date;
}

function getUtcDayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function recordSponsoredTransaction(
  tenantId: string,
  feeStroops: number,
  createdAt: Date = new Date()
): Promise<SponsoredTransactionRecord> {
  // 🛠️ Bypass: Added (prisma as any)
  const record = await (prisma as any).sponsoredTransaction.create({
    data: { tenantId, feeStroops: BigInt(feeStroops), createdAt },
  });
  return {
    id: record.id,
    tenantId: record.tenantId,
    feeStroops: Number(record.feeStroops),
    createdAt: record.createdAt,
  };
}

export async function getTenantDailySpendStroops(
  tenantId: string,
  now: Date = new Date()
): Promise<number> {
  const { start, end } = getUtcDayRange(now);
  // 🛠️ Bypass: Added (prisma as any)
  const result = await (prisma as any).sponsoredTransaction.aggregate({
    where: { tenantId, createdAt: { gte: start, lt: end } },
    _sum: { feeStroops: true },
  });
  return Number(result._sum.feeStroops ?? 0);
}