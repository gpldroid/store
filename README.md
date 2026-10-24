# Store — Secure Cash-on-Delivery Storefront

Static multi-category storefront deployed on GitHub Pages, backed by Supabase PostgreSQL and a Supabase Edge Function for secure order creation.

## Architecture
- `src/`: static storefront, cart, checkout, and single-admin dashboard.
- `supabase/schema.sql`: database schema, RLS policies, admin-only order access, product read policy.
- `supabase/functions/create-order/index.ts`: validates cart, reloads prices from the database, computes totals server-side, and creates COD orders using the service role key only on the Edge Function.
- `.github/workflows/deploy.yml`: deploys the static site to GitHub Pages.

## Security model
- Never place the Supabase service-role/secret key in frontend files or GitHub Pages secrets used by client code.
- The browser uses only the publishable/anon key for public product reads and Supabase Auth.
- Anonymous users cannot insert directly into `orders`; order creation is exclusively through the Edge Function.
- Order reads and updates are restricted to the configured admin user ID in RLS policies.
- Prices and totals are recalculated server-side from current product records. Client-provided prices are ignored.
- Configure the admin user and Edge Function secrets before production.

## Setup
1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Create your single admin user in Supabase Auth, then insert that user's UUID into `public.admin_users` from the Supabase SQL Editor. No `ADMIN_USER_ID` Edge Function secret is needed; admin access is controlled by the database membership table.
4. Deploy the Edge Function with `supabase functions deploy create-order --no-verify-jwt`. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGIN=https://gpldroid.github.io` as function secrets. The function's database RPC is restricted to `service_role`; do not expose that key in browser code.
5. Set GitHub repository Actions variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (or publishable key), and `VITE_CREATE_ORDER_FUNCTION_URL` for the static site build. These are public client values, not secrets.
6. Enable GitHub Pages using GitHub Actions as the source.
7. Add products from the dashboard after signing in with the admin account.

## Local development
This is a static HTML/CSS/JavaScript project using Vite for local development. Run `npm install` and `npm run dev`.

## Important
GitHub Pages hosts static files only; all privileged operations run in Supabase Edge Functions. Before accepting real orders, verify the deployment, RLS policies, function secrets, allowed origin, and recovery procedures.