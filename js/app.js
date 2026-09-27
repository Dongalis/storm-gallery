import { decryptJSON, DecryptionError } from "./crypto.js";
import {
  enteAlbumUrl,
  enteEmbedUrl,
  splitAlbums,
  SPECIAL_KINDS,
  KIND_LABELS,
  validateAlbums,
} from "./album.js";

const DATA_URL = "albums.enc.json";

const lockScreen = document.getElementById("lock");
const lockForm = document.getElementById("lock-form");
const passwordInput = document.getElementById("password");
const errorEl = document.getElementById("lock-error");
const statusEl = document.getElementById("lock-status");
const submitEl = lockForm.querySelector(".lock__submit");
const gallery = document.getElementById("gallery");
const albumList = document.getElementById("albums");
const special = document.getElementById("special");
const lockAgainEl = document.getElementById("lock-again");
const viewer = document.getElementById("viewer");
const viewerTitle = document.getElementById("viewer-title");
const viewerEnte = document.getElementById("viewer-ente");
const viewerFrame = document.getElementById("viewer-frame");
const viewerClose = document.getElementById("viewer-close");

let envelope;

function setError(message) {
  errorEl.textContent = message ?? "";
  errorEl.hidden = !message;
}

function setStatus(message) {
  statusEl.textContent = message ?? "";
  statusEl.hidden = !message;
}

function openViewer(album) {
  viewerTitle.textContent = album.title;
  viewerEnte.href = enteAlbumUrl(album);
  viewerEnte.title = `Open ${album.title} in Ente`;
  viewerFrame.src = enteEmbedUrl(album);
  viewer.showModal();
}

function closeViewer() {
  // Clear the src first so the embed stops loading immediately rather than
  // waiting for the dialog's asynchronous close event.
  viewerFrame.src = "";
  viewer.close();
}

function enteLink(album, className) {
  const link = document.createElement("a");
  link.className = className;
  link.href = enteAlbumUrl(album);
  link.rel = "noreferrer";
  link.textContent = "Open in Ente";
  link.title = `Open ${album.title} in Ente`;
  return link;
}

function renderSpecial({ all, upload }) {
  const buttons = SPECIAL_KINDS.map((kind) => {
    const album = kind === "all" ? all : upload;
    if (!album) return null;

    // Uploading is not something the embed can do, so that button is a link
    // straight to the album rather than another dialog.
    const button = document.createElement(kind === "upload" ? "a" : "button");
    if (kind === "upload") {
      button.rel = "noreferrer";
      button.href = enteAlbumUrl(album);
    } else {
      button.type = "button";
      button.addEventListener("click", () => openViewer(album));
    }
    button.className = `special__button special__button--${kind}`;
    button.textContent = KIND_LABELS[kind];
    if (album.title && album.title !== KIND_LABELS[kind]) button.title = album.title;
    return button;
  }).filter(Boolean);

  special.replaceChildren(...buttons);
  special.hidden = buttons.length === 0;
}

function renderAlbums(albums) {
  const parts = splitAlbums(albums);
  renderSpecial(parts);
  albumList.replaceChildren(
    ...parts.regular.map((album) => {
      const item = document.createElement("li");
      item.className = "album-card";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "album";
      button.addEventListener("click", () => openViewer(album));

      const title = document.createElement("span");
      title.className = "album__title";
      title.textContent = album.title;

      button.append(title);

      if (album.description) {
        const description = document.createElement("span");
        description.className = "album__description";
        description.textContent = album.description;
        button.append(description);
      }

      // A button cannot contain a link, so the card is the list item and the
      // embed and the Ente link are siblings inside it.
      item.append(button, enteLink(album, "album__ente"));
      return item;
    }),
  );
}

function showGallery(albums) {
  renderAlbums(albums);
  gallery.hidden = false;
  lockScreen.hidden = true;
}

function lockGallery() {
  closeViewer();
  albumList.replaceChildren();
  special.replaceChildren();
  special.hidden = true;
  gallery.hidden = true;
  lockScreen.hidden = false;
  setError(null);
  passwordInput.value = "";
  passwordInput.focus();
}

async function unlock(password) {
  const data = await decryptJSON(envelope, password);
  return validateAlbums(data);
}

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(null);

  const password = passwordInput.value;
  if (!password) {
    setError("Enter the gallery password.");
    return;
  }

  submitEl.disabled = true;
  // PBKDF2 is deliberately slow, so give the UI a frame to show the state.
  setStatus("Checking password…");
  await new Promise((done) => requestAnimationFrame(() => done()));

  try {
    showGallery(await unlock(password));
  } catch (error) {
    if (error instanceof DecryptionError) {
      setError("Wrong password. Try again.");
      passwordInput.select();
    } else if (error instanceof SyntaxError) {
      setError("The gallery data decrypted but is not valid JSON.");
    } else {
      setError(error.message);
    }
  } finally {
    setStatus(null);
    submitEl.disabled = false;
  }
});

lockAgainEl.addEventListener("click", lockGallery);
viewerClose.addEventListener("click", closeViewer);
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) closeViewer();
});
viewer.addEventListener("close", () => {
  viewerFrame.src = "";
});

async function boot() {
  setStatus("Loading gallery data…");
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (response.status === 404) {
      throw new Error("This gallery has not been published yet: its album data is missing from the site.");
    }
    if (!response.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${response.status}).`);
    envelope = await response.json();
  } catch (error) {
    // Reveal the lock screen so the message is actually visible; a failure here
    // would otherwise leave the visitor on a blank page.
    lockScreen.hidden = false;
    setError(error.message);
    setStatus(null);
    submitEl.disabled = true;
    passwordInput.removeAttribute("autofocus");
    return;
  }
  setStatus(null);
  lockScreen.hidden = false;
  passwordInput.focus();
}

boot();
