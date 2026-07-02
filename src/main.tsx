import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const serviceWorkerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href);

    navigator.serviceWorker
      .register(serviceWorkerUrl.toString())
      .then((registration) => {
        void registration.update();

        const notifyUpdateReady = () => {
          window.dispatchEvent(new CustomEvent("app-update-ready", { detail: { registration } }));
        };

        if (registration.waiting) {
          notifyUpdateReady();
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;

          if (!worker) {
            return;
          }

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              notifyUpdateReady();
            }
          });
        });
      })
      .catch(() => {
        // The app still works without the offline shell.
      });
  });

  let isRefreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isRefreshing) {
      return;
    }

    isRefreshing = true;
    window.location.reload();
  });
}
