export const ENTE_EMBED_ORIGIN = "https://embed.ente.com";

export function enteEmbedUrl(album) {
  return `${ENTE_EMBED_ORIGIN}/?t=${encodeURIComponent(album.token)}#${encodeURIComponent(album.collectionId)}`;
}

/**
 * Pull the token and collection id out of anything Ente hands you: the copied
 * embed snippet, an embed URL, a public share link, or a bare `?t=..#..`.
 */
export function parseEnteEmbed(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("Paste an Ente embed snippet or share link.");

  const src = text.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? text;

  let url;
  try {
    url = new URL(src, ENTE_EMBED_ORIGIN);
  } catch {
    throw new Error(`Could not read a link out of: ${text.slice(0, 60)}`);
  }

  const token = url.searchParams.get("t");
  if (!token) throw new Error("No album token (the ?t= part) found in that link.");

  const collectionId = decodeURIComponent(url.hash.replace(/^#/, ""));
  if (!collectionId) throw new Error("No collection id (the # part) found in that link.");

  return { token, collectionId };
}

export function suggestId(title) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `album-${Date.now().toString(36)}`;
}

export function validateAlbum(album, index) {
  const at = `albums[${index}]`;
  if (!album || typeof album !== "object" || Array.isArray(album)) {
    throw new Error(`${at}: expected an object.`);
  }

  for (const field of ["id", "title", "token", "collectionId"]) {
    const value = album[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${at}: "${field}" is required and must be a non-empty string.`);
    }
  }

  if (album.description != null && typeof album.description !== "string") {
    throw new Error(`${at}: "description" must be a string when present.`);
  }

  // The token and collection id land in a query string and a fragment, so any
  // whitespace or separator would silently produce a broken embed.
  for (const field of ["token", "collectionId"]) {
    if (/[\s&#?]/.test(album[field])) {
      throw new Error(`${at}: "${field}" must not contain whitespace, "&", "#" or "?".`);
    }
  }

  return album;
}

export function validateAlbums(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.albums)) {
    throw new Error('Source must be an object with an "albums" array.');
  }
  const seen = new Set();
  for (const [index, album] of data.albums.entries()) {
    validateAlbum(album, index);
    if (seen.has(album.id)) throw new Error(`Duplicate album id: "${album.id}".`);
    seen.add(album.id);
  }
  return data.albums;
}
