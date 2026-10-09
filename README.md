# Final Whistle (demo)

Next.js + Prisma + PostgreSQL (Neon). Demo only: no passwords, no payments.

## Run locally (Windows)

1. Copy `.env.example` to `.env` and paste your Neon connection string into `DATABASE_URL`.
2. `npm install`
3. `npm run db:push`   (creates the tables in Neon)
4. `npm run dev`       (open http://localhost:3000)

Check the database connection: http://localhost:3000/api/health

## Structure

- `prisma/schema.prisma`: User, Brand, Subscription tables
- `src/app/signup`: sign-up form (server action writes to the database)
- `src/app/dashboard`: shows an account by email
- `src/lib/leagues.ts`: league ids shared with the n8n workflow
