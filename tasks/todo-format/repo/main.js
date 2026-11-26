import { readFileSync } from "node:fs";
import { render } from "./todo.js";

const todos = JSON.parse(readFileSync(new URL("./data.json", import.meta.url), "utf8"));
console.log(render(todos));
