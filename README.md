# SNCMT: School & College Management Technology

Next.js frontend + NestJS backend + PostgreSQL (Supabase). This first version covers:

- Public landing page, school registration (with logo upload) and a "Pending approval" page
- Platform admin panel: list schools waiting for approval and approve them
- Subdomain routing: `abc.sncmt.com` (or `abc.localhost:3000` on your PC) shows that school's login page with its logo
- School dashboard: sidebar, overview, and user management (admins, teachers, students, guardians, staff) with filters and profile pictures

Not built yet: fees, exams, receipts, SMS, Redis. The database already has the tables for fees and exams.

## Folders

```
SNCMT_Project/
  backend/    NestJS API + prisma/migrations (all table creation lives here)
  frontend/   Next.js site (landing, registration, platform admin, school portal)
  docker-compose.yml   optional local Postgres
  start-windows.bat / start-mac-linux.sh   one-click install + run
```

## Run it on your PC (tables are created in Supabase automatically)

1. Install **Node.js 20 or newer** (LTS) from nodejs.org.
2. **Change the platform admin password** in `backend/.env` (`PLATFORM_ADMIN_PASSWORD`) before the first start.
3. Double-click `start-windows.bat` (Mac/Linux: `bash start-mac-linux.sh`).
   Or by hand, in two terminals:
   ```
   cd backend  && npm install && npm run start:dev
   cd frontend && npm install && npm run dev
   ```
4. Open http://localhost:3000.

On every backend start, `npm run migrate` (`prisma migrate deploy`) applies any migration files that have not run yet. The first start creates all tables in Supabase from `0001_init`. You never open the Supabase SQL Editor.

### Try the whole flow

1. http://localhost:3000/register: create a school (for example subdomain `abc`).
2. http://localhost:3000/platform/login: log in as the platform admin (`PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` from `backend/.env`, created automatically on first start) and click **Approve school**.
3. Open http://abc.localhost:3000 and log in with the admin email and password you registered. Chrome and Edge open `*.localhost` without any setup.
4. Dashboard > Users > **Add user**. Teachers, students and guardians log in with a mobile number like `017XXXXXXXX`.

## Database workflow (important)

1. All tables come from SQL files in `backend/prisma/migrations/`. Do not run `schema_v5.sql` by hand: it is already `0001_init` (with two small syntax fixes). `0002` turns on Supabase row-level security so the public anon key cannot read your tables. `0003` links a school to its registering admin.
2. **To add a column or table:** create a new folder, for example `backend/prisma/migrations/0004_student_phone/migration.sql`, containing only the new SQL (`ALTER TABLE students ADD COLUMN phone VARCHAR(20);`). Then run `npm run start:dev` again. Only the new file runs. Never edit a migration that has already run.
3. Optional, to refresh `schema.prisma` from the live database: `cd backend && npm run prisma:sync` (this runs `npx prisma db pull` then `npx prisma generate`).
4. **NEVER use `prisma db push`.** Production only ever runs `prisma migrate deploy`.

The app queries the database with plain SQL (`pg`), not the Prisma client, because the schema uses `CITEXT` and `BIGINT` columns that the Prisma client handles badly. Prisma is used for migrations.

## Docker (later)

`docker compose up -d` starts a local Postgres 16. Put the two lines from the top of `docker-compose.yml` into `backend/.env`, then start the backend as normal. Same migrations, same result, nothing touches Supabase.

## Troubleshooting

- **Backend cannot connect to the database** (`ENETUNREACH`, timeout, or `P1001`): Supabase's direct host (`db.<ref>.supabase.co`) is IPv6 only on many home networks. In Supabase open **Connect** and copy the **Session pooler** string (port 5432, user `postgres.<ref>`). Paste it into BOTH `DATABASE_URL` and `DIRECT_URL` in `backend/.env`. URL-encode special characters in the password (`/` is `%2F`, `&` is `%26`).
- **Logo upload fails:** check `CLOUDINARY_URL` in `backend/.env`.
- **`abc.localhost` does not open:** use Chrome or Edge. In Safari or Firefox add a hosts-file entry for each school.
- **Port 3000 or 4000 busy:** change `PORT` in `backend/.env` (and `BACKEND_URL` in `frontend/.env.local`), or close the other program.
- **Login says "You do not have access to this school":** the account has no role in that school yet.

## Security: do this soon

- The database password, Cloudinary secret and Supabase keys were pasted into chat and project files. **Reset the database password in Supabase and regenerate the Cloudinary API secret**, then update `backend/.env`.
- `.env` files are in `.gitignore`. Never commit them or share this zip with them inside.
- `SUPABASE_SERVICE_ROLE_KEY` is only a placeholder and is not used by this version.

## Going live (sncmt.com)

- Backend `.env`: `NODE_ENV=production`, `ROOT_DOMAIN=sncmt.com`, a long random `JWT_SECRET`.
- Frontend env: `ROOT_DOMAIN=sncmt.com`, `NEXT_PUBLIC_ROOT_DOMAIN=sncmt.com`, `MAIN_URL=https://sncmt.com`, `BACKEND_URL=<where the backend runs>`.
- Cloudflare wildcard DNS (`*.sncmt.com`) pointing at the frontend host. Run the backend with `npm run build && npm start` (this applies migrations first).
