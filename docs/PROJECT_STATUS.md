# Project Status

## Implemented in this repository

The core Discord bot described in the supplied specification is implemented: MongoDB-backed setup/configuration, persistent dashboard panels, Melonly-only application panels, staff hierarchy/actions, moderation cases, ticketing/transcripts, AutoMod, emergency lockdown, ER:LC session management, suggestions, LOA, shifts, reminders, announcement/embed builders, and the optional disabled-by-default fictional economy.

Destructive confirmation buttons re-check the user's configured permissions at confirmation time. Staff termination/rank/suspension flows preserve audit records and include rollback/failure-state handling for role changes. Staff disciplinary evidence is restricted from public announcements and staff-disciplinary case access is limited to IA/management permissions.

## Intentionally not connected

The bot does not call an ER:LC API in this release. Core session information is manually configured. `ERLC_API_KEY` is only reserved for a future integration that should be implemented against the then-current official ER:LC documentation and the server's actual API access level.

Applications are links to Melonly only; there is no application submission/review database or Melonly API integration.

## Verification state

The source has been syntax-checked locally, but the artifact-generation environment could not download npm packages, so a dependency-aware TypeScript build and a live Discord/MongoDB integration test must be run after download. See `docs/VERIFICATION.md` for the exact production checklist.
