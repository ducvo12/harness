import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/index.css";
import WorkspaceApp from "./app/App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceApp />
  </React.StrictMode>,
);
