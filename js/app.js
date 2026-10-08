import { decryptJSON, DecryptionError } from "./crypto.js";
import {
  enteAlbumUrl,
  enteEmbedUrl,
  splitAlbums,
  groupChildren,
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
const crumbsEl = document.getElementById("crumbs");
const special = document.getElementById("special");
const lockAgainEl = document.getElementById("lock-again");
const viewer = document.getElementById("viewer");
const viewerTitle = document.getElementById("viewer-title");
const viewerEnte = document.getElementById("viewer-ente");
const viewerFrame = document.getElementById("viewer-frame");
const viewerClose = document.getElementById("viewer-close");
const viewerTabs = document.getElementById("viewer-tabs");

let envelope;
let albumIndex = null;
let viewPath = [];
let viewerRootAlbum = null;
let viewerEmbedAlbum = null;
let childrenByParentMap = new Map();

function setError(message) {
  errorEl.textContent = message ?? "";
  errorEl.hidden = !message;
}

function setStatus(message) {
  statusEl.textContent = message ?? "";
  statusEl.hidden = !message;
}

function renderViewerTabs() {
  if (!viewerTabs) return;
  viewerTabs.replaceChildren();
  if (!viewerRootAlbum) {
    viewerTabs.hidden = true;
    return;
  }
  const children = childrenByParentMap.get(viewerRootAlbum.id) || [];
  viewerTabs.hidden = false;
  const seeAll = document.createElement("button");
  seeAll.type = "button";
  seeAll.className = viewerEmbedAlbum === viewerRootAlbum ? "viewer__tab is-active" : "viewer__tab";
  seeAll.textContent = "See all";
  seeAll.addEventListener("click", () => {
    viewerEmbedAlbum = viewerRootAlbum;
    viewerFrame.src = enteEmbedUrl(viewerEmbedAlbum);
    viewerTitle.textContent = viewerEmbedAlbum.title;
    viewerEnte.href = enteAlbumUrl(viewerEmbedAlbum);
    renderViewerTabs();
  });
  viewerTabs.append(seeAll);
  for (const child of children) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = viewerEmbedAlbum === child ? "viewer__tab is-active" : "viewer__tab";
    tab.textContent = child.title;
    tab.addEventListener("click", () => {
      viewerEmbedAlbum = child;
      viewerFrame.src = enteEmbedUrl(child);
      viewerTitle.textContent = child.title;
      viewerEnte.href = enteAlbumUrl(child);
      renderViewerTabs();
    });
    viewerTabs.append(tab);
  }
}

function openViewer(album) {
  viewerRootAlbum = album;
  viewerEmbedAlbum = album;
  viewerTitle.textContent = album.title;
  viewerEnte.href = enteAlbumUrl(album);
  viewerEnte.title = `Open ${album.title} in Ente (new tab)`;
  viewerFrame.src = enteEmbedUrl(album);
  renderViewerTabs();
  viewer.showModal();
}

function closeViewer() {
  viewerFrame.src = "";
  viewerRootAlbum = null;
  viewerEmbedAlbum = null;
  if (viewerTabs) {
    viewerTabs.replaceChildren();
    viewerTabs.hidden = true;
  }
  viewer.close();
}

// Anything that leaves for Ente opens a new tab, so the gallery is still there
// when you come back. noopener because _blank otherwise hands the new page a
// handle on this one; noreferrer because the Ente URL carries the album token
// and there is no need to advertise which gallery it came from.
function externalTab(link) {
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function enteLink(album, className) {
  const link = document.createElement("a");
  link.className = className;
  link.href = enteAlbumUrl(album);
  link.textContent = "Open in Ente";
  link.title = `Open ${album.title} in Ente (new tab)`;
  return externalTab(link);
}

function renderSpecial({ all, upload }) {
  const buttons = SPECIAL_KINDS.map((kind) => {
    const album = kind === "all" ? all : upload;
    if (!album) return null;

    // Uploading is not something the embed can do, so that button is a link
    // straight to the album rather than another dialog.
    const button = document.createElement(kind === "upload" ? "a" : "button");
    if (kind === "upload") {
      button.href = enteAlbumUrl(album);
      externalTab(button);
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

function renderCrumbs() {
  crumbsEl.replaceChildren();
  if (viewPath.length === 0) {
    crumbsEl.hidden = true;
    return;
  }
  crumbsEl.hidden = false;

  const root = document.createElement("button");
  root.type = "button";
  root.className = "crumbs__item";
  root.textContent = "All albums";
  root.addEventListener("click", () => {
    viewPath = [];
    renderCurrentView();
  });
  crumbsEl.append(root);

  for (let i = 0; i < viewPath.length; i++) {
    const sep = document.createElement("span");
    sep.className = "crumbs__separator";
    sep.textContent = " / ";
    crumbsEl.append(sep);

    if (i === viewPath.length - 1) {
      const current = document.createElement("span");
      current.className = "crumbs__current";
      current.textContent = viewPath[i].title;
      crumbsEl.append(current);
    } else {
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "crumbs__item";
      crumb.textContent = viewPath[i].title;
      crumb.addEventListener("click", () => {
        viewPath = viewPath.slice(0, i + 1);
        renderCurrentView();
      });
      crumbsEl.append(crumb);
    }
  }
}

function renderCurrentView() {
  if (!albumIndex) {
    albumList.replaceChildren();
    renderCrumbs();
    special.hidden = true;
    return;
  }
  const parts = splitAlbums(albumIndex);
  renderSpecial(parts);
  const { roots, childrenByParent } = groupChildren(parts.regular);
  childrenByParentMap = childrenByParent;
  const currentLevel = viewPath.length
    ? childrenByParent.get(viewPath[viewPath.length - 1].id)
    : roots;
  if (!currentLevel || currentLevel.length === 0) {
    albumList.replaceChildren();
  } else {
    albumList.replaceChildren(
      ...currentLevel.map((album) => {
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

        item.append(button, enteLink(album, "album__ente"));
        const children = childrenByParent.get(album.id);
        if (children && children.length > 0) {
          const subBtn = document.createElement("button");
          subBtn.type = "button";
          subBtn.className = "album__subalbums";
          subBtn.textContent = `${children.length} album${children.length === 1 ? "" : "s"}`;
          subBtn.title = `View albums in ${album.title}`;
          subBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            viewPath.push(album);
            renderCurrentView();
          });
          item.append(subBtn);
        }
        return item;
      }),
    );
  }
  renderCrumbs();
}

function renderAlbums(albums) {
  albumIndex = albums;
  viewPath = [];
  renderCurrentView();
}

function showGallery(albums) {
  renderAlbums(albums);
  gallery.hidden = false;
  lockScreen.hidden = true;
}

function lockGallery() {
  closeViewer();
  albumList.replaceChildren();
  if (crumbsEl) {
    crumbsEl.replaceChildren();
    crumbsEl.hidden = true;
  }
  special.replaceChildren();
  special.hidden = true;
  albumIndex = null;
  viewPath = [];
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
    const albums = await unlock(password);
    const parts = splitAlbums(albums);
    childrenByParentMap = groupChildren(parts.regular).childrenByParent;
    showGallery(albums);
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

