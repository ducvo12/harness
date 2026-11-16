export function isWorkspaceMarkdown(path: string) {
  return /^\/(?:[^/]+|notes\/.+)\.md$/.test(path)
}
