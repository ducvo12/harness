# Eval tasks

Each task is `<id>/{repo/, prompt.md, check.sh}`. Never run the agent on `repo/` itself; run it on a throwaway copy:

```bash
dir="$(mktemp -d)/repo" && cp -R tasks/<id>/repo "$dir" && (cd "$dir" && git init -q && git add -A && git commit -qm base) && echo "$dir"
```

Then point the agent at that folder with the text of `prompt.md`, and grade with `tasks/<id>/check.sh <that folder>` (exit 0 = pass). `git diff` in the copy shows what the agent changed.
