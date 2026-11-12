import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Fonts ship with the site (no Google Fonts request from student devices).
import "@fontsource/press-start-2p/400.css";
import "@fontsource/bitter/400.css";
import "@fontsource/bitter/600.css";
import "@fontsource/bitter/700.css";
import "@fontsource/bitter/800.css";
import "@fontsource/bitter/900.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
