import { installCryptoPolyfill } from "./lib/crypto-polyfill";
installCryptoPolyfill();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./hooks/use-system-theme";
import { TenantThemeProvider } from "./lib/themes";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TenantThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TenantThemeProvider>
    </ThemeProvider>
  </StrictMode>,
);
