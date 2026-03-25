import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const dbUrl = process.env["DATABASE_URL"] ?? "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database with initial data...");

  // Create test tenants with API keys
  const tenants = await Promise.all([
    prisma.tenant.upsert({
      where: { apiKey: "test-api-key-001" },
      update: {},
      create: {
        name: "Test Tenant 1",
        apiKey: "test-api-key-001",
      },
    }),
    prisma.tenant.upsert({
      where: { apiKey: "test-api-key-002" },
      update: {},
      create: {
        name: "Development Tenant",
        apiKey: "test-api-key-002",
      },
    }),
  ]);

  console.log(`✅ Created ${tenants.length} test tenants:`);
  tenants.forEach((tenant) => {
    console.log(`   - ${tenant.name} (API Key: ${tenant.apiKey})`);
  });

  console.log("\n✨ Seeding complete!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seeding failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
