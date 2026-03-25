# Prisma Database Migrations

This directory contains all database migration files and scripts for the Fluid project. It follows a standardized approach to manage schema changes across all environments (local, staging, production).

## Overview

- **schema.prisma**: The single source of truth for the database schema
- **migrations/**: Contains all versioned migration files
- **seed.ts**: Seed script for initial test data

## Prerequisites

Make sure you have the following installed:
- Node.js (v20+)
- npm or yarn
- PostgreSQL 14+ (for production) or SQLite (for local development)

## Environment Setup

### Local Development (SQLite)

1. Create a `.env` file in the server directory:
```bash
DATABASE_URL="file:./dev.db"
```

2. The database file will be created automatically when you run migrations.

### Production/Staging (PostgreSQL)

1. Update your `.env` file with your PostgreSQL connection string:
```bash
DATABASE_URL="postgresql://user:password@hostname:5432/fluid_db?schema=public"
```

2. Ensure the database exists before running migrations:
```bash
createdb fluid_db
```

## Creating New Migrations

### Method 1: Using Prisma (Recommended)

After updating `schema.prisma`, create a new migration:

```bash
npm run db:migrate -- --name <migration_name>
```

**Example:**
```bash
npm run db:migrate -- --name add_user_table
```

This will:
1. Compare your `schema.prisma` to the database
2. Generate a migration file with the SQL changes
3. Apply the migration to your database
4. Update `schema.prisma` if needed

### Method 2: Manual Migration

If you need more control, you can:

1. Create a new folder in `migrations/`:
```bash
mkdir -p prisma/migrations/<timestamp>_<migration_name>
```

2. Create a `migration.sql` file with your SQL changes
3. Run: `npm run db:migrate:deploy` to apply it

**⚠️ Important:** Never edit existing migration files. Create new ones instead.

## Applying Migrations

### Development

```bash
npm run db:migrate
```

This runs in "dev mode" and handles:
- Creating the database if it doesn't exist
- Applying all pending migrations
- Clearing the database on schema conflicts (interactive)
- Regenerating Prisma Client

### Production/Staging

```bash
npm run db:migrate:deploy
```

This applies pending migrations without making destructive changes. Safe for production use.

### Reset (Development Only)

⚠️ **WARNING:** This deletes all data!

```bash
npm run db:reset
```

This will:
1. Drop the database
2. Create a fresh database
3. Apply all migrations
4. Run the seed script

## Seeding Initial Data

To seed your database with initial data (test tenants and API keys):

```bash
npm run db:seed
```

This loads and executes `prisma/seed.ts`, which creates:
- Sample Tenant(s)
- Sample API Key(s)

For development, combine with migration:
```bash
npm run db:reset  # Applies migrations and runs seed
```

## Common Workflows

### Setting Up a Fresh Local Environment

```bash
# 1. Create .env with DATABASE_URL
# 2. Install dependencies
npm install

# 3. Set up database with migrations and seed
npm run db:reset
```

### Adding a New Table/Field

```bash
# 1. Update prisma/schema.prisma
# 2. Create and apply migration
npm run db:migrate -- --name add_new_feature

# 3. Update seed.ts if needed to include new fields
# 4. Test with
npm run db:seed
```

### Reverting a Migration

Prisma doesn't support rollbacks. Instead:

1. Create a new migration that undoes the changes:
   ```bash
   npm run db:migrate -- --name undo_last_change
   ```
2. Manually edit the migration SQL if needed
3. Apply it: `npm run db:migrate:deploy`

### Resolving Failed Migrations

If a migration fails:

1. Check the error: `npm run db:migrate:status`
2. Fix the issue or create a new migration
3. For unrecoverable situations, mark as resolved:
   ```bash
   npx prisma migrate resolve --rolled-back <migration_name>
   ```

## Guidelines for Team Members

### Before Committing Changes

1. **Always use `prisma migrate dev`** to create migrations automatically
2. **Never manually edit existing `.sql` files** in migrations/
3. **Test migrations locally** before pushing:
   ```bash
   npm run db:reset  # Full test cycle
   ```
4. **Commit migration files to git** - they should be versioned

### Before Deploying to Production

1. Ensure all migrations are tested locally
2. Review the migration SQL for performance issues
3. Have a rollback plan (create an undo migration)
4. Run: `npm run db:migrate:deploy` on staging first
5. Schedule production migration during maintenance window

### Troubleshooting Checklist

- [ ] Is `.env` properly configured with DATABASE_URL?
- [ ] Is the database server running and accessible?
- [ ] Do you have permission to create/modify the database?
- [ ] Are there no uncommitted schema conflicts in `prisma/`?
- [ ] Have you run `npm install` to get latest dependencies?

## File Structure

```
prisma/
├── schema.prisma          # Database schema definition
├── seed.ts                # Seed script for test data
├── migrations/            # Contains all migration files
│   ├── 0_init/
│   │   └── migration.sql
│   ├── 1_<timestamp>_<name>/
│   │   └── migration.sql
│   └── migration_lock.toml # Prisma internal file
└── README.md              # This file
```

## Additional Resources

- [Prisma Migrate Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

## Questions or Issues?

If you encounter migration issues:
1. Check the DATABASE_URL in `.env`
2. Ensure the database is running
3. Review migration files in `migrations/`
4. Run `npm run db:migrate:status` for detailed info
5. Contact the team lead or check git history for context
