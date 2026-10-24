const cartRoot = document.querySelector("#cart-root");
const locale = localStorage.getItem("store-locale") === "fr" ? "fr" : "ar";
document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";

const t = locale === "ar"
  ? { title: "سلة المشتريات", empty: "سلتك فارغة.", shop: "العودة إلى المتجر", checkout: "إتمام الطلب", remove: "حذف", qty: "الكمية", total: "الإجمالي التقريبي", currency: "لا يمكن جمع منتجات بعملات مختلفة." }
  : { title: "Votre panier", empty: "Votre panier est vide.", shop: "Retour à la boutique", checkout: "Commander", remove: "Retirer", qty: "Quantité", total: "Total estimé", currency: "Les devises différentes ne peuvent pas être mélangées." };

function readCart() {
  try {
    const cart = JSON.parse(localStorage.getItem("store-cart") || "[]");
    return Array.isArray(cart) ? cart : [];
  } catch { return []; }
}
function writeCart(cart) {
  localStorage.setItem("store-cart", JSON.stringify(cart));
  render();
}
function formatMoney(value, currency) {
  try { return new Intl.NumberFormat(locale === "ar" ? "ar" : "fr-FR", { style: "currency", currency }).format(value); }
  catch { return `${Number(value).toFixed(2)} ${currency}`; }
}
function render() {
  if (!cartRoot) return;
  const cart = readCart();
  const currencies = new Set(cart.map((item) => item.currency));
  if (currencies.size > 1) {
    cartRoot.innerHTML = `<p class="notice notice-error">${t.currency}</p><button class="button button-secondary" id="clear-cart">${locale === "ar" ? "إفراغ السلة" : "Vider le panier"}</button>`;
    document.querySelector("#clear-cart")?.addEventListener("click", () => writeCart([]));
    return;
  }
  if (!cart.length) {
    cartRoot.innerHTML = `<div class="empty-state"><p>${t.empty}</p><a class="button button-primary" href="./index.html">${t.shop}</a></div>`;
    return;
  }
  cartRoot.innerHTML = `<div class="cart-list">${cart.map((item) => `
    <article class="cart-item">
      <div><strong>${String(item.name || item.id)}</strong><p class="muted">${formatMoney(Number(item.price || 0), item.currency || "USD")}</p></div>
      <label>${t.qty}<input type="number" min="1" max="99" value="${Math.max(1, Number(item.quantity || 1))}" data-quantity="${item.id}"></label>
      <button class="button button-ghost" data-remove="${item.id}">${t.remove}</button>
    </article>`).join("")}</div>
    <div class="cart-summary"><span>${t.total}</span><strong>${locale === "ar" ? "سيتم تأكيد السعر النهائي من الخادم" : "Le total final sera calculé par le serveur"}</strong></div>
    <a class="button button-primary button-wide" href="./checkout.html">${t.checkout}</a>`;
  cartRoot.querySelectorAll("[data-quantity]").forEach((input) => input.addEventListener("change", () => {
    const quantity = Math.max(1, Math.min(99, Number.parseInt(input.value, 10) || 1));
    writeCart(readCart().map((item) => item.id === input.dataset.quantity ? { ...item, quantity } : item));
  }));
  cartRoot.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    writeCart(readCart().filter((item) => item.id !== button.dataset.remove));
  }));
}
render();
