import { createRoot } from "react-dom/client";
import { EditorPage } from "./EditorPage";
import "./editor.css";

createRoot(document.getElementById("root") as HTMLElement).render(<EditorPage />);
