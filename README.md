# Wisconsin State Roleplay Bot

A TypeScript / Node.js Discord bot for **Wisconsin State Roleplay**, a private ER:LC roleplay community. It is designed around the supplied Springfield-style reference screenshots while using configurable Wisconsin State Roleplay branding, dark-blue embeds, persistent MongoDB data, buttons, dropdowns and modals.

The original build specification is included in `docs/SPECIFICATION.md`. The supplied screenshots are included in `docs/reference-style/` as **layout/style references only**; the bot does not publish Springfield branding unless you deliberately configure those image URLs yourself.

## What is implemented

Core systems included in this repository:

- Guided `/setup` using private Discord modals; all settings persist in MongoDB.
- `/validate` configuration and permission checks.
- Persistent main dashboard, ticket panel, and Melonly-only application panel.
- Application information entries with manual open/closed status and external Melonly link buttons. The bot **does not** collect or review applications.
- Custom embed builder with preview/confirmation, persistent message editing, link buttons and reusable templates.
- Staff rank hierarchy, promotions, demotions, staff profiles and staff history.
- Staff infractions: verbal warning, written warning, strike, suspension, demotion record and termination.
- Termination confirmation with a preview of staff-related roles that will be removed.
- Timed staff suspension expiry with restart recovery.
- Discord moderation: warn, warnings, kick, ban, unban, timeout, untimeout, purge, slowmode, channel lock/unlock, case view/amend/revoke.
- Separate Discord moderation cases and staff disciplinary cases.
- Tickets with category intake modals, restricted access, claim/unclaim, add/remove participants, transfer, close confirmation, HTML transcripts, inactivity reminders/auto-close, and follow-up tickets.
- AutoMod protection for spam, repeated messages, mention spam, Discord invites, blocked terms/domains and rapid-join alerts.
- Emergency server lockdown that stores and restores channel permission state.
- ER:LC session start/end/vote/status with persistent state.
- Suggestions with votes and management statuses.
- Welcome messages and a configured join role.
- Staff leave-of-absence requests with approval/denial, optional LOA role, expiry and restart recovery.
- Persistent staff clock-in/clock-out and activity summary.
- Persistent private reminders.
- Announcement builder with preview and confirmation.
- Optional fictional economy, disabled by default: balance, daily, work, transfer, leaderboard and audited admin adjustments.
- Structured MongoDB audit records and unique case/ticket/suggestion IDs.

### Deliberately not implemented

- No application form/review system. Applications are external Melonly links only.
- No fake ER:LC live data. `ERLC_API_KEY` is reserved for a later supported integration; this release does **not** call undocumented ER:LC endpoints.
- No mass-ban-on-join-spike behavior.
- No automatic staff promotion from message counts or shift time.
- No gambling or real-money economy features.

## Runtime versions

The project targets **Node.js 24 LTS** and uses `discord.js 14.27.0` plus MongoDB through Mongoose 9. Node 24 is the recommended deployment runtime for this repository.

## 1. Create the Discord bot

1. Open the Discord Developer Portal and create an application.
2. Create a bot user and copy the bot token.
3. In **Bot → Privileged Gateway Intents**, enable:
   - **Server Members Intent** — needed for welcome/join roles, hierarchy/member lookups and rapid-join detection.
   - **Message Content Intent** — needed for the custom message AutoMod filters.
4. Invite the bot with scopes:
   - `bot`
   - `applications.commands`
5. Give the bot only the permissions the enabled features need. A practical set for the full feature set is:
   - View Channels
   - Send Messages
   - Embed Links
   - Attach Files
   - Read Message History
   - Manage Messages
   - Manage Channels
   - Manage Roles
   - Moderate Members
   - Kick Members
   - Ban Members
6. Move the bot's Discord role **above every staff/join/LOA role it needs to add or remove**.

The bot itself performs additional server-side checks before every sensitive action. The server owner is always trusted. Additional administrators must be explicitly configured in `/setup` (or temporarily included in `BOOTSTRAP_ADMIN_IDS`).

## 2. MongoDB Atlas

1. Create a MongoDB Atlas project/cluster.
2. Create a dedicated database user for this bot.
3. Configure Atlas Network Access for the IP range used by your host. Avoid leaving `0.0.0.0/0` enabled longer than necessary when your host provides stable egress addresses.
4. Copy the connection string and set it as `MONGODB_URI`.

Example database name:

```text
wisconsin_state_roleplay
```

MongoDB stores configuration, moderation/staff cases, ticket metadata, panel message IDs, session state, timed actions, suggestions, shifts, LOA requests and economy balances.

## 3. Environment variables

Copy `.env.example` to `.env` for local use. **Never commit `.env`.**

Required:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
MONGODB_URI=...
```

Recommended during initial setup:

```env
DISCORD_GUILD_ID=YOUR_SERVER_ID
REGISTER_COMMANDS=true
BOOTSTRAP_ADMIN_IDS=YOUR_USER_ID
```

Using a guild ID makes slash-command updates appear almost immediately. After the bot is stable, `BOOTSTRAP_ADMIN_IDS` can be emptied because the server owner and configured admin roles can manage setup.

## 4. Install and run locally

```bash
npm install
npm run build
npm start
```

Development mode:

```bash
npm run dev
```

Register commands without starting the full bot:

```bash
npm run deploy:commands
```

If `REGISTER_COMMANDS=true`, the bot also registers the command definitions on startup.

## 5. First Discord setup

Run:

```text
/setup
```

Recommended setup order:

1. Branding
2. Channels
3. Permissions & Staff Roles
4. Add each Staff Rank
5. Server / Session
6. Rules
7. Applications
8. Ticket Support Roles
9. AutoMod
10. Limits & Retention
11. `/validate`

IDs are used instead of names. Enable Discord Developer Mode, then right-click a user/role/channel/category and choose **Copy ID**.

For the channel setup modal, use `key=id` lines such as:

```text
dashboard=123456789012345678
announcements=123456789012345678
ticket-panel=123456789012345678
ticket-log=123456789012345678
ticket-parent=123456789012345678
staff-actions=123456789012345678
staff-log=123456789012345678
moderation-log=123456789012345678
session=123456789012345678
suggestions=123456789012345678
welcome=123456789012345678
```

For staff permission roles:

```text
admins=ROLE_ID
management=ROLE_ID
hr=ROLE_ID
ia=ROLE_ID
moderators=ROLE_ID
staff-access=ROLE_ID,ROLE_ID
staff-divisions=ROLE_ID,ROLE_ID
member=ROLE_ID
loa=ROLE_ID
session-ping=ROLE_ID
```

Staff ranks use a numeric level. Higher numbers mean greater authority. Example:

```text
Owner / Director = 100
Deputy Director = 90
Management = 80
Senior High Rank = 70
High Rank = 60
Senior Moderator = 40
Moderator = 30
Trial Moderator = 20
```

The bot blocks self-actions, actions against equal/higher staff ranks, and rank grants that exceed the issuer's configured authority.

## 6. Publish the main panels

Once branding and channels are ready:

```text
/dashboard publish
/dashboard applications
/dashboard tickets
```

The bot stores the Discord message IDs in MongoDB. Running the commands again **edits the tracked panel instead of intentionally creating duplicates** when the tracked message still exists.

### Melonly applications

Configure application entries through `/setup` or `/application configure`.

An open application must have a valid HTTP(S) URL. When you mark it closed, the published application panel omits the link button and shows the entry as closed. Re-run `/dashboard applications` to refresh the persistent published panel.

## 7. Custom embed builder

Example:

```text
/embed create key:training title:"Training Information" description:"..." channel:#information buttons:"Handbook|https://example.com;Melonly|https://example.com"
```

The command shows an **ephemeral preview** first. Nothing is published until the creator presses **Publish / Update**.

Fields use this compact format:

```text
Name|Value|true;Another field|Another value|false
```

Link buttons use:

```text
Label|https://url;Another Label|https://url
```

Invalid/unconfigured URLs are omitted instead of publishing placeholder links.

## 8. Hosting from GitHub

The repository is ready to push directly to GitHub.

Typical host workflow:

```bash
npm install
npm run build
npm start
```

Set the environment variables in the hosting panel instead of uploading a real `.env` file.

### Pterodactyl / generic Node host

- Runtime: Node.js 24
- Install command: `npm install && npm run build`
- Start command: `npm start`
- Working directory: repository root
- Persistent storage is not required for bot data because MongoDB is used, but keeping logs can still be useful.

### Docker host

```bash
docker build -t wsrp-bot .
docker run --env-file .env wsrp-bot
```

The included `Dockerfile` builds TypeScript and starts the compiled bot.

## 9. Security and operational notes

- Never put the Discord token, MongoDB password, or API keys into source code or Discord messages.
- The bot prevents `@everyone`, `@here`, and role mentions from user-supplied text where practical.
- Sensitive evidence is stored in case records and is not copied into public staff announcements.
- Staff-report ticket access is limited to configured roles, but Discord server administrators can always override channel permissions; the bot does not claim otherwise.
- Emergency lockdown saves channel permission state before changing it and restores that saved state on unlock.
- Rapid-join protection **alerts** staff; it does not ban users simply because many people joined quickly or because an account is new.
- Keep the bot role below ownership roles, but above roles it must manage.
- Periodically review MongoDB retention and delete old records according to your community policy.

## 10. Reference documentation

- `docs/COMMANDS.md` — command/permission reference
- `docs/VERIFICATION.md` — verification checklist and what still needs live testing
- `docs/DEPENDENCIES.md` — dependency/version choices checked against current official sources
- `docs/PROJECT_STATUS.md` — implemented scope, intentional exclusions, and verification state
- `docs/SECURITY.md` — security/deployment notes
- `docs/SPECIFICATION.md` — original supplied build specification
- `docs/reference-style/` — supplied Discord screenshot references
