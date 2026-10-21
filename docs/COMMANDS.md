# Command and Permission Reference

The **server owner** always has authority. Other access is controlled by role IDs configured in `/setup`.

| Command | Typical access | Purpose |
|---|---|---|
| `/setup` | Owner / configured admin | Guided persistent configuration |
| `/validate` | Owner / configured admin | Check configuration and bot permissions |
| `/dashboard publish` | Management | Main dashboard |
| `/dashboard applications` | Management | Melonly application panel |
| `/dashboard tickets` | Management | Assistance/ticket panel |
| `/application configure/status/list` | Management | Manage external Melonly application entries |
| `/embed create/edit/save-template/from-template` | Management | Preview/publish custom embeds |
| `/announcement` | Management | Preview/confirm announcement |
| `/staff promote` | HR+ | Change configured staff rank upward |
| `/staff demote` | HR+ | Change configured staff rank downward |
| `/staff infraction` | IA+; termination requires Management | Staff discipline |
| `/staff profile` | Staff permission rules | Employment/rank summary |
| `/staff history` | IA+ | Staff disciplinary/action history |
| `/staff hierarchy` | Everyone | Configured chain of command |
| `/staff activity` | Management | Recorded actions and shift summary |
| `/warn`, `/warnings` | Moderation | Discord warning system |
| `/kick` | Moderation | Discord kick |
| `/ban` | Moderation + confirmation | Discord ban |
| `/unban` | Moderation | Discord unban |
| `/timeout`, `/untimeout` | Moderation | Discord timeout controls |
| `/purge` | Moderation; >20 requires confirmation | Bulk message cleanup |
| `/slowmode` | Moderation | Channel slowmode |
| `/lock`, `/unlock` | Moderation | Current channel send lock |
| `/lockdown start/end` | Management | Emergency server-wide lock/restore |
| `/case view/amend` | Moderation; staff discipline requires IA+, staff rank cases HR+ | Audit case management |
| `/ticket close/claim/unclaim/add/remove/transfer` | Creator/support as appropriate | Ticket management |
| `/ticket followup` | Original creator/support | Follow-up to closed ticket |
| `/session start/end` | Management | Roleplay session state |
| `/session vote/status` | Everyone | Session participation/status |
| `/suggest` | Everyone | Submit suggestion |
| `/suggestion status` | Management | Manage suggestion workflow |
| `/loa request/status` | Everyone / staff use | Leave of absence workflow |
| `/shift clockin/clockout/status` | Staff use | Persistent staff shift timer |
| `/remind` | Everyone | Private persistent reminder |
| `/automod ...` | Management | AutoMod configuration |
| `/balance`, `/daily`, `/work`, `/pay`, `/leaderboard` | Everyone if economy enabled | Fictional server economy |
| `/economy adjust` | Management | Audited balance adjustment |
| `/help` | Everyone | Permission-aware help |

## Staff hierarchy behavior

The configured `staffRanks` array is the bot's authoritative staff rank order. A higher numeric level means higher authority. In addition to configured action permissions, the actor's highest Discord role must be above the target's highest Discord role. The server owner is the only automatic hierarchy bypass.

The bot role itself must also be above every role it needs to manage.
