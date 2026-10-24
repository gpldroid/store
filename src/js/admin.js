import { supabase } from "./supabaseClient.js";

const $ = (selector) => document.querySelector(selector);
const status = $("#admin-status");
const loginForm = $("#admin-login-form");
const logoutButton = $("#logout-button");
const dashboard = $("#dashboard-content");
const loginPanel = $("#login-panel");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function showStatus(text, type = "info") {
  if (!status) return;
  status.textContent = text;
  status.className = `notice notice-${type}`;
}
function money(value, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value)); }
  catch { return `${Number(value).toFixed(2)} ${currency}`; }
}
async function checkAdmin() {
  if (!supabase) return false;
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return false;
  const { data, error } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) {
    showStatus("تعذر التحقق من صلاحيات الإدارة. تأكد من إعداد admin_users وسياسات RLS.", "error");
    return false;
  }
  return Boolean(data);
}
async function renderAuthState() {
  const isAdmin = await checkAdmin();
  if (loginPanel) loginPanel.hidden = isAdmin;
  if (dashboard) dashboard.hidden = !isAdmin;
  if (logoutButton) logoutButton.hidden = !isAdmin;
  if (isAdmin) await Promise.all([loadProducts(), loadOrders()]);
}
async function loadProducts() {
  const root = $("#admin-products");
  if (!root || !supabase) return;
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  if (error) { showStatus("تعذر جلب المنتجات: " + error.message, "error"); return; }
  root.innerHTML = (data || []).map((p) => `<tr>
    <td>${escapeHtml(p.name_ar)}</td><td>${escapeHtml(p.name_fr)}</td>
    <td>${money(p.price, p.currency)}</td><td>${Number(p.stock)}</td><td>${p.is_active ? "منشور" : "مخفي"}</td>
    <td><button class="button button-ghost" data-edit="${p.id}">تعديل</button>
    <button class="button button-ghost" data-toggle="${p.id}" data-active="${p.is_active}">${p.is_active ? "إخفاء" : "نشر"}</button></td></tr>`).join("");
  root.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    const p = data.find((item) => item.id === button.dataset.edit);
    if (!p) return;
    const form = $("#product-form");
    for (const field of ["id","name_ar","name_fr","description_ar","description_fr","price","currency","stock","category","image_url"]) {
      const input = form.elements.namedItem(field);
      if (input) input.value = p[field] ?? "";
    }
    form.elements.namedItem("is_active").checked = p.is_active;
    $("#product-form-title").textContent = "تعديل المنتج";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  root.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", async () => {
    const next = button.dataset.active !== "true";
    const { error: updateError } = await supabase.from("products").update({ is_active: next }).eq("id", button.dataset.toggle);
    if (updateError) showStatus("تعذر تحديث المنتج: " + updateError.message, "error");
    else { showStatus("تم تحديث حالة المنتج.", "success"); await loadProducts(); }
  }));
}
async function loadOrders() {
  const root = $("#admin-orders");
  if (!root || !supabase) return;
  const { data, error } = await supabase.from("orders").select("id,order_reference,customer_name,phone,address,city,country_code,currency,total_amount,status,created_at,order_items(id,product_name_ar,quantity,unit_price)").order("created_at", { ascending: false }).limit(100);
  if (error) { showStatus("تعذر جلب الطلبات: " + error.message, "error"); return; }
  root.innerHTML = (data || []).map((o) => `<tr>
    <td>${escapeHtml(o.order_reference)}</td><td>${escapeHtml(o.customer_name)}<br><small>${escapeHtml(o.phone)}</small></td>
    <td>${escapeHtml([o.address,o.city,o.country_code].filter(Boolean).join(", "))}</td>
    <td>${money(o.total_amount,o.currency)}</td>
    <td><select data-status="${o.id}" aria-label="حالة الطلب">
      ${["pending","confirmed","shipped","delivered","cancelled"].map((s) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}
    </select></td>
    <td><button class="button button-ghost" data-order-items="${o.id}">التفاصيل</button></td></tr>`).join("");
  root.querySelectorAll("[data-status]").forEach((select) => select.addEventListener("change", async () => {
    const { error: updateError } = await supabase.from("orders").update({ status: select.value }).eq("id", select.dataset.status);
    if (updateError) { showStatus("تعذر تغيير حالة الطلب: " + updateError.message, "error"); await loadOrders(); }
    else showStatus("تم تحديث حالة الطلب.", "success");
  }));
  root.querySelectorAll("[data-order-items]").forEach((button) => button.addEventListener("click", () => {
    const order = data.find((item) => item.id === button.dataset.orderItems);
    if (!order) return;
    const lines = (order.order_items || []).map((item) => `${item.product_name_ar} × ${item.quantity} — ${money(item.unit_price, order.currency)}`).join("\n");
    alert(`الطلب ${order.order_reference}\n${lines}\nالإجمالي: ${money(order.total_amount, order.currency)}`);
  }));
}
loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return showStatus("إعدادات Supabase غير موجودة.", "error");
  const email = String(loginForm.elements.namedItem("email").value).trim();
  const password = String(loginForm.elements.namedItem("password").value);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showStatus("فشل تسجيل الدخول. تحقق من بيانات الحساب.", "error");
  if (!await checkAdmin()) {
    await supabase.auth.signOut();
    return showStatus("هذا الحساب غير مخوّل لإدارة المتجر.", "error");
  }
  showStatus("تم تسجيل الدخول بنجاح.", "success");
  await renderAuthState();
});
$("#product-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase || !await checkAdmin()) return showStatus("يجب تسجيل الدخول بحساب المدير.", "error");
  const form = event.currentTarget;
  const fd = new FormData(form);
  const payload = {
    name_ar: String(fd.get("name_ar") || "").trim(),
    name_fr: String(fd.get("name_fr") || "").trim(),
    description_ar: String(fd.get("description_ar") || "").trim(),
    description_fr: String(fd.get("description_fr") || "").trim(),
    price: Number(fd.get("price")),
    currency: String(fd.get("currency") || "USD").toUpperCase(),
    stock: Number(fd.get("stock")),
    category: String(fd.get("category") || "").trim(),
    image_url: String(fd.get("image_url") || "").trim() || null,
    is_active: form.elements.namedItem("is_active").checked
  };
  if (!payload.name_ar || !payload.name_fr || !Number.isFinite(payload.price) || payload.price < 0 || !Number.isInteger(payload.stock) || payload.stock < 0 || !/^[A-Z]{3}$/.test(payload.currency)) {
    return showStatus("تحقق من الأسماء والسعر والمخزون ورمز العملة.", "error");
  }
  const id = String(fd.get("id") || "");
  const query = id
    ? supabase.from("products").update(payload).eq("id", id)
    : supabase.from("products").insert(payload);
  const { error } = await query;
  if (error) return showStatus("تعذر حفظ المنتج: " + error.message, "error");
  form.reset();
  form.elements.namedItem("id").value = "";
  $("#product-form-title").textContent = "إضافة منتج";
  showStatus("تم حفظ المنتج.", "success");
  await loadProducts();
});
$("#reset-product-form")?.addEventListener("click", () => {
  const form = $("#product-form");
  form?.reset();
  if (form?.elements.namedItem("id")) form.elements.namedItem("id").value = "";
  if ($("#product-form-title")) $("#product-form-title").textContent = "إضافة منتج";
});
logoutButton?.addEventListener("click", async () => {
  await supabase?.auth.signOut();
  await renderAuthState();
});
$("#refresh-orders")?.addEventListener("click", async () => {
  if (!await checkAdmin()) return showStatus("يجب تسجيل الدخول بحساب المدير.", "error");
  await loadOrders();
});
void renderAuthState();
