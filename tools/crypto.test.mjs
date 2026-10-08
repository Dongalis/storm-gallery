import assert from "node:assert/strict";
import test from "node:test";
import { decryptJSON, encryptJSON, DecryptionError, DEFAULT_ITERATIONS } from "../js/crypto.js";
import {
  enteEmbedUrl,
  validateAlbums,
  parseEnteEmbed,
  suggestId,
  splitAlbums,
  groupChildren,
  enteAlbumUrl,
  SPECIAL_KINDS,
  KIND_LABELS,
} from "../js/album.js";

const FAST = { iterations: 1000 };
const SAMPLE = {
  albums: [
    {
      id: "aurora",
      title: "Aurora",
      description: "Winter lights",
      token: "JK7YPAUXKI",
      collectionId: "6jaSwxNdfGH8aAmacKDoFFt16BqkmDsfQSSWPJDTc7wy",
    },
  ],
};

test("round-trips data through encrypt and decrypt", async () => {
  const envelope = await encryptJSON(SAMPLE, "correct horse", FAST);
  assert.deepEqual(await decryptJSON(envelope, "correct horse"), SAMPLE);
});

test("produces different ciphertext for the same input twice", async () => {
  const a = await encryptJSON(SAMPLE, "same password", FAST);
  const b = await encryptJSON(SAMPLE, "same password", FAST);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.data, b.cipher.data);
});

test("records the KDF parameters needed to decrypt later", async () => {
  const envelope = await encryptJSON(SAMPLE, "pw", { iterations: 4321 });
  assert.equal(envelope.version, 1);
  assert.equal(envelope.kdf.name, "PBKDF2-SHA256");
  assert.equal(envelope.kdf.iterations, 4321);
  assert.equal(envelope.cipher.name, "AES-GCM");
  assert.ok(!JSON.stringify(envelope).includes("aurora"));
});

test("rejects a wrong password", async () => {
  const envelope = await encryptJSON(SAMPLE, "right", FAST);
  await assert.rejects(() => decryptJSON(envelope, "wrong"), DecryptionError);
});

test("rejects tampered ciphertext", async () => {
  const envelope = await encryptJSON(SAMPLE, "pw", FAST);
  const bytes = Buffer.from(envelope.cipher.data, "base64");
  bytes[0] ^= 0xff;
  await assert.rejects(
    () => decryptJSON({ ...envelope, cipher: { ...envelope.cipher, data: bytes.toString("base64") } }, "pw"),
    DecryptionError,
  );
});

test("rejects an unsupported format version", async () => {
  const envelope = await encryptJSON(SAMPLE, "pw", FAST);
  await assert.rejects(() => decryptJSON({ ...envelope, version: 2 }, "pw"), /Unsupported data format/);
});

test("refuses to encrypt with an empty password", async () => {
  await assert.rejects(() => encryptJSON(SAMPLE, "", FAST), /password is required/);
});

test("uses 600k iterations by default", async () => {
  const envelope = await encryptJSON(SAMPLE, "pw");
  assert.equal(envelope.kdf.iterations, DEFAULT_ITERATIONS);
  assert.equal(DEFAULT_ITERATIONS, 600000);
});

test("builds an ente embed url from the token and collection id", () => {
  assert.equal(
    enteEmbedUrl(SAMPLE.albums[0]),
    "https://embed.ente.com/?t=JK7YPAUXKI#6jaSwxNdfGH8aAmacKDoFFt16BqkmDsfQSSWPJDTc7wy",
  );
});

test("validates a well-formed album list", () => {
  assert.equal(validateAlbums(SAMPLE).length, 1);
});

test("returns the album array itself, not a wrapper", () => {
  // The admin page rebuilds its payload with { albums: validateAlbums(...) }.
  // Chaining another .albums onto the result silently yields undefined, which
  // JSON.stringify then drops, producing an empty database.
  const validated = validateAlbums(SAMPLE);
  assert.ok(Array.isArray(validated));
  assert.equal(JSON.stringify({ albums: validateAlbums(SAMPLE) }), JSON.stringify(SAMPLE));
  assert.ok(Object.hasOwn({ albums: validateAlbums(SAMPLE) }, "albums"));
});

test("rejects albums missing required fields", () => {
  assert.throws(() => validateAlbums({ albums: [{ id: "a", title: "A" }] }), /token/);
  assert.throws(() => validateAlbums({ albums: [{ id: "", title: "A", token: "t", collectionId: "c" }] }), /id/);
  assert.throws(() => validateAlbums({ albums: [{ id: "a", title: "A", token: "t", collectionId: " " }] }), /collectionId/);
});

test("accepts an empty album list", () => {
  assert.deepEqual(validateAlbums({ albums: [] }), []);
});

test("rejects tokens containing url separators", () => {
  assert.throws(
    () => validateAlbums({ albums: [{ id: "a", title: "A", token: "t#x", collectionId: "c" }] }),
    /must not contain/,
  );
});

test("rejects duplicate album ids", () => {
  const album = { id: "a", title: "A", token: "t", collectionId: "c" };
  assert.throws(() => validateAlbums({ albums: [album, { ...album }] }), /Duplicate album id/);
});

test("rejects a source without an albums array", () => {
  assert.throws(() => validateAlbums({}), /albums/);
});

test("splits special albums out of the grid", () => {
  const { all, upload, regular } = splitAlbums([
    { id: "a", title: "A", token: "t", collectionId: "c", kind: "all" },
    { id: "b", title: "B", token: "t", collectionId: "c", kind: "upload" },
    { id: "c", title: "C", token: "t", collectionId: "c" },
    { id: "d", title: "D", token: "t", collectionId: "c" },
  ]);
  assert.equal(all.id, "a");
  assert.equal(upload.id, "b");
  assert.deepEqual(regular.map((x) => x.id), ["c", "d"]);
});

test("a duplicate special kind would resolve to the last one", () => {
  // validateAlbums rejects duplicates upstream, so this only documents the
  // tie-break rather than relying on it.
  const { all } = splitAlbums([
    { id: "a", title: "A", token: "t", collectionId: "c", kind: "all" },
    { id: "d", title: "D", token: "t", collectionId: "c", kind: "all" },
  ]);
  assert.equal(all.id, "d");
});

test("reports missing special albums as null", () => {
  const { all, upload, regular } = splitAlbums([{ id: "c", title: "C", token: "t", collectionId: "c" }]);
  assert.equal(all, null);
  assert.equal(upload, null);
  assert.equal(regular.length, 1);
});

test("accepts the two special kinds and rejects anything else", () => {
  const base = { id: "x", title: "X", token: "t", collectionId: "c" };
  for (const kind of SPECIAL_KINDS) {
    assert.doesNotThrow(() => validateAlbums({ albums: [{ ...base, kind }] }));
  }
  assert.throws(() => validateAlbums({ albums: [{ ...base, kind: "favourite" }] }), /"kind" must be one of/);
});

test("allows only one album per special kind", () => {
  const make = (id, kind) => ({ id, title: id, token: "t", collectionId: "c", kind });
  assert.doesNotThrow(() => validateAlbums({ albums: [make("a", "all"), make("b", "upload")] }));
  assert.throws(
    () => validateAlbums({ albums: [make("a", "all"), make("b", "all")] }),
    /Duplicate special album of kind "all"/,
  );
  assert.throws(
    () => validateAlbums({ albums: [make("a", "upload"), make("b", "upload")] }),
    /Duplicate special album of kind "upload"/,
  );
});

test("names the special albums", () => {
  assert.equal(KIND_LABELS.all, "All photos");
  assert.equal(KIND_LABELS.upload, "Upload");
  assert.deepEqual(SPECIAL_KINDS, ["all", "upload"]);
});

test("parses token and collection id from an ente embed snippet", () => {
  const snippet =
    '<iframe src="https://embed.ente.com/?t=3ACSB7CJDK#HgJ2hf2Dv8ogZdC7FiHvBboKZA6ZdWqwa3zUaX69fqoZ" width="800" height="600" frameborder="0" allowfullscreen></iframe>';
  assert.deepEqual(parseEnteEmbed(snippet), {
    token: "3ACSB7CJDK",
    collectionId: "HgJ2hf2Dv8ogZdC7FiHvBboKZA6ZdWqwa3zUaX69fqoZ",
  });
});

test("parses a bare embed url, a share url, and a schemeless link", () => {
  const expected = { token: "ABC123", collectionId: "COLLECTION9" };
  assert.deepEqual(parseEnteEmbed("https://embed.ente.com/?t=ABC123#COLLECTION9"), expected);
  assert.deepEqual(parseEnteEmbed("https://albums.ente.com/?t=ABC123#COLLECTION9"), expected);
  assert.deepEqual(parseEnteEmbed("//albums.ente.com/?t=ABC123#COLLECTION9"), expected);
  assert.deepEqual(parseEnteEmbed("?t=ABC123#COLLECTION9"), expected);
  assert.deepEqual(parseEnteEmbed("  https://pics.example.org/?t=ABC123#COLLECTION9  "), expected);
});

test("rejects links that carry no token", () => {
  assert.throws(() => parseEnteEmbed("https://embed.ente.com/#COLLECTION9"), /No album token/);
  assert.throws(() => parseEnteEmbed("   "), /Paste an Ente embed/);
  assert.throws(() => parseEnteEmbed(null), /Paste an Ente embed/);
});

test("builds the ente album url that Open in Ente points at", () => {
  assert.equal(
    enteAlbumUrl({ token: "ABC123", collectionId: "COLLECTION9" }),
    "https://albums.ente.com/?t=ABC123#COLLECTION9",
  );
  assert.equal(enteAlbumUrl({ token: "ABC123" }), "https://albums.ente.com/?t=ABC123");
  assert.equal(enteAlbumUrl({ token: "ABC123", collectionId: "" }), "https://albums.ente.com/?t=ABC123");
});

test("percent-encodes tokens in the album url", () => {
  assert.equal(
    enteAlbumUrl({ token: "A B&C", collectionId: "K/1" }),
    "https://albums.ente.com/?t=A%20B%26C#K%2F1",
  );
});

test("accepts an albums.ente.com link that has only a token", () => {
  // Ente's own docs show ?t=..#.., but the fragment is a URL fragment and gets
  // stripped often enough that a bare ?t= link is a real thing to be handed.
  assert.deepEqual(parseEnteEmbed("https://albums.ente.com/?t=ABC123"), {
    token: "ABC123",
    collectionId: "",
  });
  assert.deepEqual(parseEnteEmbed("https://albums.ente.com/?t=ABC123&ck=COLLECTION9"), {
    token: "ABC123",
    collectionId: "COLLECTION9",
  });
});

test("accepts the newer path-token album link", () => {
  // Ente is moving public album links to albums.ente.com/TOKEN#KEY.
  assert.deepEqual(parseEnteEmbed("https://albums.ente.com/ABC123#COLLECTION9"), {
    token: "ABC123",
    collectionId: "COLLECTION9",
  });
  assert.deepEqual(parseEnteEmbed("https://albums.ente.com/ABC123"), {
    token: "ABC123",
    collectionId: "",
  });
});

test("prefers the query token and ignores app routes in the path", () => {
  // The query token wins even when the path looks like a route.
  for (const path of ["s", "share", "photos", "albums", "settings"]) {
    assert.deepEqual(
      parseEnteEmbed(`https://ente.io/${path}?t=ABC123`),
      { token: "ABC123", collectionId: "" },
      `?t= should win over the path segment: ${path}`,
    );
  }
  // A route with no ?t= must not be mistaken for a token.
  assert.throws(() => parseEnteEmbed("https://ente.io/s"), /No album token/);
  assert.throws(() => parseEnteEmbed("https://ente.io/photos"), /No album token/);
  // Multi-segment paths are not the path-token form, so they yield no token.
  assert.throws(() => parseEnteEmbed("https://ente.io/s/ABC123"), /No album token/);
});

test("builds an embed url without a fragment when there is no collection key", () => {
  assert.equal(
    enteEmbedUrl({ token: "ABC123", collectionId: "" }),
    "https://embed.ente.com/?t=ABC123",
  );
  assert.equal(
    enteEmbedUrl({ token: "ABC123", collectionId: "COLLECTION9" }),
    "https://embed.ente.com/?t=ABC123#COLLECTION9",
  );
});

test("accepts an album with no collection key", () => {
  assert.doesNotThrow(() => validateAlbums({ albums: [{ id: "a", title: "A", token: "t" }] }));
  assert.doesNotThrow(() => validateAlbums({ albums: [{ id: "a", title: "A", token: "t", collectionId: "" }] }));
  assert.throws(
    () => validateAlbums({ albums: [{ id: "a", title: "A", token: "t", collectionId: 7 }] }),
    /collectionId/,
  );
});

test("percent-decodes a token and collection id", () => {
  assert.deepEqual(parseEnteEmbed("https://embed.ente.com/?t=A%2BB#COL%2FLECTION"), {
    token: "A+B",
    collectionId: "COL/LECTION",
  });
});

test("round-trips a parsed link back into an embed url", () => {
  const { token, collectionId } = parseEnteEmbed("https://embed.ente.com/?t=ABC123#COLLECTION9");
  assert.equal(enteEmbedUrl({ token, collectionId }), "https://embed.ente.com/?t=ABC123#COLLECTION9");
});

test("suggests a slug id from a title", () => {
  assert.equal(suggestId("Iceland 2026"), "iceland-2026");
  assert.equal(suggestId("Ring Road / Ten Days!"), "ring-road-ten-days");
  assert.match(suggestId(""), /^album-[a-z0-9]+$/);
  assert.match(suggestId("!!!"), /^album-[a-z0-9]+$/);
});

test("parent field round-trips through encryption", async () => {
  const album = {
    id: "child",
    title: "Child",
    token: "TOKEN123",
    parent: "parent-id",
  };
  const encrypted = await encryptJSON({ albums: [album] }, "same password", FAST);
  const decrypted = await decryptJSON(encrypted, "same password");
  assert.ok(decrypted.albums[0].parent === "parent-id");
});

test("accepts child album with parent", () => {
  assert.deepEqual(
    validateAlbums({
      albums: [
        { id: "p", title: "P", token: "T1" },
        { id: "c", title: "C", token: "T2", parent: "p" },
      ],
    }),
    [
      { id: "p", title: "P", token: "T1" },
      { id: "c", title: "C", token: "T2", parent: "p" },
    ],
  );
});

test("accepts child listed before parent", () => {
  assert.deepEqual(
    validateAlbums({
      albums: [
        { id: "c", title: "C", token: "T2", parent: "p" },
        { id: "p", title: "P", token: "T1" },
      ],
    }),
    [
      { id: "c", title: "C", token: "T2", parent: "p" },
      { id: "p", title: "P", token: "T1" },
    ],
  );
});

test("rejects non-string parent", () => {
  assert.throws(() => {
    validateAlbums({
      albums: [
        { id: "p", title: "P", token: "T1" },
        { id: "c", title: "C", token: "T2", parent: 5 },
      ],
    });
  }, /parent.*non-empty string/);
});

test("rejects empty parent", () => {
  assert.throws(() => {
    validateAlbums({
      albums: [{ id: "c", title: "C", token: "T2", parent: "" }],
    });
  }, /parent.*non-empty string/);
});

test("rejects parent on special album", () => {
  assert.throws(() => {
    validateAlbums({
      albums: [
        { id: "p", title: "P", token: "T1" },
        { id: "all-photos", title: "All", kind: "all", token: "T2", parent: "p" },
      ],
    });
  }, /special header albums cannot have a parent/);
});

test("rejects special album as parent", () => {
  assert.throws(() => {
    validateAlbums({
      albums: [
        { id: "all-photos", title: "All", kind: "all", token: "T1" },
        { id: "c", title: "C", token: "T2", parent: "all-photos" },
      ],
    });
  }, /special header album/);
});

test("rejects unknown parent", () => {
  assert.throws(() => {
    validateAlbums({
      albums: [{ id: "c", title: "C", token: "T2", parent: "nope" }],
    });
  }, /does not exist/);
});

test("rejects self-parenting", () => {
  assert.throws(() => {
    validateAlbums({
      albums: [{ id: "c", title: "C", token: "T2", parent: "c" }],
    });
  }, /cycle/);
});

test("rejects parent cycle", () => {
  assert.throws(() => {
    validateAlbums({
      albums: [
        { id: "a", title: "A", token: "T1", parent: "b" },
        { id: "b", title: "B", token: "T2", parent: "a" },
      ],
    });
  }, /cycle/);
});

test("groupChildren groups correctly and preserves order", () => {
  const p1 = { id: "p1", title: "P1", token: "T1" };
  const c1 = { id: "c1", title: "C1", token: "T2", parent: "p1" };
  const c2 = { id: "c2", title: "C2", token: "T3", parent: "p1" };
  const p2 = { id: "p2", title: "P2", token: "T4" };
  const { roots, childrenByParent } = groupChildren([c1, p1, c2, p2]);
  assert.deepEqual(roots, [p1, p2]);
  assert.deepEqual(childrenByParent.get("p1"), [c1, c2]);
  assert.ok(childrenByParent.get("p2") == null);
});

test("groupChildren handles empty input", () => {
  const { roots, childrenByParent } = groupChildren([]);
  assert.deepEqual(roots, []);
  assert.ok(childrenByParent instanceof Map);
});
