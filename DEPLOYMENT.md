# Deploy StockWise on Railway

This app needs a Node.js server for its Next.js pages and API, plus a MySQL database. GitHub Pages only serves static files, so the `github.io` URL cannot run sign-in or database-backed inventory.

## 1. Create the Railway project

1. Sign in at [Railway](https://railway.com/).
2. Create a new project and choose **Deploy from GitHub repo**.
3. Select `Namith-7/Online-inventory-and-stock-management-system` and deploy the repository root.
4. In the project, add a MySQL database using **New → Database → MySQL**. Wait for the database service to finish provisioning.

Railway's MySQL service exposes a private `MYSQL_URL` variable for services in the same project. Keep the database private; the web service does not need a public MySQL port.

## 2. Connect the web service to MySQL

In the Next.js service's **Variables** tab, add:

- `DATABASE_URL` with a Railway reference to the MySQL service's `MYSQL_URL`, for example `${{MySQL.MYSQL_URL}}` (use the actual MySQL service name shown in your project).
- `SESSION_SECRET` with a newly generated random value of at least 32 characters. Generate one locally with:

  ```sh
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

Do not commit a real `.env` file, database URL, or session secret.

## 3. Configure build and database migration

In the Next.js service's **Settings → Build** set the build command to:

```sh
pnpm db:generate && pnpm build
```

In **Settings → Deploy → Pre-deploy Command** set:

```sh
pnpm db:deploy
```

Set the start command to:

```sh
pnpm start
```

The pre-deploy step applies the checked-in Prisma migration before the new server starts. Railway runs it with the service variables and private network access, so it can reach the MySQL service.

## 4. Publish and open the app

Apply the staged Railway settings and wait for both services to deploy. In the Next.js service, open **Settings → Networking → Generate Domain**. Use that `*.up.railway.app` URL for the live app. Sign up to create your first administrator workspace.

If deployment fails, review the Next.js service's build/deploy logs first. Common causes are a missing `DATABASE_URL`, an empty `SESSION_SECRET`, or the database service still provisioning.

## Local versus hosted data

The hosted Railway database is separate from any local MySQL database. Creating an account on the deployed site creates a new workspace in the hosted database. No local data is copied automatically.

## Notes

- Railway requires its own account and plan; check the current pricing before deploying.
- The included sign-in throttle is in-memory and per server process. For a multi-instance production deployment, use a shared rate limiter.
- After changing environment variables, redeploy the service so the app starts with the new values.


