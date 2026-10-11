import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
/// <reference types="vite/client" />
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
document.documentElement.dataset.production = String(import.meta.env.PROD);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
