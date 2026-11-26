// Turns a list of todos into the text shown in the terminal.
export function render(todos) {
  return todos
    .map((todo) => `${todo.title} - ${todo.done ? "done" : "not done"}`)
    .join("\n");
}
