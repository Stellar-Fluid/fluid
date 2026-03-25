// This project includes Prisma as an optional dependency, but the generated
// client may not exist in all environments unless `prisma generate` was run.
// Use `require` to avoid hard type dependencies during compilation.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require("@prisma/client") as { PrismaClient: any };

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
