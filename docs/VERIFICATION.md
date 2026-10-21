# Verification Checklist

## Repository-side verification performed

- Source tree and all required configuration files were generated.
- TypeScript source was passed through a local `tsc --noResolve` syntax check. No TypeScript parser/syntax errors were reported.
- Secret values are represented only by environment-variable placeholders.
- The supplied specification and screenshot references are included under `docs/`.

## Not locally executable in the generation environment

The generation sandbox could not complete `npm install` because outbound package installation timed out. Because of that, this repository has **not** been claimed as live-tested against Discord, MongoDB Atlas, or a real ER:LC server from inside the generation environment.

Before production use, perform the live checks below after `npm install` succeeds on your PC/host.

## Required live verification

- [ ] `npm install` completes using Node.js 24.
- [ ] `npm run build` completes with no TypeScript errors.
- [ ] Bot logs into the intended Discord guild.
- [ ] Slash commands register successfully.
- [ ] `/setup` only opens for owner/configured setup administrators.
- [ ] `/validate` reports no missing critical permissions/channels.
- [ ] Main dashboard publishes and later edits the same tracked message.
- [ ] Application panel never exposes a link while an application is closed.
- [ ] Open application buttons go to the exact configured Melonly URLs.
- [ ] Custom embed preview does not publish until confirmation.
- [ ] Promotion removes previous configured rank and assigns only the intended new rank.
- [ ] Actor cannot promote themself or target equal/higher staff.
- [ ] Termination confirmation accurately lists configured staff roles to remove.
- [ ] Termination preserves unrelated/cosmetic/member roles.
- [ ] Staff evidence is absent from public announcements.
- [ ] Timed suspension survives a bot restart and restores only eligible captured roles.
- [ ] A later rank change prevents an old suspended rank from being restored.
- [ ] Discord ban confirmation creates a Discord moderation case and does not describe it as an in-game ban.
- [ ] Repeated confirmation clicks do not execute the same destructive action twice.
- [ ] Ticket creator can see only their own ticket.
- [ ] Support roles can claim/manage only categories configured for them.
- [ ] Staff-report/IA ticket permissions are restricted to the configured roles plus Discord administrators.
- [ ] Ticket close creates an HTML transcript in the configured restricted log channel.
- [ ] Ticket inactivity reminder and auto-close work at the configured threshold.
- [ ] `/ticket followup` creates a new linked-context ticket from a closed ticket.
- [ ] AutoMod exemptions, spam, repeat, mention, invite and blocklist rules behave as configured.
- [ ] Rapid-join detection logs an alert without mass-banning users.
- [ ] `/lockdown start` and `/lockdown end` restore prior channel state correctly in a staging server.
- [ ] Session state survives bot restart.
- [ ] LOA expiry and reminders survive bot restart.
- [ ] Economy is disabled by default and transfers never produce a negative balance.

## Recommended staging process

Use a private test Discord guild first. Create dummy roles representing each staff rank and permission group. Place the bot role above all dummy managed roles, test every destructive workflow on test accounts, then copy the same ID-based configuration pattern into the production guild.
