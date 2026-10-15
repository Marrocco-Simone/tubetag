import { createRoot } from "react-dom/client";
import { errorMessage } from "../shared/helpers.ts";
import { App } from "./App.tsx";
import { api } from "./api.ts";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

try {
  const [settings, library] = await Promise.all([api.settings(), api.library()]);
  createRoot(container).render(<App initialSettings={settings} initialLibrary={library} />);
} catch (error) {
  container.innerHTML = "";
  const message = document.createElement("p");
  message.className = "boot-error";
  message.textContent = `tubetag could not load: ${errorMessage(error)}`;
  container.append(message);
}
