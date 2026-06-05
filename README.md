# Vibehall Backend

## Purpose
This directory is the backend application base for Vibehall.

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

## Contract Inputs
Backend implementation must follow:
- `../Roads/project-foundation/02-system-definition/rest-contract-v1.md`
- `../Roads/project-foundation/02-system-definition/websocket-contract-v1.md`
- `../Roads/project-foundation/02-system-definition/shared-contract-v1.md`

## Current Wave Status
Wave 3 adds the PostgreSQL + Prisma foundation, `users` and `categories` schema, auth routes, account-state checks, protected access, profile routes, and public category reads.

Room, participant, message, moderation, and admin feature routes begin in later waves.

## Wave 3 Commands
Use `npm.cmd` on Windows PowerShell if `npm.ps1` is blocked.

- `npm.cmd run prisma:validate`
- `npm.cmd run prisma:generate`
- `npm.cmd run prisma:migrate`
- `npm.cmd run prisma:seed`
- `npm.cmd run build`
- `npm.cmd run typecheck`

Prisma validation and migration require `DATABASE_URL`.
