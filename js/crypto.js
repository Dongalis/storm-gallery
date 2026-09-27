const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const FORMAT_VERSION = 1;
export const DEFAULT_ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export class DecryptionError extends Error {
  constructor(message = "Could not decrypt the album data. Wrong password?") {
    super(message);
    this.name = "DecryptionError";
  }
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJSON(data, password, options = {}) {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("A non-empty password is required.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(data)),
  );
  return {
    version: FORMAT_VERSION,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) },
  };
}

export async function decryptJSON(envelope, password) {
  if (envelope?.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported data format version: ${envelope?.version}`);
  }
  if (envelope?.kdf?.name !== "PBKDF2-SHA256" || envelope?.cipher?.name !== "AES-GCM") {
    throw new Error("Unsupported encryption parameters.");
  }
  const iterations = envelope.kdf.iterations;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("Invalid KDF iteration count.");
  }

  const key = await deriveKey(password, fromBase64(envelope.kdf.salt), iterations);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.cipher.iv) },
      key,
      fromBase64(envelope.cipher.data),
    );
  } catch {
    throw new DecryptionError();
  }
  return JSON.parse(decoder.decode(plaintext));
}
