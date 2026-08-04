import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import App from "./App";
import "@fontsource-variable/inter";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* The `prefers-reduced-motion` block in index.css only reaches CSS
        animations and transitions. Framer's run in JavaScript and would sail
        straight past it, so the same preference is applied here as well:
        "user" drops movement — scale, rotate, position — while keeping fades,
        which is what the setting actually asks for. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
