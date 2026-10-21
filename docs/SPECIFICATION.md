Build a complete, production-ready Discord bot for **Wisconsin State Roleplay**, a private server in the Roblox game **Emergency Response: Liberty County (ER:LC)**.

The bot must have working features, persistent data, proper permissions, and polished embeds with buttons, dropdowns, and modals. All member-facing text must be in **English**.

**Applications are handled through Melonly. The bot should only create application information embeds with configurable link buttons leading to my Melonly applications. Do not build an application submission or review system.**

## 1. Design and branding

Create a consistent, professional visual style:

- Wisconsin State Roleplay branding.
- Dark blue as the main color.
- Green, amber, and red for appropriate status messages.
- Configurable logo, banners, thumbnails, and footers.
- Clear headings, readable spacing, and well-organized information.
- Minimal emojis.
- Natural, professional wording without excessive decoration.
- Consistent formatting across dashboards, tickets, staff announcements, and moderation.

If reference screenshots are available, use them to guide the layout and visual style while adapting the branding to Wisconsin State Roleplay.

Sensitive information must appear only in private responses or restricted channels.

## 2. Configuration and setup

Provide a guided `/setup` command restricted to the server owner and explicitly authorized administrators.

Allow configuration of:

- Staff roles and their rank order.
- Ownership, management, HR, Internal Affairs, and moderation permissions.
- Channels for announcements, tickets, staff actions, and logs.
- Ticket categories and their assigned support teams.
- Dashboard content, images, and link buttons.
- Melonly application URLs.
- ER:LC private-server name and join code.
- Automod settings and exemptions.
- Optional economy and ER:LC integration.

Use role and channel IDs instead of relying on names.

Provide a setup validation command that identifies missing configuration, invalid channels, and insufficient bot permissions.

Settings must persist after restarts and be editable without changing source code.

## 3. Dashboard embeds and embed builder

Create a Discord dashboard consisting of polished, persistent information embeds.

Include ready-to-customize panels for:

- Server Information
- Discord Rules
- In-Game Rules
- Applications
- Tickets and Support
- Staff Information
- Chain of Command
- Session Information
- Useful Links

Provide an administrator-only embed builder with support for:

- Title and description.
- Color.
- Fields.
- Thumbnail and banner image.
- Footer.
- Configurable link-button labels and URLs.
- Destination channel.
- Preview before publishing.
- Editing previously published panels.
- Saving reusable templates.

Save published message IDs so panels can be updated without creating duplicates.

Support configurable buttons linking to Melonly, Roblox, rules pages, department resources, and other URLs I provide.

Never publish fake or placeholder links. Omit unconfigured buttons and explain what is missing in the administrator preview.

Use buttons or dropdowns to display additional information privately where useful.

An optional rules-acceptance button may assign a configured member role.

A separate website is not required.

## 4. Application panels — Melonly links only

All applications will take place through **Melonly**.

The bot must create application embeds containing:

- Application title.
- Description.
- Requirements.
- Optional instructions.
- Manually configured open or closed status.
- A link button leading to the Melonly application URL I set.

Support multiple application panels, such as:

- Staff Applications
- Department Applications
- Internal Affairs Applications

Administrators must be able to change the text, button labels, URLs, images, and displayed status through Discord commands or configuration menus.

When a panel is marked closed, remove its application link button and display a clear closed message. Restore the configured link when reopened.

The displayed status is manually managed unless a supported integration is explicitly added later.

**Do not implement application questions, submission forms, applicant records, reviews, accept/deny buttons, acceptance role assignment, or application decision DMs. No Melonly API integration is required; these are configurable external links.**

## 5. Staff promotions, infractions, and terminations

Create a persistent staff-management system.

### Promotions and demotions

Provide:

- `/staff promote`
- `/staff demote`

Record:

- Staff member.
- Previous rank.
- New rank.
- Reason.
- Issuing manager.
- Timestamp.
- Unique case ID.

Automatically update the configured staff rank roles while preserving unrelated roles.

Publish a professional announcement in the configured channel and notify the member by DM when possible.

### Infractions

Provide `/staff infraction` with configurable types:

- Verbal Warning
- Written Warning
- Strike
- Suspension
- Demotion
- Termination

Record the member, type, reason, evidence links, issuer, timestamp, and optional expiry.

Authorized staff must be able to view, correct, and revoke infractions. Preserve an audit trail rather than silently deleting records.

Suspensions must follow a configurable role policy. On expiry, restore only roles affected by the suspension, and only if later rank changes or termination do not override it.

### Terminations

Termination must be available **under the infraction system**, with its own distinct embed and announcement format.

Before execution, show a confirmation listing the member and roles that will be removed.

When confirmed:

- Remove every role explicitly configured as staff-related.
- Include applicable staff rank, staff access, and staff division roles.
- Preserve unrelated member and cosmetic roles.
- Record the reason, evidence, issuer, and removed roles.
- Publish the configured termination announcement.
- Notify the member by DM when possible.

Support an optional internal rehire-ineligible flag with a reason and expiry. Make clear that this does not automatically restrict applications on Melonly.

### Staff profiles and hierarchy

Provide:

- `/staff profile`
- `/staff history`

Show employment status, rank, promotions, and disciplinary history according to the viewer’s permissions.

Enforce the configured command hierarchy:

- No self-promotions.
- No disciplinary actions against equal or higher ranks.
- No granting ranks beyond the issuer’s authority.
- Separate permissions for promotions, infractions, suspensions, and terminations.

Keep confidential evidence out of public announcements.

## 6. Discord moderation

Implement:

- `/warn`
- `/warnings`
- `/kick`
- `/ban`
- `/unban`
- `/timeout`
- `/untimeout`
- `/purge`
- `/slowmode`
- `/lock`
- `/unlock`
- `/case view`
- `/case amend`

Every moderation action must include:

- Permission and hierarchy checks.
- A reason.
- A unique case ID.
- A timestamp.
- An audit record.
- Optional evidence where appropriate.

Notify affected users when possible. Failed DMs must not block the action.

Require confirmation for bans and large purges.

Clearly distinguish Discord punishments from ER:LC in-game punishments. A Discord ban must not be presented as an ER:LC ban.

## 7. Tickets

Create a configurable ticket panel with categories such as:

- General Support
- Player Report
- Staff Report / Internal Affairs
- Punishment Appeal
- Partnership Request

Features:

- Private channels or private threads.
- Category-specific intake questions.
- Assigned support roles.
- Claim and unclaim.
- Transfer between support teams.
- Add or remove participants through authorized staff controls.
- Close with a reason and confirmation.
- Ticket IDs and timestamps.
- HTML or text transcripts.
- Restricted transcript storage.
- Optional transcript delivery to the ticket creator when appropriate.
- Limits on simultaneous open tickets.
- Ticket creation cooldowns.
- Configurable inactivity reminders and automatic closure.
- Reopening where supported, or a linked follow-up ticket.

Staff reports must be restricted to the configured IA or management team and necessary administrators. Do not claim these tickets are hidden from Discord administrators.

Ticket creators must not be able to change access permissions or view other users’ tickets.

## 8. Automod and server protection

Provide configurable protection against:

- Message spam.
- Repeated messages.
- Mention spam.
- Unapproved Discord invites.
- Blocked words.
- Blocklisted or suspicious links using a maintainable detection source.
- Rapid join activity.

Support:

- Role and channel exemptions.
- Configurable thresholds.
- Cooldowns.
- Warning, deletion, and timeout actions.
- Escalation rules.
- Logs showing which rule triggered.

Use Discord’s native AutoMod where appropriate.

Provide a restricted emergency lockdown command that saves existing channel permissions and restores them when unlocked.

Do not automatically mass-ban members based only on account age or a join spike.

## 9. ER:LC session management

Implement:

- `/session start`
- `/session end`
- `/session vote`
- `/session status`

Session announcements should support:

- Wisconsin State Roleplay branding.
- Server name and join code.
- Host.
- Start time.
- Configurable notification role.
- Join instructions.
- Session rules.
- Vote threshold and cooldown.

Prevent duplicate active sessions, duplicate votes, and repeated notification spam.

Persist session state across restarts.

### Optional ER:LC API integration

If an API key is provided, consult current official documentation before implementing any integration.

Only implement supported capabilities available to the server’s access level, potentially including:

- Server status.
- Player counts.
- Server logs.
- Authorized in-game commands.

Handle rate limits, downtime, invalid credentials, and missing permissions.

Never invent API endpoints or show fabricated live information.

Core Discord functionality must work without an ER:LC API key. Clearly identify manually configured information.

## 10. Additional useful features

Include:

- Welcome messages and configurable join roles.
- Suggestions with voting and management statuses.
- Announcement builder with preview and publish confirmation.
- Staff leave-of-absence requests with approval and expiry.
- Persistent staff shift clock-in and clock-out.
- Staff activity summaries based on recorded actions.
- Configurable reminders.
- Moderation and staff disciplinary appeals.
- `/help` showing commands relevant to the user’s permissions.

Do not automatically promote staff based only on message counts or shift hours.

## 11. Optional economy

Only add economy after the core systems are complete. Keep it disabled by default.

Possible features:

- Balance.
- Daily reward.
- Work command with cooldown.
- Transfers.
- Leaderboard.
- Configurable shop.
- Administrative balance adjustments with reasons and logs.

Use fictional server currency only. It must not claim to synchronize with ER:LC money or Roblox Robux.

Prevent negative balances, duplicate rewards, concurrent-transfer exploits, and cooldown resets after a restart.

No gambling or real-money purchases.

## 12. Technical requirements

Use **TypeScript, Node.js, and a maintained Discord library**, with **MongoDB** for persistent storage.

Check current official documentation when choosing versions and implementing features.

Requirements:

- Modular commands, interactions, services, database models, and configuration.
- Slash commands, buttons, dropdowns, and modals.
- Persistent panels that continue working after restarts.
- Server-side permission checks on every interaction.
- Correct Discord role hierarchy checks.
- Protection against duplicate actions from repeated clicks.
- Clear handling of partially completed role changes.
- Persistent timed actions with recovery after downtime.
- Proper Discord rate-limit handling.
- Compliance with embed, message, and component limits.
- User-friendly errors and structured diagnostic logs.
- Prevention of unintended mentions in user-submitted text.
- Configurable retention for tickets, evidence, and staff records.
- Only the permissions and gateway intents actually required.

Store tokens, database credentials, and API keys in environment variables. Never expose them in messages, source code, or logs.

Include `.env.example` with placeholders.

## 13. Delivery and verification

Deliver:

1. Complete source code.
2. Clear folder structure.
3. Dependency and build configuration.
4. `.env.example`.
5. Installation instructions.
6. Discord bot setup and permissions instructions.
7. MongoDB setup instructions.
8. Deployment instructions for a continuously running Node.js host.
9. Command and permissions reference.
10. A concise verification checklist.

Verify the important workflows:

- Permission checks and rank hierarchy.
- Promotions and demotions.
- Termination role removal.
- Ticket privacy.
- Embed creation and editing.
- Configurable external link buttons.
- Manually opening and closing Melonly application panels.
- Duplicate interaction handling.
- Restart recovery.
- Timed suspensions and reminders.

Clearly distinguish locally tested functionality from features requiring a live Discord server or ER:LC API credentials.

Do not present unfinished features as complete. Make sensible decisions where details are unspecified and ask only for information that genuinely blocks implementation.

Prioritize a reliable, polished bot with useful administration tools and professional Discord embeds.