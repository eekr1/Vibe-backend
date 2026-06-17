# Vibehall Backend

## Purpose
This directory is the backend application base for Vibehall.

This directory is also the standalone backend Git repository. The parent `Vibehall/`
folder is a local workspace only and is not required for backend build or deploy.

Planned stack:
- Fastify
- TypeScript
- PostgreSQL
- Prisma
- Socket.IO

## Responsibilities
The backend owns:
- API server runtime
- authentication and protected access
- user and account state handling
- room lifecycle and room access decisions
- discover query behavior
- chat persistence
- realtime room coordination
- moderation and report persistence
- admin reads and actions

## Repository Boundary
This repo should stay self-contained for GitHub, Render, and local backend work.

Use this repo's own scripts for build, Prisma, and deploy:
- `npm.cmd run dev`
- `npm.cmd run build`
- `npm.cmd run typecheck`
- `npm.cmd run prisma:generate`
- `npm.cmd run prisma:migrate`
- `npm.cmd run prisma:seed`

Canonical product and roadmap documents may exist one folder above in the local
workspace at `../Roads/project-foundation/`, but they are not part of this Git
repository and should not be required by CI or deployment.

## Current Wave Status
Wave 15 adds production discipline: migration deploy scripts, explicit staging-vs-production database preparation, environment documentation, release smoke tests, and rollback guidance.

The first full build wave sequence and post-wave MVP stabilization waves are complete. Production readiness now depends on controlled deployment, migration verification, admin account control, and manual regression verification.

## Environment Variables
Required in production:
- `NODE_ENV=production`
- `PORT` from Render, usually provided automatically.
- `LOG_LEVEL=info`
- `CORS_ORIGIN=https://your-frontend.onrender.com`
- `DATABASE_URL=postgresql://...`
- `SESSION_SECRET=<strong generated secret>`

Admin bootstrap variables:
- `ADMIN_BOOTSTRAP_SECRET` should normally be unset after the intended admin account exists.
- `ADMIN_BOOTSTRAP_ALLOW_AFTER_ADMIN_EXISTS=false` should remain the normal value.
- Only set `ADMIN_BOOTSTRAP_ALLOW_AFTER_ADMIN_EXISTS=true` temporarily for emergency recovery.

## Render Commands
Recommended backend Render settings:
- Root Directory: `Vibe backend`
- Build Command: `npm install && npm run render:build`
- Production Start Command: `npm run render:start:production`
- Staging Convenience Start Command: `npm run render:start:staging`
- Default Start Command: `npm start` also runs the staging preparation helper for the current staging database setup.

Production note:
- `render:start:production` runs `prisma migrate deploy` before starting the server.
- `render:start:staging` runs the legacy `db push` based preparation helper and is only for temporary staging convenience.
- `npm start` and `render:start` intentionally point to `render:start:staging` while the current Render database is still staging-style.
- Do not point a real production service at `render:start:staging`.

Existing staging database note:
- If a database was previously prepared with `prisma db push`, do not blindly switch it to `migrate deploy`.
- Use a fresh production database or intentionally baseline the existing database before adopting migration deploy.
- Treat this as a release gate, not a cosmetic script change.

## Migration Discipline
Use these commands intentionally:
- `npm.cmd run prisma:validate` validates the schema.
- `npm.cmd run prisma:generate` regenerates Prisma Client.
- `npm.cmd run prisma:migrate` creates/applies local development migrations.
- `npm.cmd run prisma:migrate:deploy` applies committed migrations in production-style environments.
- `npm.cmd run prisma:seed` seeds controlled category data only when intended.

Production rule:
- Schema changes must become committed files under `prisma/migrations/`.
- Production deploys should apply committed migrations with `prisma migrate deploy`.
- `prisma db push` is not the production migration strategy.

## Admin Bootstrap Safety
`ADMIN_BOOTSTRAP_SECRET` can promote an existing user to admin through `/api/admin/bootstrap`.

Bootstrap is intentionally locked after at least one active admin exists.

For emergency recovery only, set:
- `ADMIN_BOOTSTRAP_ALLOW_AFTER_ADMIN_EXISTS=true`

Recommended operating rule:
- Keep `ADMIN_BOOTSTRAP_SECRET` unset unless you are intentionally creating or recovering an admin.
- If recovery override is needed, enable it temporarily, promote the account, redeploy without the override, and rotate the secret.
- Do not leave the recovery override enabled in normal staging or production use.

## Verification Commands
Use `npm.cmd` on Windows PowerShell if `npm.ps1` is blocked.

- `npm.cmd run prisma:validate`
- `npm.cmd run prisma:generate`
- `npm.cmd run prisma:migrate`
- `npm.cmd run prisma:migrate:deploy`
- `npm.cmd run prisma:seed`
- `npm.cmd run build`
- `npm.cmd run typecheck`

Prisma validation and migration require `DATABASE_URL`.
