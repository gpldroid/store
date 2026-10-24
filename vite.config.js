import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/store/" : "/",
  build: {
    rollupOptions: {
      input: {
        home: "index.html",
        cart: "cart.html",
        checkout: "checkout.html",
        adminLogin: "src/admin/login.html",
        adminDashboard: "src/admin/dashboard.html"
      }
    }
  }
});
