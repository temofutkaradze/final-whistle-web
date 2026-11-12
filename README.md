# Final Whistle

Next.js + Prisma + PostgreSQL (Neon), with Google/password login, Match and News Telegram generators, and a shared Chromium/Sharp JPG renderer.

> Existing production installation: do not rerun `INSTALL_NEWS.cmd` or the historical `db:push` setup instructions below. The four-column News migration has already been applied. Review [the production audit and proposed cleanup](docs/PRODUCTION_AUDIT.md) before changing schema, dependencies, authentication, or deployment.

## Run locally (Windows)

1. Copy `.env.example` to `.env` and paste your Neon connection string into `DATABASE_URL`.
2. `npm install`
3. `npm run db:push`   (creates the tables in Neon)
4. `npm run dev`       (open http://localhost:3000)

Check the database connection: http://localhost:3000/api/health

## Structure

- `prisma/schema.prisma`: User, Brand, Subscription tables
- `src/app/signup`: sign-up form (email + password only; the page name, bot and leagues are set on the dashboard)
- `src/app/dashboard`: session-protected entry point for Match and News settings
- `src/lib/leagues.ts`: league ids shared with the n8n workflow

## Worker (match posts)

New tables: `Match` (shared cache), `Selection`, `FixtureDay`, `ApiUsage`.
After copying these files run once: `npm run db:push`.

Run in separate terminals (plus the render server, see below):

    npm run render
    npm run bot
    npm run worker

(`start-system.bat` opens all of them, plus the site, in one Windows Terminal window.)

Flow: `/matches` in Telegram -> tap matches -> send a background image -> an observed live
90+ checkpoint may arrive first, followed by the final post after full time. Status checks
start 107 elapsed minutes after kickoff, then at most every minute per fixture; day-list
requests and final events are shared across customers. One-minute checking can consume the
daily quota substantially faster; it does not guarantee a live checkpoint. Matches older than
48 h are deleted. The API counter still stops at 90 requests/day (`DAILY_API_LIMIT`).

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


## Render server (in this project)

The post images are drawn by `render/render-server.js` (Playwright + Chromium + sharp). It lives in this
folder, so nothing outside the project is needed. One time, after `npm install`:

    npx playwright install chromium
    xcopy C:\football-bot\logos\leagues render\assets\leagues\ /E /I     (optional white league logos)

Then `npm run render` (port `RENDER_PORT`, default 4500, reachable from this computer only).

- `render/templates/<name>.html`: built-in templates (classic, panel, frame, stripe). Each one uses the same
  `{{PLACEHOLDERS}}` (see `classic.html`). `{{PAGE_NAME}}` becomes the page name or the page logo.
- `render/cache`, `render/rendered`, `render/output`: generated files, created automatically, not in git.
- A customer chooses the template and name-or-logo on the dashboard (`Brand.templateRef`, `Brand.brandMode`,
  `Brand.logoPath`; logos are re-encoded PNG files in `storage/logos`). After pulling this change run
  `npm run db:push` once (stop dev, bot and worker first).
- If another render server (e.g. `C:\football-bot`) is still running on port 4500, close it or set another
  `RENDER_PORT` and `RENDER_SERVER_URL`.

## Own templates (paste HTML or build one)

On the dashboard, in "Template and logo", the "+" tile opens "Add a template". A customer can have up to 12 own templates
(`Template` table; `Brand.templateRef` is `custom:<id>` when one is selected).

- **Build it here**: font, colours, dark layer, position, what to show. `src/lib/template-builder.ts` turns the options
  into normal template HTML (every value comes from a fixed list or a `#rrggbb` check).
- **Paste HTML**: any template that uses the `{{PLACEHOLDERS}}` of `render/templates/classic.html`.
  `render/template-check.js` is the safety check (used by the form, by the server action and again by the render server):
  no scripts, no `on...=` attributes, no frames or forms, and no URL except a `{{placeholder}}`, a `data:` picture or Google Fonts.
- When drawing a customer template the render server also adds a Content-Security-Policy to the page and blocks every
  browser request except `data:`, Google Fonts, its own logo and background folders and the logo URLs of that request.
- The worker reads the template html from the database and sends it as `template_html`. A deleted template falls back to Classic.
- After pulling this change: `npm run db:push` (stop dev, bot and worker first).

Every template tile has an **Edit** link (`/dashboard/match?edit=<key>`). A built-in template opens as HTML and is always saved as a new
template (the built-in files never change). A customer's own template opens as it was made (options form or HTML) and, when
saving, the customer chooses "overwrite" or "save as a new template". The options form has about 30 options
(`BuilderConfig` in `src/lib/template-builder.ts`; older saved configs get defaults for new options). Form input is checked
server-side in `src/lib/template-input.ts`.

## Tests

    npm test            run all tests once (about 15 seconds)
    npm run test:watch  run them again on every file change
    npm run typecheck   TypeScript check of the site and of the tests

Tests use mocked database and Telegram APIs. The News renderer suite uses real Chromium on a temporary local port; install its matching browser with `npx --no-install playwright install chromium` before running tests. CI installs Chromium and its Linux dependencies. Match renderer tests use a fake browser. What the tests cover (`tests/`):

- `password`, `crypto`: password hashing, session tokens, the login limiter, bot-token encryption, and that the website and the
  bot/worker (two separate copies of the code) can read each other's encrypted tokens.
- `template-check`, `template-builder`, `template-input`: the safety check for customer templates (30 attack samples),
  every option of the template builder, and the server side of the Add / Edit template form.
- `worker-core`: the worker's decisions, run against an in-memory database: normal posts, API problems, an unreachable render
  server or Telegram, never sending a post twice, giving up after 24 hours, clean-up.
- `poller`, `selection`: the Telegram bot's listening loop (internet drops, bad token, a failing handler) and a tap on a match button
  (double taps, a post that is being sent).
- `wiring`: every name that `worker.mjs` and `bot.mjs` import really exists.
- `google`: the helper functions of "Continue with Google" (PKCE vector from RFC 7636, state, only a verified email is accepted,
  code exchange with a fake Google).
- `logos`: logo upload (only real PNG / JPEG / WebP, always re-encoded, never outside `storage/logos`).
- `events`: the scorers and cards on a post (own goals, penalties, second yellows, grouping, escaping, row limit).
- `football-time`: a customer's local day in any time zone, including the days clocks change, and the free-plan limits.
- `render-server`: `render/render-server.js` is started as its own process with a fake Chromium
  (`tests/helpers/fake-playwright.cjs`): template choice, escaping, logo rules, customer templates and the request guard.

Check Google login and live Telegram delivery manually. News tests cover real Chromium output; the audit also compared all four News and four Match layouts before/after. See docs/PRODUCTION_AUDIT.md for scope and limitations.

## How the worker and the bot handle problems

The worker (`scripts/worker.mjs`, logic in `scripts/lib/worker-core.mjs`) and the bot (`scripts/bot.mjs`, loop in
`scripts/lib/poller.mjs`) are written to keep going when something outside breaks:

- A failing match-data call does not stop the posts that are ready, and is retried after 10, 20, 40 ... minutes (never every
  minute), so it cannot use up the free 100 requests a day.
- A render server or Telegram that is simply not reachable (not started, network down, "too many requests") does not use up a
  post's 5 attempts. The post waits and is sent when things work again, for up to 24 hours.
- A post that was delivered is never sent twice, even if the database was asleep when the worker tried to note it.
- A match that ended with goals but no events is looked up again (after 5 and 10 minutes) before a post without scorers is made.
- After 24 hours without a result, the post is closed and the customer is told.
- The bot's listening loop survives an internet drop and restarts by itself; a bad token is checked again after 5 minutes.

## Security and checks

- **Security headers** (`next.config.mjs`): every page gets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`
  and `Permissions-Policy`. In production (`npm run build` + `npm start`) it also gets a `Content-Security-Policy` (only this
  site and Google Fonts may be loaded, nobody may frame the site, forms only go to this site) and `Strict-Transport-Security`.
  Development (`npm run dev`) has no policy, because live reload needs things it would block, so after a change that adds a new
  outside service (a new font host, an analytics script, an embedded video...) test with `npm run build` and `npm start`
  and look at the browser console for "Refused to ..." messages.
- **CI** (`.github/workflows/ci.yml`): GitHub runs the types check, the tests and a production build on every push to `main` and
  on every pull request. **Dependabot** (`.github/dependabot.yml`) opens a weekly pull request for new dependency versions.
- `getCurrentUser()` (`src/lib/auth.ts`) is remembered for the length of one request (`cache()`): a page load asks the database
  for the session once instead of three times.
- The 2026-11-05 audit reported zero known dependency vulnerabilities for the installed lockfile. This is not a guarantee of application security; see docs/PRODUCTION_AUDIT.md for the confirmed runtime findings and approval-gated fixes.
