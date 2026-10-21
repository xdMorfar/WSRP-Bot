# Dependency Choices (checked 2026-10-21)

This build intentionally uses maintained/current major versions rather than old Discord bot examples.

- **Node.js 24 LTS** — deployment target. Official release information: https://nodejs.org/en/blog/release
- **discord.js 14.27.0** — maintained Discord library with TypeScript declarations: https://www.npmjs.com/package/discord.js and https://discord.js.org/
- **Mongoose 9.x** — current MongoDB object-modeling major: https://mongoosejs.com/docs/ and https://www.npmjs.com/package/mongoose
- **Discord privileged intents guidance** — Server Members and Message Content are privileged intents and must be enabled when used: https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents

The optional ER:LC API is intentionally not implemented in this release. No undocumented endpoints are guessed or hard-coded. If an official/supported integration is added later, its documentation and access level must be checked again at that time.
