import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const requiredFiles = [
  "index.html",
  "cart.html",
  "checkout.html",
  "src/js/supabaseClient.js",
  "src/js/app.js",
  "src/js/cart.js",
  "src/js/checkout.js",
  "src/js/admin.js",
  "src/admin/login.html",
  "src/admin/dashboard.html",
  "supabase/schema.sql",
  "supabase/functions/create-order/index.ts",
  "supabase/config.toml",
  ".github/workflows/deploy.yml"
];

for (const path of requiredFiles) {
  assert.ok(existsSync(join(root, path)), `Required file is missing: ${path}`);
}

const schema = read("supabase/schema.sql");
const edge = read("supabase/functions/create-order/index.ts");
const clientFiles = [
  "src/js/supabaseClient.js",
  "src/js/app.js",
  "src/js/cart.js",
  "src/js/checkout.js",
  "src/js/admin.js"
].map(read).join("\n");
const workflow = read(".github/workflows/deploy.yml");
const config = read("supabase/config.toml");

for (const table of ["products", "orders", "order_items", "admin_users"]) {
  assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `RLS must be enabled on ${table}`);
}
assert.match(schema, /grant execute on function public\.create_cod_order\([^;]+\) to service_role/i, "Order RPC must be service-role only");
assert.match(schema, /grant execute on function public\.consume_cod_order_rate_limit\([^;]+\) to service_role/i, "Rate-limit RPC must be service-role only");
assert.doesNotMatch(schema, /grant\s+insert\s+on\s+public\.orders\s+to\s+anon/i, "Anonymous users must not insert directly into orders");
assert.match(schema, /grant update\(status\) on public\.orders to authenticated/i, "Admin client updates should be restricted to order status");
assert.match(edge, /\.rpc\("create_cod_order"/, "Checkout must call the atomic order RPC");
assert.match(edge, /consume_cod_order_rate_limit/, "Checkout must use database-backed rate limiting");
assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/, "Service-role key must be read only by the Edge Function");
assert.doesNotMatch(clientFiles, /SUPABASE_SERVICE_ROLE_KEY|service_role/i, "Service-role credentials must never be present in browser code");
assert.match(config, /verify_jwt\s*=\s*false/, "Public COD function must explicitly disable JWT gateway verification");
assert.match(workflow, /npm run check/, "CI must check JavaScript syntax");
assert.match(workflow, /npm test/, "CI must run security smoke tests");

const jsFiles = readdirSync(join(root, "src/js")).filter((name) => name.endsWith(".js"));
assert.ok(jsFiles.length >= 5, "Expected storefront and admin JavaScript modules");

console.log(`Smoke checks passed: ${requiredFiles.length} required files and security invariants verified.`);
