export const ENTE_EMBED_ORIGIN = "https://embed.ente.com";

// The human-facing album app. A public link looks like albums.ente.com/?t=..#..,
// which is where "Open in Ente" sends people and where the upload button goes.
export const ENTE_ALBUM_ORIGIN = "https://albums.ente.com";

// Albums that get their own button in the gallery header instead of a grid
// card. Both are ordinary Ente public links; "all" points at a collection
// holding everything, "upload" at a public link that accepts uploads.
export const SPECIAL_KINDS = ["all", "upload"];

export const KIND_LABELS = {
  all: "All photos",
  upload: "Upload",
};

export function isSpecial(album) {
  return SPECIAL_KINDS.includes(album?.kind);
}

export function splitAlbums(albums) {
  const result = { all: null, upload: null, regular: [] };
  for (const album of albums) {
    if (album.kind === "all" || album.kind === "upload") result[album.kind] = album;
    else result.regular.push(album);
  }
  return result;
}

export function enteEmbedUrl(album) {
  const base = `${ENTE_EMBED_ORIGIN}/?t=${encodeURIComponent(album.token)}`;
  // Ente's public album links carry the collection key as a # fragment, but the
  // token alone is enough to open the share, so leave the fragment off when we
  // were never given one.
  return album.collectionId ? `${base}#${encodeURIComponent(album.collectionId)}` : base;
}

export function enteAlbumUrl(album) {
  const base = `${ENTE_ALBUM_ORIGIN}/?t=${encodeURIComponent(album.token)}`;
  return album.collectionId ? `${base}#${encodeURIComponent(album.collectionId)}` : base;
}

// Path segments that are app routes rather than an Ente album token. Ente is
// rolling public album links out as albums.ente.com/TOKEN#KEY, so a lone path
// segment can be a token, but only if it is not one of these.
const NON_TOKEN_SEGMENTS = new Set(["s", "share", "p", "photos", "albums", "collections", "admin", "settings"]);

/**
 * Pull the token and collection key out of anything Ente hands you: the copied
 * embed snippet, an embed URL, a public album link, or a bare `?t=..#..`.
 *
 * The host is ignored, so albums.ente.com, embed.ente.com and a custom domain
 * all work. Returns `collectionId: ""` when the link carries no collection key.
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

  const queryToken = url.searchParams.get("t") ?? url.searchParams.get("token");
  // Newer Ente builds emit albums.ente.com/TOKEN#KEY instead of ?t=TOKEN#KEY.
  const segments = url.pathname.split("/").filter(Boolean);
  const pathToken =
    queryToken || segments.length !== 1 || NON_TOKEN_SEGMENTS.has(segments[0].toLowerCase())
      ? null
      : segments[0];

  const token = queryToken ?? pathToken;
  if (!token) throw new Error("No album token (the ?t= part) found in that link.");

  // The collection key arrives as the # fragment, or as ?ck=, which is what
  // Ente's own embed app reads.
  const collectionId =
    decodeURIComponent(url.hash.replace(/^#/, "")) || url.searchParams.get("ck") || "";

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

  for (const field of ["id", "title", "token"]) {
    const value = album[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${at}: "${field}" is required and must be a non-empty string.`);
    }
  }

  // Optional: an albums.ente.com link sometimes arrives with only the token.
  if (album.collectionId != null && typeof album.collectionId !== "string") {
    throw new Error(`${at}: "collectionId" must be a string when present.`);
  }

  if (album.description != null && typeof album.description !== "string") {
    throw new Error(`${at}: "description" must be a string when present.`);
  }

  if (album.kind != null && !SPECIAL_KINDS.includes(album.kind)) {
    throw new Error(`${at}: "kind" must be one of ${SPECIAL_KINDS.join(", ")} when present.`);
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
  const seenKinds = new Set();
  for (const [index, album] of data.albums.entries()) {
    validateAlbum(album, index);
    if (seen.has(album.id)) throw new Error(`Duplicate album id: "${album.id}".`);
    seen.add(album.id);
    // There is only one "all photos" and one "upload" destination, so a second
    // one would silently shadow the first in the header.
    if (SPECIAL_KINDS.includes(album.kind)) {
      if (seenKinds.has(album.kind)) throw new Error(`Duplicate special album of kind "${album.kind}".`);
      seenKinds.add(album.kind);
    }
  }
  return data.albums;
}
