import { decryptJSON, encryptJSON, DecryptionError } from "./crypto.js";
import {
  parseEnteEmbed,
  suggestId,
  validateAlbums,
  enteEmbedUrl,
  groupChildren,
  splitAlbums,
  SPECIAL_KINDS,
  KIND_LABELS,
} from "./album.js";

const DATA_URL = "albums.enc.json";
const OUTPUT_NAME = "albums.enc.json";
const MIN_PASSWORD_LENGTH = 12;

const loadPasswordEl = document.getElementById("load-password");
const loadBtn = document.getElementById("load");
const loadFileEl = document.getElementById("load-file");
const loadStatusEl = document.getElementById("load-status");
const editorEl = document.getElementById("editor");
const specialsEl = document.getElementById("specials");
const specialStatusEl = document.getElementById("special-status");
const albumListEl = document.getElementById("albums");
const albumCountEl = document.getElementById("album-count");
const addForm = document.getElementById("add-form");
const addSourceEl = document.getElementById("add-source");
const addTitleEl = document.getElementById("add-title");
const addDescriptionEl = document.getElementById("add-description");
const addTokenEl = document.getElementById("add-token");
const addCollectionEl = document.getElementById("add-collection");
const addParentEl = document.getElementById("add-parent");
const addStatusEl = document.getElementById("add-status");
const addBtn = document.getElementById("add");
const outputEl = document.getElementById("output");
const changePasswordEl = document.getElementById("change-password");
const newPasswordBlockEl = document.getElementById("new-password-block");
const reuseNoteEl = document.getElementById("reuse-note");
const newPasswordEl = document.getElementById("new-password");
const passwordNoteEl = document.getElementById("password-note");
const downloadBtn = document.getElementById("download");
const downloadStatusEl = document.getElementById("download-status");

let albums = [];
// Held in this page's memory for the lifetime of the tab and nowhere else: not
// in cookies, localStorage, sessionStorage, or the URL.
let currentPassword = "";

function setStatus(el, message, kind = "") {
  el.textContent = message ?? "";
  el.className = kind ? `status status--${kind}` : "status";
}

function field(labelText, value, onInput) {
  const label = document.createElement("label");
  label.className = "add__label";
  label.textContent = labelText;

  const input = document.createElement("input");
  input.className = "input";
  input.type = "text";
  input.value = value ?? "";
  input.addEventListener("input", () => onInput(input.value));

  return { label, input };
}

// The two special albums get their own editor, one row each, so they are never
// mixed in with the grid albums and can only ever be one of each kind.
function renderSpecials() {
  const parts = splitAlbums(albums);

  specialsEl.replaceChildren(
    ...SPECIAL_KINDS.map((kind) => {
      const album = parts[kind];
      const item = document.createElement("li");
      item.className = "record record--special";
      item.dataset.kind = kind;

      const head = document.createElement("div");
      head.className = "record__head";

      const toggle = document.createElement("label");
      toggle.className = "check check--strong";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = Boolean(album);
      const name = document.createElement("span");
      const kindLabel = document.createElement("span");
      kindLabel.className = "record__kind";
      kindLabel.textContent = KIND_LABELS[kind];
      name.append(kindLabel);
      if (album) {
        const id = document.createElement("span");
        id.className = "record__id";
        id.textContent = album.id;
        name.append(id);
      }
      toggle.append(box, name);
      head.append(toggle);

      if (album) {
        const actions = document.createElement("div");
        actions.className = "record__actions";

        const move = document.createElement("button");
        move.type = "button";
        move.className = "btn";
        move.textContent = "Move to the grid";
        move.addEventListener("click", () => {
          delete album.kind;
          renderAlbums();
          setStatus(specialStatusEl, `"${album.title}" is now a card in the grid.`, "ok");
          setStatus(downloadStatusEl, null);
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn--danger";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          albums.splice(albums.indexOf(album), 1);
          renderAlbums();
          setStatus(specialStatusEl, `Removed the ${KIND_LABELS[kind]} album.`, "ok");
          setStatus(downloadStatusEl, null);
        });

        actions.append(move, remove);
        head.append(actions);
      }

      item.append(head);

      if (album) {
        const grid = document.createElement("div");
        grid.className = "grid grid--pair";

        // Kept in the DOM and toggled rather than added and removed, so that
        // typing into the fields never has to re-render the row and steal focus.
        const note = document.createElement("p");
        note.className = "record__note";
        const syncNote = () => {
          if (!album.token) {
            note.className = "record__note record__note--warn";
            note.textContent = "Needs an Ente link before the database can be encrypted.";
          } else if (!album.collectionId) {
            note.className = "record__note record__note--warn";
            note.textContent =
              "No collection key. The button may still load; paste the full link if it does not.";
          } else {
            note.className = "record__note";
            note.textContent = "";
          }
          note.hidden = note.textContent === "";
        };
        syncNote();

        const fields = [
          field("Title", album.title, (v) => { album.title = v; }),
          field("Description", album.description, (v) => { album.description = v || undefined; }),
          field("Token", album.token, (v) => { album.token = v; syncNote(); }),
          field("Collection key (optional)", album.collectionId, (v) => { album.collectionId = v; syncNote(); }),
        ];
        for (const f of fields) {
          const wrap = document.createElement("div");
          wrap.append(f.label, f.input);
          grid.append(wrap);
        }
        item.append(grid, note);
      } else {
        const empty = document.createElement("p");
        empty.className = "record__note";
        empty.textContent = `No ${KIND_LABELS[kind]} album. Tick the box to add one.`;
        item.append(empty);
      }

      box.addEventListener("change", () => {
        if (box.checked) {
          if (album) return;
          const created = {
            id: kind === "all" ? "all-photos" : "upload",
            title: KIND_LABELS[kind],
            kind,
            token: "",
            collectionId: "",
          };
          if (albums.some((existing) => existing.id === created.id)) created.id = `${created.id}-${kind}`;
          albums.push(created);
          renderAlbums();
          setStatus(specialStatusEl, `Added a ${KIND_LABELS[kind]} album. Paste its Ente link into the fields.`, "ok");
        } else if (album) {
          albums.splice(albums.indexOf(album), 1);
          renderAlbums();
          setStatus(specialStatusEl, `Removed the ${KIND_LABELS[kind]} album.`, "ok");
        }
        setStatus(downloadStatusEl, null);
      });

      return item;
    }),
  );
}


function getDescendantIds(targetId, allAlbums) {
  const descendants = new Set();
  const toVisit = [targetId];
  while (toVisit.length > 0) {
    const current = toVisit.shift();
    for (const album of allAlbums) {
      if (album.parent === current && !descendants.has(album.id)) {
        descendants.add(album.id);
        toVisit.push(album.id);
      }
    }
  }
  return descendants;
}

function parentSelect(excludedIds = new Set()) {
  const select = document.createElement("select");
  select.className = "input";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— none (top level) —";
  select.append(none);
  const { roots, childrenByParent } = groupChildren(albums);
  const appendOptions = (list, depth) => {
    for (const album of list) {
      if (excludedIds.has(album.id)) continue;
      const option = document.createElement("option");
      option.value = album.id;
      const prefix = depth > 0 ? "— ".repeat(depth) + " " : "";
      option.textContent = `${prefix}${album.title}`;
      select.append(option);
      const children = childrenByParent.get(album.id);
      if (children && children.length > 0) {
        appendOptions(children, depth + 1);
      }
    }
  };
  appendOptions(roots, 0);
  return select;
}

// Only the grid albums, plus the one-way promotion into a header button.
function renderGrid() {
  albumListEl.replaceChildren();
  const { roots, childrenByParent } = groupChildren(splitAlbums(albums).regular);
  const renderList = (list, depth) => {
    for (const album of list) {
      const item = document.createElement("li");
      item.className = depth > 0 ? `record record--nested record--depth-${depth}` : "record";
      if (depth > 0) {
        item.style.marginLeft = `${depth * 1.5}rem`;
      }

      const head = document.createElement("div");
      head.className = "record__head";

      const name = document.createElement("div");
      const title = document.createElement("p");
      title.className = "record__title";
      title.textContent = album.title;
      const id = document.createElement("span");
      id.className = "record__id";
      id.textContent = album.id;
      name.append(title, id);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--danger";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        const idx = albums.indexOf(album);
        if (idx === -1) return;
        const promoted = [];
        for (const other of albums) {
          if (other.parent === album.id) {
            delete other.parent;
            promoted.push(other.title);
          }
        }
        albums.splice(idx, 1);
        renderAlbums();
        if (promoted.length > 0) {
          setStatus(downloadStatusEl, `Removed ${album.title}; promoted ${promoted.length} child album${promoted.length === 1 ? "" : "s"} to top level.`);
        } else {
          setStatus(downloadStatusEl, null);
        }
      });

      head.append(name, remove);

      const grid = document.createElement("div");
      grid.className = "grid grid--pair";

      const fields = [
        field("Title", album.title, (v) => { album.title = v; id.textContent = album.id; }),
        field("Description", album.description, (v) => { album.description = v || undefined; }),
        field("Token", album.token, (v) => { album.token = v; }),
        field("Collection key (optional)", album.collectionId, (v) => { album.collectionId = v; }),
      ];
      for (const f of fields) {
        const wrap = document.createElement("div");
        wrap.append(f.label, f.input);
        grid.append(wrap);
      }

      const parentLabel = document.createElement("label");
      parentLabel.className = "add__label";
      parentLabel.textContent = "Parent album (optional)";
      const excluded = new Set([album.id, ...getDescendantIds(album.id, albums)]);
      const parentSel = parentSelect(excluded);
      parentSel.value = album.parent || "";
      parentSel.addEventListener("change", () => {
        if (parentSel.value) {
          album.parent = parentSel.value;
        } else {
          delete album.parent;
        }
        renderAlbums();
      });
      const parentWrap = document.createElement("div");
      parentWrap.append(parentLabel, parentSel);
      grid.append(parentWrap);

      item.append(head, grid);
      albumListEl.append(item);
      const children = childrenByParent.get(album.id);
      if (children && children.length > 0) {
        renderList(children, depth + 1);
      }
    }
  };
  renderList(roots, 0);
}

function renderAlbums() {
  const parts = splitAlbums(albums);
  const counts = [
    parts.all ? "all photos" : null,
    parts.upload ? "upload" : null,
    `${parts.regular.length} in the grid`,
  ].filter(Boolean);
  albumCountEl.textContent = counts.join(", ");
  renderSpecials();
  renderGrid();
}

function showEditor(source) {
  editorEl.hidden = false;
  outputEl.hidden = false;
  setStatus(loadStatusEl, source, "ok");
  renderAlbums();
}

async function openEnvelope(envelope, password) {
  let data;
  try {
    data = await decryptJSON(envelope, password);
  } catch (error) {
    setStatus(
      loadStatusEl,
      error instanceof DecryptionError ? "Wrong password for that database." : error.message,
      "error",
    );
    return false;
  }

  try {
    albums = validateAlbums(data).map((album) => ({ ...album }));
  } catch (error) {
    setStatus(loadStatusEl, `That file decrypted, but the contents are not usable: ${error.message}`, "error");
    return false;
  }

  currentPassword = password;
  showEditor(`Loaded ${albums.length} album(s) from ${envelope.__origin ?? DATA_URL}.`);
  // The password stays in memory for re-encrypting, but not in the form field.
  loadPasswordEl.value = "";
  return true;
}

loadBtn.addEventListener("click", async () => {
  const password = loadPasswordEl.value;
  if (!password) {
    setStatus(loadStatusEl, "Enter the password of the current database.", "error");
    return;
  }

  loadBtn.disabled = true;
  setStatus(loadStatusEl, "Downloading and decrypting…");
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (response.status === 404) throw new Error("There is no albums.enc.json published on this site yet.");
    if (!response.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${response.status}).`);
    const envelope = await response.json();
    envelope.__origin = `${DATA_URL} (published)`;
    await openEnvelope(envelope, password);
  } catch (error) {
    setStatus(loadStatusEl, error.message, "error");
  } finally {
    loadBtn.disabled = false;
  }
});

loadFileEl.addEventListener("change", async () => {
  const file = loadFileEl.files?.[0];
  if (!file) return;
  const password = currentPassword || loadPasswordEl.value;
  if (!password) {
    setStatus(loadStatusEl, "Enter the password for that file first, then choose it again.", "error");
    loadFileEl.value = "";
    return;
  }
  try {
    const envelope = JSON.parse(await file.text());
    envelope.__origin = file.name;
    await openEnvelope(envelope, password);
  } catch (error) {
    setStatus(loadStatusEl, `Could not read that file: ${error.message}`, "error");
  } finally {
    loadFileEl.value = "";
  }
});

addSourceEl.addEventListener("input", () => {
  const text = addSourceEl.value.trim();
  if (!text) return;
  try {
    const { token, collectionId } = parseEnteEmbed(text);
    addTokenEl.value = token;
    addCollectionEl.value = collectionId;
    setStatus(
      addStatusEl,
      collectionId
        ? "Token and collection key read from the link."
        : "Token read from the link. It carried no collection key (#), so paste the full link if the embed does not load.",
      collectionId ? "ok" : "warn",
    );
  } catch {
    setStatus(addStatusEl, null);
  }
});

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setStatus(addStatusEl, null);

  let parsed = { token: addTokenEl.value.trim(), collectionId: addCollectionEl.value.trim() };
  if (addSourceEl.value.trim()) {
    try {
      parsed = parseEnteEmbed(addSourceEl.value);
    } catch (error) {
      setStatus(addStatusEl, error.message, "error");
      return;
    }
  }

  const title = addTitleEl.value.trim();
  const album = {
    id: suggestId(title),
    title,
    description: addDescriptionEl.value.trim() || undefined,
    ...parsed,
  };
  if (addParentEl && addParentEl.value) {
    album.parent = addParentEl.value;
  }

  if (album.id && albums.some((existing) => existing.id === album.id)) {
    album.id = `${album.id}-${albums.length}`;
  }

  try {
    validateAlbums({ albums: [...albums, album] });
  } catch (error) {
    setStatus(addStatusEl, error.message.replace(/^albums\[\d+\]: /, ""), "error");
    return;
  }

  albums.push(album);
  renderAlbums();
  addSourceEl.value = "";
  addTitleEl.value = "";
  addDescriptionEl.value = "";
  addTokenEl.value = "";
  addCollectionEl.value = "";
  if (addParentEl) addParentEl.value = "";
  setStatus(addStatusEl, `Added "${album.title}" to the grid.`, "ok");
  setStatus(downloadStatusEl, null);
});

changePasswordEl.addEventListener("change", () => {
  const changing = changePasswordEl.checked;
  newPasswordBlockEl.hidden = !changing;
  reuseNoteEl.textContent = changing
    ? "The new file will be encrypted with the password below."
    : "The new file will be encrypted with the same password you loaded the database with.";
  if (!changing) {
    newPasswordEl.value = "";
    passwordNoteEl.textContent = "";
    passwordNoteEl.className = "hint";
  }
  setStatus(downloadStatusEl, null);
});

newPasswordEl.addEventListener("input", () => {
  const length = newPasswordEl.value.length;
  if (length === 0) {
    passwordNoteEl.className = "hint";
    passwordNoteEl.textContent = "This becomes the only way to open the gallery. It cannot be recovered.";
  } else if (length < MIN_PASSWORD_LENGTH) {
    passwordNoteEl.className = "hint hint--warn";
    passwordNoteEl.textContent = `${length} characters. Use at least ${MIN_PASSWORD_LENGTH} — this password can be attacked offline.`;
  } else {
    passwordNoteEl.className = "hint";
    passwordNoteEl.textContent = `${length} characters.`;
  }
});

downloadBtn.addEventListener("click", async () => {
  const changing = changePasswordEl.checked;
  const password = changing ? newPasswordEl.value : currentPassword;

  if (password.length === 0) {
    setStatus(
      downloadStatusEl,
      changing
        ? "Choose the password the gallery should use."
        : "Load a database first, or tick 'Change the gallery password' to set a new one.",
      "error",
    );
    (changing ? newPasswordEl : loadPasswordEl).focus();
    return;
  }

  let payload;
  try {
    payload = { albums: validateAlbums({ albums }) };
  } catch (error) {
    setStatus(downloadStatusEl, `Fix this before encrypting: ${error.message}`, "error");
    return;
  }

  downloadBtn.disabled = true;
  setStatus(downloadStatusEl, "Deriving the key and encrypting. This takes a moment at 600,000 iterations…");
  await new Promise((done) => requestAnimationFrame(() => done()));

  try {
    const envelope = await encryptJSON(payload, password);
    const blob = new Blob([`${JSON.stringify(envelope, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = OUTPUT_NAME;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(
      downloadStatusEl,
      changing
        ? `Downloaded ${OUTPUT_NAME} with ${albums.length} album(s) under a new password. Commit it to main to publish.`
        : `Downloaded ${OUTPUT_NAME} with ${albums.length} album(s), same password as before. Commit it to main to publish.`,
      "ok",
    );
    // The file on disk is already encrypted; do not leave the password lying
    // around in the form.
    newPasswordEl.value = "";
    passwordNoteEl.textContent = "";
    passwordNoteEl.className = "hint";
  } catch (error) {
    setStatus(downloadStatusEl, `Could not encrypt: ${error.message}`, "error");
  } finally {
    downloadBtn.disabled = false;
  }
});

// Exposed for the automated checks in tools/.
globalThis.__stormAdmin = {
  getAlbums: () => albums,
  enteEmbedUrl,
};
