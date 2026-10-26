import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// No StrictMode: its double-invoked renders would time every heal step twice.
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
