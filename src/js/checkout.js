import { createOrderFunctionUrl } from "./supabaseClient.js";

const form = document.querySelector("#checkout-form");
const status = document.querySelector("#checkout-status");
const locale = localStorage.getItem("store-locale") === "fr" ? "fr" : "ar";
document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";

const message = (ar, fr) => locale === "ar" ? ar : fr;
function readCart() {
  try {
    const cart = JSON.parse(localStorage.getItem("store-cart") || "[]");
    return Array.isArray(cart) ? cart : [];
  } catch { return []; }
}
function showStatus(text, type = "info") {
  if (!status) return;
  status.textContent = text;
  status.className = `notice notice-${type}`;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const cart = readCart();
  if (!cart.length) {
    showStatus(message("سلة المشتريات فارغة.", "Votre panier est vide."), "error");
    return;
  }
  if (!createOrderFunctionUrl) {
    showStatus(message("لم يتم إعداد خدمة الطلبات بعد.", "Le service de commande n'est pas configuré."), "error");
    return;
  }

  const formData = new FormData(form);
  const payload = {
    customer_name: String(formData.get("customer_name") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    address: String(formData.get("address") || "").trim(),
    city: String(formData.get("city") || "").trim(),
    country_code: String(formData.get("country_code") || "").trim().toUpperCase(),
    currency: cart[0]?.currency,
    items: cart.map((item) => ({ product_id: item.id, quantity: Number(item.quantity) })),
    website: String(formData.get("website") || "")
  };

  if (cart.some((item) => item.currency !== payload.currency)) {
    showStatus(message("لا يمكن جمع عملات مختلفة في طلب واحد.", "Un panier ne peut pas mélanger plusieurs devises."), "error");
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = message("جارٍ إرسال الطلب…", "Envoi de la commande…");
  showStatus(message("جارٍ إرسال الطلب بأمان…", "Envoi sécurisé de la commande…"));

  try {
    const response = await fetch(createOrderFunctionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || message("تعذر إنشاء الطلب.", "Impossible de créer la commande."));
    localStorage.removeItem("store-cart");
    form.reset();
    showStatus(message(`تم استلام طلبك بنجاح. رقم الطلب: ${result.order_reference}`, `Commande reçue. Référence : ${result.order_reference}`), "success");
  } catch (error) {
    console.error("Checkout failed:", error);
    showStatus(error instanceof Error ? error.message : message("حدث خطأ غير متوقع.", "Une erreur inattendue s'est produite."), "error");
  } finally {
    button.disabled = false;
    button.textContent = message("تأكيد الطلب والدفع عند الاستلام", "Confirmer la commande — paiement à la livraison");
  }
});
