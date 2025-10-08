export async function fetchAndExtract(url: string): Promise<{ title?: string; text: string }> {
  if (!url || typeof url !== 'string') throw new Error('URL is required');

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);

  const html = await res.text();

  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  let cleaned = html.replace(/<!--([\s\S]*?)-->/g, ' ');
  cleaned = cleaned.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ');
  cleaned = cleaned.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ');
  cleaned = cleaned.replace(/<noscript[\s\S]*?>[\s\S]*?<\/noscript>/gi, ' ');

  const text = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return { title, text };
}
/**
 * Crawl and extract text from all pages starting from a base documentation URL.
 * Limits number of pages to avoid infinite loops.
 * Only follows links within the same origin.
 * @param baseUrl The root URL of the documentation.
 * @param maxPages Maximum number of pages to fetch (default 50).
 */
export async function fetchAllPages(baseUrl: string, maxPages: number = 50): Promise<Array<{ url: string; title?: string; text: string }>> {
  if (!baseUrl || typeof baseUrl !== 'string') throw new Error('Base URL is required');
  const visited = new Set<string>();
  const toVisit: string[] = [baseUrl];
  const pages: Array<{ url: string; title?: string; text: string }> = [];
  const baseOrigin = new URL(baseUrl).origin;
  while (toVisit.length > 0 && pages.length < maxPages) {
    const url = toVisit.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const { title, text } = await fetchAndExtract(url);
      pages.push({ url, title, text });
    } catch (err) {
      console.error(`Failed to fetch and extract ${url}:`, err);
      continue;
    }
    let html = '';
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) html = await res.text();
    } catch {
      continue;
    }
    const hrefs = Array.from(html.matchAll(/href=["']([^"'#]+)["']/gi), m => m[1]);
    for (const href of hrefs) {
      try {
        let absolute = new URL(href, url).toString();
        absolute = absolute.split('#')[0];
        if (absolute.startsWith(baseOrigin) && !visited.has(absolute) && !toVisit.includes(absolute)) {
          toVisit.push(absolute);
        }
      } catch {
      }
    }
  }
  return pages;
}
