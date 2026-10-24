# StockWise

StockWise is a Next.js inventory management demo with a MySQL backend. Each account gets its own workspace and sample catalog.

## Full-stack project structure

- `app/page.tsx` and `app/auth-page.tsx` are the React frontend.
- `app/api/[...path]/route.ts` implements the JSON API used by the frontend.
- `lib/server/auth.ts` hashes passwords and validates signed session cookies.
- `lib/server/http.ts` contains request validation and consistent API errors.
- `prisma/schema.prisma` is the MySQL data model; the migration is in `prisma/migrations/`.

The frontend and API run in the same Next.js application, so no separate API server or CORS setup is needed. Each account receives an isolated workspace. Admin-only writes include catalog changes, stock operations, purchasing, and settings.

## Run locally

You need Node.js 20.9 or newer, pnpm, and a running MySQL 8+ server. Start MySQL and create the app database once:

```sql
CREATE DATABASE stockwise CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

1. Copy `.env.example` to `.env`.
2. Put your MySQL connection string in `DATABASE_URL`, for example `mysql://stockwise_user:password@localhost:3306/stockwise`. URL-encode special characters in the username or password.
3. Replace `SESSION_SECRET` with a random value. Generate one with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

4. Install dependencies and create the database tables:

   ```sh
   pnpm install
   pnpm db:generate
   pnpm db:deploy
   ```

5. Start the app with `pnpm dev`, then create an account on the sign-in page.

For a production-mode local run, use `pnpm build` followed by `pnpm start`.

Account creation creates a private workspace with sample products, suppliers, categories, and brands. Sign in later with the same email and password to return to it.

## Backend overview

- Prisma models store workspaces, users, products, suppliers, categories, brands, purchase orders, order lines, stock movements, transfers, and workspace settings.
- Passwords are hashed with Node's scrypt implementation. Sessions use signed, HTTP-only, same-site cookies.
- All inventory reads and writes are scoped to the signed-in user's workspace. Write endpoints require an administrator. The included signup creates an administrator account.
- Stock in/out/adjustment operations update the product quantity and append a ledger movement in one database transaction.
- Receiving a purchase order updates every line's stock, writes the movements, and marks the order received in one transaction. Repeated receives are rejected.
- Transfers validate the selected source, available units, and distinct locations before recording the transfer.
- Login applies a basic per-process attempt throttle. Use a shared rate limiter when running multiple server instances.
- The frontend loads shared records from `/api/bootstrap`; changes are sent to the API instead of being saved to browser storage.

## API routes

All endpoints return JSON. Except `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me`, routes require a signed-in session.

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/auth/register` | POST | Create account and sample workspace |
| `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` | POST, GET | Start/end/check a session |
| `/api/bootstrap` | GET | Load workspace data for the dashboard |
| `/api/products` | GET, POST | List/create products |
| `/api/products/:id` | PATCH, DELETE | Update/delete product |
| `/api/suppliers` | GET, POST | List/create suppliers |
| `/api/suppliers/:id` | PATCH, DELETE | Update/delete supplier |
| `/api/categories`, `/api/brands` | GET, POST, DELETE by id | Manage catalog labels |
| `/api/movements` | GET, POST | Read ledger and record stock changes |
| `/api/orders` | GET, POST | List/create purchase orders |
| `/api/orders/:id` | PATCH | Mark ordered or receive an order |
| `/api/transfers` | GET, POST | Read and record transfers |
| `/api/settings` | GET, POST, PATCH | Read/update workspace thresholds and currency |
| `/api/profile` | POST | Update the signed-in user's display name |

## Deployment

Set `DATABASE_URL` and a unique `SESSION_SECRET` in the hosting provider's environment settings. Run `pnpm db:deploy` as a release step to apply the included initial migration, then build and start the Next.js app.

For a production launch, add email-backed password reset, staff invitations, a shared rate limiter, and a migration review process before opening account creation to the public. The current role model supports staff/viewer roles but the signup flow intentionally creates only an administrator; staff invitation and role-management screens are not included.

