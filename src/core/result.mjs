// Result shaping shared by every tool: text in the format the caller asked
// for, structured data always, and lists that shrink to a character budget
// instead of flooding a model's context.

/**
 * A result in the requested format. `markdown` is a function so the text is
 * only rendered when asked for; `data` is returned as structuredContent
 * either way.
 */
export function result(data, format, markdown) {
  return {
    content: [
      {
        type: "text",
        text: format === "json" ? JSON.stringify(data, null, 2) : markdown(),
      },
    ],
    structuredContent: data,
  };
}

/**
 * One page of a list, with the envelope fields a client needs to page on,
 * shrunk by halving until the text fits `limit` characters. The envelope
 * (as_of, license, attribution) comes from `envelope`.
 *
 * @param {object} options
 * @param {"markdown"|"json"} options.format
 * @param {number} options.total matches before paging
 * @param {number} options.offset
 * @param {Array} options.items this page's items (already sliced)
 * @param {string} options.key name of the list field, e.g. "places"
 * @param {string} options.header first markdown line(s)
 * @param {(item) => string} options.line renders one item as markdown
 * @param {string[]} [options.footer]
 * @param {object} [options.extra] merged into the data
 * @param {object} options.envelope
 * @param {number} options.limit character budget for the text
 */
export function pageResult({
  format,
  total,
  offset,
  items,
  key,
  header,
  line,
  footer = [],
  extra = {},
  envelope,
  limit,
}) {
  const render = (page) => {
    const nextOffset = offset + page.length;
    const hasMore = total > nextOffset;
    const data = {
      ...envelope,
      total,
      count: page.length,
      offset,
      has_more: hasMore,
      ...(hasMore ? { next_offset: nextOffset } : {}),
      [key]: page,
      ...extra,
    };
    return result(data, format, () => {
      const lines = [header, "", ...page.map(line)];
      if (!page.length) lines.push("No matching records.");
      if (hasMore)
        lines.push("", `More results: call again with offset=${nextOffset}.`);
      lines.push(...footer);
      return lines.join("\n");
    });
  };
  // The text is what reaches the model's context, so it sets the page size.
  let page = items;
  let out = render(page);
  while (page.length > 1 && out.content[0].text.length > limit) {
    page = page.slice(0, Math.ceil(page.length / 2));
    out = render(page);
  }
  return out;
}

/** Stable JSON: keys sorted, so equal data gives equal text and equal hashes. */
export function stableStringify(value) {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
