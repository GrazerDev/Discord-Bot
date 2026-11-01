# Nexus — a full-featured Discord bot (Node.js, self-hosted)

**98 commands · 15 modules · SQLite · music · automod · levels · tickets · giveaways.**

This is a **Gateway bot**, not an HTTP-interactions bot. That distinction is the whole reason
this repo exists — see the next section.

---

## Cloudflare Workers or Render? Read this first

You asked "can I host this on Cloudflare Workers, or should I use Render for music and everything?"

**Short answer: not Workers. Use Render / Railway / Fly / a VPS — i.e. anything that runs a
long-lived Node process.**

Here is the actual technical reason, not an opinion:

| | Cloudflare Workers | Render / Railway / Fly / VPS |
|---|---|---|
| Runtime model | Request/response, short-lived isolates | Long-running Node process |
| Discord connection | **HTTP interactions only** (Discord POSTs to you) | Full **Gateway websocket** |
| Message events (`messageCreate`) | ❌ never delivered | ✅ |
| Member join/leave events | ❌ | ✅ |
| Voice / music | ❌ impossible (needs UDP voice) | ✅ with ffmpeg + yt-dlp |
| Reaction events | ❌ | ✅ |
| Persistent in-RAM state (queues, cooldowns) | ❌ isolates are recycled | ✅ |
| Database | D1 only | SQLite file / Postgres |

Every headline feature of this bot — automod reacting to messages, XP per message, welcome
messages, starboard, reaction roles, temp voice rooms, music — is **built on events a Worker
never receives**. A Workers build would be a different, much smaller bot (slash commands +
buttons + modals only).

So: **this repo targets the Gateway.** If you specifically need Workers later, tell me and I'll
write the HTTP-interactions sibling — but understand it will have maybe 40% of these features.

Cost reality check:

- **Render** — Starter plan (~$7/mo) + 1 GB disk. Free tier sleeps and has no disk, so your
  database resets; fine for testing commands, not for a real server.
- **Railway** — ~$5/mo usage-based, mounts a volume, easiest Docker deploys.
- **Fly.io** — cheapest for a 512 MB bot (~$2–3/mo) + a volume. `fly.toml` included.
- **VPS** — $4/mo anywhere + `docker compose up -d`. Most control, best for music.

Music is the one feature that needs real CPU + a recent `yt-dlp`. The included `Dockerfile`
installs both. Rebuild monthly — YouTube breaks old yt-dlp builds regularly.

---

## What's in the box

| Module | Highlights |
|---|---|
| **Moderation** (18) | ban (temp too), unban, softban, kick, timeout, untimeout, warn, warnings (list/delete/clear), case history, purge (filter by user/text, up to 500), slowmode, lock/unlock, hide/unhide, nick, role add/remove/mass, unbanall. Hierarchical permission checks + DM notifications + every action written to a case log. |
| **Automod** | invite / link / caps / spam / mass-mention / zalgo / newline filters, banned words, role+channel whitelists, punishments from delete → ban, own log channel. |
| **Logging** | separate channels for mod actions, message edits/deletes/bulk-deletes, joins/leaves/nicknames/roles/timeouts, voice activity, and server/channel/role changes. |
| **Welcome** | per-server message with `{user} {username} {server} {count}` placeholders, embed or plain, autorole for humans **and** bots. |
| **Levels** | XP with cooldowns, `/rank` card, leaderboard, level-up announcements, **role rewards per level**, staff XP tools. |
| **Economy** | wallet + bank, `/daily` with streaks, `/weekly`, work, beg, pay, rob (with fines), gamble, slots, leaderboard. All updates are atomic SQL. |
| **Music** | `/play` search or URL, queue, pause, skip, stop, loop (track/queue), shuffle, volume, remove, now-playing. yt-dlp → ffmpeg → Opus pipeline. |
| **Tickets** | panel button → private channel, claim, add/remove users, close with a **transcript file** posted to your log channel. |
| **Giveaways** | timed via the DB scheduler (survives restarts), button entry, multi-winner, role/level requirements, reroll, list, delete. |
| **Roles** | reaction roles, multi-button self-role panels, one-click verification gate. |
| **Social** | suggestions with upvote/downvote buttons and staff status workflow, live polls with buttons. |
| **Utility** | help with category browser, ping, user/server/role/channel info, avatars & banners, emoji list, bot stats, AFK, snipe/edit-snipe, timestamps, weather, dictionary + urban, GitHub lookup, activity stats, message search. |
| **Fun** | 8ball, coinflip, dice, rps, trivia (button-answered), jokes, memes, cats/dogs, choose, ship, roast, compliment, would-you-rather, truth-or-dare, silly meters. |
| **Tags** | server snippets with autocomplete + usage counts, plus keyword **autoresponders**. |
| **Reminders** | `/remind 2h drink water`, list, cancel — delivered by the DB-backed scheduler. |
| **Context menus** | User Info, Avatar, Bookmark Message (DMs it to you), Report Message (to modlog), Copy Message ID. |
| **AI (optional)** | `/ai ask` against any OpenAI-compatible endpoint, with per-channel memory and `/ai reset`. |

### Full command list

```
Moderation     /ban /unban /softban /kick /timeout /untimeout /warn /warnings /case
               /purge /slowmode /lock /unlock /hide /unhide /nick /role /unbanall
Configuration  /settings /setlogs /setwelcome /setgoodbye /autorole /automod
               /starboard /levelconfig /temprooms
Levels         /rank /levelboard /xp
Economy        /balance /daily /weekly /work /beg /pay /gamble /slots /rob /ecoboard
Music          /play /pause /skip /stop /nowplaying /queue /player /disconnect
Tickets        /ticketpanel /ticketconfig (14 subcommands) /ticket add|remove|rename|close
Giveaways      /giveaway start|end|reroll|delete|list
Roles          /reactionrole /buttonrole /verifypanel
Social         /suggest /suggestion /poll
Utility        /help /ping /userinfo /avatar /serverinfo /roleinfo /channelinfo /emojis
               /botinfo /afk /snipe /timestamp /weather /dictionary /github /stats /search
               /embed
Fun            /8ball /coinflip /dice /rps /trivia /joke /meme /animal /choose /ship
               /roast /compliment /game /rate
Tags           /tag get|create|edit|delete|list|random|info · /autoresponder add|remove|list
Reminders      /remind set|list|cancel
Context menus  User Info · Avatar · Bookmark Message · Report Message · Copy Message ID
AI             /ai ask|reset
```

> Discord caps an app at **100 top-level commands** — no app can exceed that, it is
> a hard platform limit. This bot uses **all 100** and packs the rest into
> **subcommands**: 109 of them, so **209 distinct slash entries** are reachable.
> The cap counts only the first word you type, not `/ticketconfig type-add`.
> Need more surface area? Add subcommands to existing commands instead of new commands.

### Ticket types — different buttons, names, titles and categories

The ticket system is not a single hard-coded button. Admins can define up to 25
**named types**, each with its own button text, emoji, embed title, welcome text,
colour, category, staff role and channel-name format.

```bash
# default category + staff role
/ticketconfig category category:#Support
/ticketconfig staff role:@Staff

# three different kinds of ticket, each opening its own way
/ticketconfig type-add key:support label:"General help" emoji:❓ \
    title:"Support request from {user}" color:#5865f2

/ticketconfig type-add key:report label:"Report a player" emoji:🚨 color:#ed4245 \
    category:#Reports staff-role:@Moderators name-format:report-{count:3} \
    panel-description:"Report rule-breaking"

/ticketconfig type-add key:appeal label:"Ban appeal" emoji:⚖️ color:#faa61a \
    category:#Appeals name-format:appeal-{user}

# how panel channels are named (tokens: {count} {count:4} {user} {type} {key})
/ticketconfig name-format format:ticket-{count:4}

# panel look: title, description, colour, footer, buttons vs dropdown
/ticketconfig panel title:"🎫 Contact the staff" color:#5865f2 style:menu

/ticketpanel channel:#support
```

Inside a ticket, messages also support tokens — `{user}`, `{username}`,
`{server}`, `{count}`, `{type}`, `{id}`:

```bash
/ticketconfig message open:"Hi {user}, a **{type}** was opened for you." \
                      close:"Closed by staff. Thanks!" ping-staff:true dm-transcript:true
```

`/ticket` gives the owner and staff `add`, `remove`, `rename` and `close`
(closing posts a transcript, DMs it to the opener if enabled, logs it, then
deletes the channel).

---

## Quick start (5 minutes)

```bash
# 1. install
git clone <your-repo> nexus-bot && cd nexus-bot
npm install

# 2. configure
cp .env.example .env      # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_IDS

# 3. create the database (file-based, nothing to provision)
npm start                 # first run creates ./data/bot.db automatically

# 4. register slash commands (in another terminal)
npm run deploy:commands
```

### Discord Developer Portal checklist

1. **New Application** → copy **Application ID** (→ `DISCORD_CLIENT_ID`).
2. **Bot** → *Reset Token* → copy it (→ `DISCORD_TOKEN`).
3. **Bot → Privileged Gateway Intents** → enable **all three**:
   - `SERVER MEMBERS INTENT` — joins/leaves, autorole, moderation
   - `MESSAGE CONTENT INTENT` — automod, XP, autoresponders, snipe
   - `PRESENCE INTENT` — not used by this bot, but harmless
4. **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`, permissions
   `Administrator` (or hand-pick: Manage Roles, Manage Channels, Kick, Ban, Moderate Members,
   Manage Messages, Read Message History, Connect, Speak).
5. Invite the bot, then **drag its role above every role it must manage.**

Then in your server, run these once:

```
/setlogs modlog:#mod-log messages:#message-log members:#member-log voice:#voice-log server:#server-log
/setwelcome channel:#welcome
/setgoodbye channel:#goodbye
/autorole human:@Member
/automod toggle module:Automod (master switch) state:true
/starboard setup channel:#starboard
/ticketconfig category:🎫 Support staff:@Staff log:#ticket-logs
/ticketpanel
/settings          ← verify everything at a glance
```

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Bot token |
| `DISCORD_CLIENT_ID` | ✅ | — | Application ID |
| `GUILD_IDS` | – | — | Comma-separated; registers commands instantly in *only those* servers. **Leave empty for a multi-server bot** — global commands work everywhere the bot is invited. Read at registration time only; the running bot never uses it |
| `OWNER_IDS` | – | — | Bypass cooldowns |
| `DB_PATH` | – | `./data/bot.db` | Point at a mounted volume in production |
| `PORT` | – | — | Enables the `/health` JSON endpoint (Render/Fly need it) |
| `PRESENCE` / `PRESENCE_STATUS` | – | `/help • Nexus` / `online` | Status text |
| `MUSIC_ENABLED` | – | `true` | Set `false` to disable music entirely |
| `YTDLP_PATH` / `FFMPEG_PATH` | – | `yt-dlp` / `ffmpeg` | Override if not on `PATH` |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | – | — | Any OpenAI-compatible API; enables `/ai` |
| `FEATURE_LEVELS` / `FEATURE_ECONOMY` / `FEATURE_AUTOMOD` | – | `true` | Quick kill switches |

`.env` is only read locally — every host sets these as real environment variables.

---

## Deploying

### Render (what you asked about)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** (uses `render.yaml`) or **New → Web Service → Docker**.
3. Add the secret env vars (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_IDS`).
4. Keep the **disk mounted at `/data`** and `DB_PATH=/data/bot.db`.
   The free plan has no disk — your database will reset on every deploy.
5. After the first deploy, run `npm run deploy:commands` locally once (it only needs the token,
   not the host).

### Registering commands for many servers

Guild registration is instant but scoped to one server. Global registration works
in every server the bot joins, but takes up to an hour to propagate and is
rate-limited — so register once, not in a loop.

```bash
GUILD_IDS=11111111111111 npm run deploy:commands   # instant, test server only
npm run deploy:commands                            # global (GUILD_IDS empty in .env)
npm run deploy:global                              # force global even if GUILD_IDS is set
npm run deploy:clear-guild                         # remove stale per-guild copies
npm run deploy:clear-global                        # remove all global commands
```

If you registered per-guild while testing and later switch to global, the guild
copies stay behind and the client shows **duplicates** in that one server. Run
`npm run deploy:clear-guild` (with `GUILD_IDS` still set) to remove them.

### Free tier: keeping your data without a disk

Render's free plan has no persistent storage. Everything the bot knows — levels,
economy balances, warnings, tags, tickets, and all your `/settings` — lives in
`bot.db`, which is wiped whenever the container restarts (every deploy, and any
platform restart). This repo solves that without paying: the database is
snapshotted to a **private GitHub repo** every 10 minutes and pulled back on boot.

Set-up (2 minutes, no card):

1. Create an empty **private** repo, e.g. `nexus-backup`.
2. Go to `github.com/settings/tokens?type=beta` → **Generate new token**:
   - Repository access → *Only select repositories* → `nexus-backup`
   - Permissions → **Contents: Read and write**
   - Expiration → 90 days (set a reminder to rotate it)
3. In Render → your service → **Environment**, add:
   ```
   BACKUP_REPO = yourname/nexus-backup
   BACKUP_TOKEN = github_pat_...
   BACKUP_INTERVAL_MIN = 10
   ```
4. Redeploy.

What it does:

| Moment | Behaviour |
|---|---|
| Boot | If no local `bot.db`, downloads the newest snapshot |
| Every 10 min | `VACUUM INTO` a consistent copy, push to GitHub |
| SIGTERM / deploy | Final snapshot before exiting |
| No snapshot yet | Starts a fresh database, never crashes |

Worst case loss on a surprise restart is ~10 minutes of XP and coins, not
everything. Verify it is working by looking for these lines in the Render logs:

```
[backup] every 10 min → yourname/nexus-backup/bot.db (main)
[backup] snapshot #1 pushed (180 KB, interval)
```

The token only has Contents read/write on that one repo — it cannot touch your
code repo, and it is not your Discord token. If you ever upgrade to a paid
instance with a disk, delete the `BACKUP_*` variables and mount the disk instead.

> Want to see this proven rather than claimed? `npm run test:persist` snapshots
> a populated database against a fake GitHub API, deletes the file, restores it,
> and asserts that wallets, levels, warnings, tags and guild settings all
> survive. 13 assertions.

### Railway

New Project → Deploy from GitHub → it detects the `Dockerfile`. Add a **Volume** mounted at
`/data`, set `DB_PATH=/data/bot.db` and the secrets. Done.

### Fly.io

```bash
fly launch --no-deploy        # accept the included fly.toml
fly volumes create nexus_data --size 1
fly secrets set DISCORD_TOKEN=... DISCORD_CLIENT_ID=... GUILD_IDS=...
fly deploy
```

### VPS / any Docker host

```bash
cp .env.example .env && nano .env
docker compose up -d --build
docker compose logs -f
```

### Bare metal / PM2

```bash
npm install --omit=dev
npm i -g pm2
pm2 start src/index.js --name nexus
pm2 save && pm2 startup
```

Install `ffmpeg` and `yt-dlp` (`pipx install yt-dlp`) if you want music.

---

## Testing (no Discord token needed)

```bash
npm test          # all three of the below
npm run check     # validates every command against Discord's schema limits
npm run test:db   # 57 assertions over the database layer + helpers
npm run test:persist  # 13 assertions: snapshot -> wipe -> restore round trip
npm run test:cmds # executes ~47 commands against a fake interaction
```

`npm run check` catches things Discord would reject at registration time: duplicate names,
descriptions over 100 characters, missing options, exceeding the 100-command cap.

`npm run test:cmds` is the interesting one — it drives real command handlers with a mock
interaction object, so a typo in `/balance` fails here rather than in your server.

---

## Project structure

```
nexus-bot/
├── src/
│   ├── index.js              bootstrap: restore DB, then hand off to app.js
│   ├── app.js                client, intents, events, health server
│   ├── config.js             env parsing + validation
│   ├── db.js                 SQLite schema + typed helpers
│   ├── deploy-commands.js    registers slash commands
│   ├── commands/
│   │   ├── index.js          registry (commands + component handlers)
│   │   ├── moderation.js     bans, kicks, warns, purge, channel control
│   │   ├── config.js         /settings, /automod, /setlogs, /starboard …
│   │   ├── levels.js         XP, ranks, role rewards, level-up handler
│   │   ├── economy.js        wallet, bank, dailies, gambling, robberies
│   │   ├── music.js          /play and friends
│   │   ├── tickets.js        panel, private channels, transcripts
│   │   ├── giveaways.js      timed giveaways + entry buttons
│   │   ├── roles.js          reaction roles, button panels, verification
│   │   ├── social.js         suggestions + polls
│   │   ├── utility.js        info, lookup and quality-of-life commands
│   │   ├── fun.js            games and nonsense
│   │   ├── tags.js           snippets + autoresponders
│   │   ├── reminders.js      scheduled pings
│   │   ├── context.js        right-click menus
│   │   └── ai.js             optional LLM chat
│   ├── events/               gateway event handlers
│   └── lib/                  embeds, helpers, logging, scheduler, music engine,
│                             persist.js (GitHub-backed database snapshots)
├── scripts/                  validate.js, smoke.js, test-commands.js
├── Dockerfile · render.yaml · fly.toml · docker-compose.yml
└── data/                     SQLite lives here (git-ignored)
```

Design notes worth knowing:

- **Everything is in SQLite.** One file, no server to provision, survives restarts. Back it up
  by copying `bot.db`.
- **Delayed work is DB-backed.** Reminders and giveaway endings are polled every 15 s, so a
  redeploy mid-giveaway does not lose it. Temp bans are stored as scheduled tasks.
- **Component routing** uses longest-prefix matching on `custom_id`, so `sug:up:12`,
  `ticket:open` and `br:msgId:roleId` all work without a central registry of exact ids.
- **No circular imports.** The command registry is attached to `client.commands`, and command
  modules never import each other (except `context.js`, which reuses one embed builder).

---

## Honest limitations

- **Music is the fragile part.** It depends on yt-dlp tracking YouTube changes. If `/play`
  suddenly fails, rebuild the image (new yt-dlp) and it usually fixes itself. For a serious
  music setup, add a Lavalink node — the command layer here is easy to point at one.
- **SQLite is single-process.** Perfect for one bot process; do not run two replicas against
  the same file.
- **The GitHub backup is a backup, not a database.** Snapshots are every 10 minutes by default
  (`BACKUP_INTERVAL_MIN`), so a crash can lose that window. Push it to 2 minutes if you care;
  GitHub allows it, you will just generate more commits.
- **Levels/XP ignore bots, DMs and command channels** — there is no anti-farm cooldown beyond
  the configured XP cooldown.
- **Rob/robbery is not fully transactional** across two users, though every balance change is a
  single atomic statement.
- **`/purge` caps at 500 messages per call** and cannot touch anything older than 14 days —
  that is a Discord API restriction, not a choice.
- **Tickets store transcripts as plain text** (`.txt` in the log channel), not HTML.
- **No web dashboard.** Everything is Discord-side by design; adding one would mean a second
  service.

---

## Licence

MIT — do what you want. No warranty; you are running a bot with `Administrator` permissions, so
read the moderation code before you hand it to a community.
