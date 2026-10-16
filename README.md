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
bot and checks for new ones every 10 seconds. The first chat that presses Start in a customer's bot
becomes their chat; everyone else gets "This bot is private." The worker sends each post through the
customer's own bot. There is no shared bot: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in an old
`.env` are ignored and can be deleted. Accounts that were linked through the old shared bot connect their own bot
with a token. While the bot window is closed nothing can react to Start, so keep `npm run bot` running when connecting.

## Testing phase: run the bot and worker only while testing

The bot checks Neon every 10 seconds and the worker every 60 seconds. While either one runs, the
database never gets idle, so Neon cannot suspend its compute after 5 minutes of inactivity.
The Neon Free plan includes 100 CU-hours of compute and 0.5 GB of storage per project. If the
compute runs all day, every day, those 100 CU-hours can be used up before the month ends; then the
database is suspended until the limits renew (no charge on the Free plan, but the site stops working).

So during the free testing phase:

- Start `npm run bot` and `npm run worker` (or `start-system.bat`) only when you are testing, and close
  the terminal window afterwards. The site itself (`npm run dev`) only queries Neon when a page is opened.
- Do not reuse the bot that the old n8n workflow uses. `npm run bot` removes a bot's webhook so it can
  poll, which would switch n8n's trigger off. Create a new bot with @BotFather for the site.
- Keep `.env` (database URL, API keys, bot tokens, `APP_SECRET`) out of git. `storage/` (background
  photos and other generated files) is also ignored. If a file in `storage/` was committed earlier, remove
  it from git once with `git rm --cached -r storage` and commit.
- Before a public launch (Phase B) this is reviewed: hosting, database plan, backups and monitoring.

## Dashboard: page name and account deletion

- Each page can be renamed on the dashboard (the name is printed on the post image).
- "Delete account" removes the user together with pages, subscriptions, selections, followed clubs and the
  encrypted bot token, and deletes that user's background photos from `storage/backgrounds`. The shared
  `Match` and `Team` tables are not touched. The running `npm run bot` stops the deleted user's bot within
  10 seconds. The bot itself stays in @BotFather.

## Login (test phase)

- Accounts use email + password (min. 8 characters). Passwords are stored as scrypt hashes (`src/lib/password.ts`),
  logins are kept in the `Session` table; the browser only gets a random token in an HttpOnly cookie.
- The dashboard and all its actions use the logged-in user from that cookie. Nothing is read from the URL or a hidden
  form field any more, so one account cannot act on another.
- After pulling this change run `npm run db:push` once (adds `User.passwordHash` and the `Session` table; existing data
  is kept), then restart `npm run dev`, `npm run bot` and `npm run worker`.
- Test accounts made before passwords existed have no password and cannot log in. Delete them in `npm run db:studio`
  (the User row removes its pages, selections etc.) and register again.
- Not included yet (Phase B): password reset and email confirmation (they need an email service), HTTPS-only cookies
  behind a real domain (the cookie is already `Secure` when `NODE_ENV=production`), rate limits shared between servers.

## Design

- Styles are in `src/app/globals.css` (plain CSS, no extra packages). Fonts (Instrument Serif, Manrope) are loaded from
  Google Fonts in `src/app/layout.tsx`, so the pages need an internet connection to show them exactly; without it a
  system font is used.
- `public/examples/` holds three sample post images for the landing and sign-up pages. They are placeholders for the
  testing phase (they show a real player and club logos). Replace them with your own images before a public launch.

## Light / dark theme and site texts

- The header has a light/dark switch. Until a visitor uses it, the site follows the device setting; the choice is
  remembered in the browser (`localStorage`, key `fw-theme`). Colours are variables at the top of `src/app/globals.css`
  (`:root` for light, `:root[data-theme="dark"]` and the `prefers-color-scheme` block for dark).
- All texts of the public pages (name, headline, steps, FAQ, example images) are in `src/lib/site.ts`. For another
  topic (another sport, films, crypto...) change that file and the pictures in `public/examples`; the design stays the same.
  The product itself still only produces football result posts.

## What the dashboard is for

Everything about a match happens in Telegram (`/matches`, tap the matches, send a background if you like). The site is only
for the settings that stay the same: connecting the bot, the page name, the template and the leagues/clubs shown by
`/matches`. The leagues list is collapsed by default.

## Continue with Google (free)

Optional. The button appears on the login and sign-up pages only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
are set in `.env`. Only the basic scopes (`openid email profile`) are requested. An existing account with the same
(Google-verified) email is simply logged in; otherwise an account with a page called "My page" is created.

Setup (the Google Cloud menus change from time to time, so names may differ slightly):
1. Open console.cloud.google.com and create a project (any name).
2. Google Auth Platform (formerly "OAuth consent screen"): app name, support email, audience "External", contact email.
3. Clients, create a client of type "Web application". Under "Authorized redirect URIs" add exactly
   `http://localhost:3000/auth/google/callback` (use the port you really open; add your real domain later).
4. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart `npm run dev`.
5. In Testing mode Google shows a warning screen and no app logo; this is normal. Never commit the secret.

