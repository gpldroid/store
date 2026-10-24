import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const validCurrency = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const expectedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  const requestOrigin = req.headers.get("origin");
  if (expectedOrigin && requestOrigin && requestOrigin !== expectedOrigin) {
    return json({ error: "Origin not allowed." }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Edge Function secrets.");
    return json({ error: "Order service is not configured." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 30_000) return json({ error: "Request is too large." }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid JSON");
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  if (text(body.website, 200)) return json({ error: "Invalid request." }, 400);

  const customer_name = text(body.customer_name, 100);
  const phone = text(body.phone, 25);
  const address = text(body.address, 500);
  const city = text(body.city, 100);
  const country_code = text(body.country_code, 2).toUpperCase();
  const currency = body.currency;
  const itemsInput = body.items;
  const idempotencyKey = text(req.headers.get("idempotency-key"), 100);

  if (customer_name.length < 2 || !/^[+()\d\s.-]{7,25}$/.test(phone) ||
      address.length < 5 || city.length < 2 || !/^[A-Z]{2}$/.test(country_code) ||
      !validCurrency(currency) || !idempotencyKey ||
      !Array.isArray(itemsInput) || itemsInput.length < 1 || itemsInput.length > 30) {
    return json({ error: "Please check the order details and try again." }, 400);
  }

  const items: Array<{ product_id: string; quantity: number }> = [];
  const seen = new Set<string>();
  for (const item of itemsInput) {
    if (!item || typeof item !== "object" ||
        typeof item.product_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.product_id) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
        seen.has(item.product_id)) {
      return json({ error: "Invalid cart items." }, 400);
    }
    seen.add(item.product_id);
    items.push({ product_id: item.product_id, quantity: item.quantity });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: priorOrder, error: priorError } = await supabase
    .from("orders").select("order_reference").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (priorError) {
    console.error("Idempotency lookup failed:", priorError.message);
    return json({ error: "Could not verify this request. Please retry." }, 500);
  }
  if (priorOrder) return json({ order_reference: priorOrder.order_reference, reused: true }, 200);

  const productIds = items.map((item) => item.product_id);
  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id,name_ar,name_fr,price,currency,stock,is_active")
    .in("id", productIds);
  if (productError || !products || products.length !== items.length) {
    return json({ error: "One or more products are no longer available." }, 400);
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  let subtotal = 0;
  const orderLines: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const product = byId.get(item.product_id);
    if (!product || !product.is_active || product.stock < item.quantity) {
      return json({ error: "A product is unavailable or has insufficient stock." }, 409);
    }
    if (product.currency !== currency) {
      return json({ error: "All products in an order must use the selected currency." }, 400);
    }
    const unitPrice = Number(product.price);
    const lineTotal = Math.round((unitPrice * item.quantity + Number.EPSILON) * 100) / 100;
    subtotal = Math.round((subtotal + lineTotal + Number.EPSILON) * 100) / 100;
    orderLines.push({
      product_id: product.id,
      product_name_ar: product.name_ar,
      product_name_fr: product.name_fr,
      quantity: item.quantity,
      unit_price: unitPrice,
      line_total: lineTotal
    });
  }

  // Shipping is intentionally zero until the store owner configures verified rates.
  const shippingAmount = 0;
  const totalAmount = Math.round((subtotal + shippingAmount + Number.EPSILON) * 100) / 100;
  const orderReference = `COD-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;

  // Use a database RPC transaction so stock validation, decrement, and order creation are atomic.
  const { data: created, error: createError } = await supabase.rpc("create_cod_order", {
    p_order_reference: orderReference,
    p_customer_name: customer_name,
    p_phone: phone,
    p_address: address,
    p_city: city,
    p_country_code: country_code,
    p_currency: currency,
    p_idempotency_key: idempotencyKey,
    p_items: items
  });

  if (createError) {
    console.error("Order creation failed:", createError.message);
    if (createError.message.includes("INSUFFICIENT_STOCK") || createError.message.includes("PRODUCT_UNAVAILABLE")) return json({ error: "A product just sold out or is no longer available. Please update your cart." }, 409);
    if (createError.message.includes("CURRENCY_MISMATCH")) return json({ error: "The cart currency no longer matches the product currency." }, 400);
    if (createError.code === "23505") {
      const { data: retryOrder } = await supabase.from("orders").select("order_reference").eq("idempotency_key", idempotencyKey).maybeSingle();
      if (retryOrder) return json({ order_reference: retryOrder.order_reference, reused: true }, 200);
    }
    return json({ error: "Could not create the order. Please try again." }, 500);
  }

  return json({ order_reference: created as string, payment_method: "cash_on_delivery" }, 201);
});
