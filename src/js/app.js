import { supabase } from "./supabaseClient.js";

const $ = (selector) => document.querySelector(selector);
const productGrid = $("#product-grid");
const statusEl = $("#store-status");
const localeToggle = $("#locale-toggle");

const translations = {
  ar: { title: "اكتشف منتجاتنا", loading: "جارٍ تحميل المنتجات…", empty: "لا توجد منتجات متاحة حالياً.", add: "أضف إلى السلة", unavailable: "غير متوفر", error: "تعذر تحميل المنتجات. تحقق من إعدادات المتجر." },
  fr: { title: "Découvrez nos produits", loading: "Chargement des produits…", empty: "Aucun produit disponible pour le moment.", add: "Ajouter au panier", unavailable: "Indisponible", error: "Impossible de charger les produits. Vérifiez la configuration." }
};

function getLocale() {
  const saved = localStorage.getItem("store-locale");
  return saved === "fr" ? "fr" : "ar";
}
let locale = getLocale();

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function money(value, currency) {
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar" : "fr-FR", {
      style: "currency", currency: currency || "USD"
    }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${escapeHtml(currency || "")}`;
  }
}

function getCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem("store-cart") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addToCart(product) {
  const cart = getCart();
  if (cart.length && cart.some((item) => item.currency !== product.currency)) {
    alert(locale === "ar" ? "لا يمكن جمع عملات مختلفة في سلة واحدة." : "Un panier ne peut pas mélanger plusieurs devises.");
    return;
  }
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    if (existing.quantity >= product.stock) {
      alert(locale === "ar" ? "الكمية المطلوبة غير متاحة." : "Quantité indisponible.");
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({ id: product.id, quantity: 1, name: locale === "ar" ? product.name_ar : product.name_fr, currency: product.currency });
  }
  localStorage.setItem("store-cart", JSON.stringify(cart));
  updateCartCount();
  alert(locale === "ar" ? "تمت إضافة المنتج إلى السلة." : "Produit ajouté au panier.");
}

function updateCartCount() {
  const count = getCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = String(count); });
}

async function loadProducts() {
  if (!productGrid || !statusEl) return;
  statusEl.textContent = translations[locale].loading;
  if (!supabase) {
    statusEl.textContent = translations[locale].error;
    return;
  }

  const { data, error } = await supabase
    .from("products")
    .select("id,name_ar,name_fr,description_ar,description_fr,price,currency,image_url,stock,category,created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Product query failed:", error.message);
    statusEl.textContent = translations[locale].error;
    return;
  }
  if (!data?.length) {
    statusEl.textContent = translations[locale].empty;
    productGrid.innerHTML = "";
    return;
  }

  statusEl.textContent = "";
  productGrid.innerHTML = data.map((product) => {
    const name = locale === "ar" ? product.name_ar : product.name_fr;
    const description = locale === "ar" ? product.description_ar : product.description_fr;
    const image = product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(name)}" loading="lazy" referrerpolicy="no-referrer">`
      : '<div class="product-placeholder" aria-hidden="true">✦</div>';
    const available = Number(product.stock) > 0;
    return `<article class="product-card">
      <div class="product-image">${image}</div>
      <div class="product-body">
        <p class="eyebrow">${escapeHtml(product.category || "")}</p>
        <h2>${escapeHtml(name)}</h2>
        <p class="muted product-description">${escapeHtml(description || "")}</p>
        <div class="product-footer"><strong>${money(product.price, product.currency)}</strong>
          <button class="button button-primary" data-add="${product.id}" ${available ? "" : "disabled"}>${available ? translations[locale].add : translations[locale].unavailable}</button>
        </div>
      </div>
    </article>`;
  }).join("");

  productGrid.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = data.find((item) => item.id === button.dataset.add);
      if (product) addToCart(product);
    });
  });
}

if (localeToggle) {
  localeToggle.textContent = locale === "ar" ? "Français" : "العربية";
  localeToggle.addEventListener("click", () => {
    locale = locale === "ar" ? "fr" : "ar";
    localStorage.setItem("store-locale", locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    localeToggle.textContent = locale === "ar" ? "Français" : "العربية";
    const heading = $("#catalog-title");
    if (heading) heading.textContent = translations[locale].title;
    loadProducts();
  });
}
updateCartCount();
loadProducts();
