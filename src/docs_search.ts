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
