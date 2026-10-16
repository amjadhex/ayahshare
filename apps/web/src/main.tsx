import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { toast } from "./actions";
import { startApp } from "./app";
import { initPlatform } from "./platform";
import { initPwa } from "./pwa";
import { initRouter } from "./router";
import { createStore } from "./state";
import { t } from "./strings";
import { initTheme } from "./theme";
import { App } from "./ui/App";

const store = createStore();
// Development only: lets automated checks read the design (never in the production build).
if (import.meta.env.DEV) (window as unknown as { __qdStore: typeof store }).__qdStore = store;
initTheme();
// This browser has used the app: the landing page (/, public/landing.html) sends it straight to /app from now on.
try { localStorage.setItem("qd.app", "1"); } catch { /* private mode */ }
initRouter();
initPwa(() => toast(store, t.offline));
void initPlatform().finally(() => startApp(store));
createRoot(document.getElementById("root")!).render(<StrictMode><App store={store} /></StrictMode>);
