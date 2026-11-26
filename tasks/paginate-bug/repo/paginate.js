// Returns one page of items. Pages are numbered from 1.
export function paginate(items, page, perPage) {
  const start = page * perPage;
  return {
    items: items.slice(start, start + perPage),
    page,
    totalPages: Math.ceil(items.length / perPage),
  };
}
