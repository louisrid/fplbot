# FPLbot

A phone-first FPL decision tool. Four tabs: Fixtures, Solver, Home, Players.

## What it runs on

Nothing. No environment variables, no database, no API keys, no accounts.

Every number comes from two places:

1. **The official FPL API**, proxied through `/api/fpl`. Squad, prices, live points, fixtures,
   transfer history. All public endpoints.
2. **`config/xpts.mjs`**, a static copy of the FPL Copilot export bundled into the repo. The only
   source of projections.

## Deploying

1. Create a new empty repository on GitHub. Do not add a README.
2. Open this folder, select everything inside it (not the folder itself). If GitHub rejects the
   upload, leave out `.gitignore`: its leading dot sometimes upsets the web uploader, and the app
   does not need it.

   No folder in this project has square brackets in its name. GitHub's uploader refuses those, so
   the routes that would normally use them take a query parameter instead.
3. On the repo page: **Add file → Upload files**, drag the selection in, **Commit changes**.
4. vercel.com/new → Import the repository → **Deploy**. Change no settings.
5. Two minutes and it is live.

Add to your home screen from Safari for a fullscreen app with no browser chrome.

## Changing the projection horizon

Open `config/xpts.mjs` and raise `gw_served_to`. That is the only edit anywhere. Every range
picker, solver window and greyed-out week reads from it. The file already stores all 38 gameweeks,
so nothing needs reimporting.

## Changing which team it loads

`ENTRY_ID` at the top of `lib/fpl.js`.

## Layout

    app/page.jsx            Home: squad, live points, drafts, transfers, chips
    app/solver/             Transfer solver
    app/players/            Full player list
    app/fixtures/           Results and upcoming matches
    app/player/             Player detail, reached as /player?id=411
    app/api/fpl/            Proxy to the FPL API, which sends no CORS headers
    lib/fpl.js              Data loading and every game rule
    lib/solver.js           The transfer search
    lib/drafts.js           Draft chains and free-transfer accounting
    lib/chips.js            Chip availability, split by half-season
    lib/prefs.js            What the app remembers between visits
    lib/theme.js            Every colour, size and spacing value in the app

## Rules worth knowing

**Selling price.** You keep half of any rise, rounded down. Purchase prices are reconstructed
exactly: season-start price for a player never transferred in, `element_in_cost` for one you
bought. The app shows selling value, not market value, because that is what the squad would raise.

**Free transfers.** Derived from your real history. GW1 banks nothing, because before the first
deadline the whole squad is free to change. Draft chains start at the next deadline and bank to
five.

**Live matches.** FPL leaves `finished` false until bonus is confirmed, sometimes a day after the
whistle. A match is treated as over when `finished_provisional` is set, and shows "FT · prov"
until bonus is final.

**Chips.** Two of each per season, one per half. First-half chips expire after GW19. A chip already
played shows the gameweek it went.

**Projections.** Blank past `gw_served_to`. The app never shows a number the source cannot stand
behind.

**Memory.** Filters, sort orders, gameweek ranges, solver settings and your drafts all persist in
this browser through reloads, updates and closing the tab. They do not follow you to another
device, because there is no account to attach them to.
