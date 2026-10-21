# Security Notes

## Secrets

Keep these only in environment variables:

- `DISCORD_TOKEN`
- `MONGODB_URI`
- future ER:LC API credentials

Never commit `.env`.

## MongoDB

Use a dedicated database user with only the privileges this bot needs. Restrict Atlas network access to your hosting environment when practical. Rotate the password if it is ever exposed.

## Discord permissions

The bot uses server-side role ID checks in addition to Discord permissions. Do not rely on command visibility alone for security.

`GuildMembers` and `MessageContent` are intentionally the only privileged gateway intents used by this build. They support welcome/join roles, member hierarchy logic, rapid-join detection and custom AutoMod message filtering. Presence data is not requested.

## Destructive actions

Ban, large purge and staff termination use a persistent confirmation record with a one-time token. The pending record is atomically marked consumed before execution to reduce duplicate-click execution. If execution throws, the consumed marker is cleared so the authorized actor can safely retry.

Emergency lockdown changes only message-send state for `@everyone` and stores the previous overwrite state in MongoDB for restoration.

## User-supplied text

Utility functions neutralize `@everyone`, `@here`, and direct role mention syntax in user-supplied text where the bot republishes it. Messages also default to `allowedMentions: { parse: [] }` unless an intentional configured role/user ping is required.
