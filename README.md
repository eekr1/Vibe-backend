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
Wave 9 adds admin-only APIs for overview, users, rooms, reports, moderation history, category management, report review, and account-state management.

The first full build wave sequence is complete. Release readiness now depends on migration, environment, deploy, and manual regression verification.

## Wave 9 Commands
Use `npm.cmd` on Windows PowerShell if `npm.ps1` is blocked.

- `npm.cmd run prisma:validate`
- `npm.cmd run prisma:generate`
- `npm.cmd run prisma:migrate`
- `npm.cmd run prisma:seed`
- `npm.cmd run build`
- `npm.cmd run typecheck`

Prisma validation and migration require `DATABASE_URL`.
