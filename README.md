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

## Worker (match posts)

New tables: `Match` (shared cache), `Selection`, `FixtureDay`, `ApiUsage`.
After copying these files run once: `npm run db:push`.

Run in separate terminals (plus the render server):

    npm run bot
    npm run worker

Flow: `/matches` in Telegram -> tap matches -> send a background image -> when the match
ends (110 min after kickoff) the finished post arrives. API-Football is asked once per match;
all customers share the result. Matches older than 48 h are deleted. The API counter stops at
90 requests/day (`DAILY_API_LIMIT`).

## Each customer has their own bot

On the dashboard the customer creates a bot with @BotFather and pastes its token. The token is
stored encrypted (needs `APP_SECRET` in `.env`). `npm run bot` starts one polling loop per customer
bot and checks for new ones every 30 seconds. The first chat that presses Start in a customer's bot
becomes their chat; everyone else gets "This bot is private." The worker sends each post through the
customer's own bot.
