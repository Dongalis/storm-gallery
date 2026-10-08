# Storm Gallery

A password-protected photo gallery of embedded [Ente](https://ente.com) albums, hosted on
GitHub Pages. No server, no build step, no dependencies.

The Ente album tokens are stored in an AES-GCM encrypted file that is decrypted in the
visitor's browser with a key derived from the gallery password. Only ciphertext is
published, so the tokens are not readable without the password.

There is exactly one encrypted file, `albums.enc.json`, and it is the whole database:
every album lives in it. One password unlocks the entire gallery. There are no per-album
keys and no second file to keep in sync, so adding an album means re-encrypting this one
file.

## Security model

Read this before you rely on it.

- The site is static. All encryption and decryption happens in the browser with
  [WebCrypto](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API).
- Key derivation is PBKDF2-HMAC-SHA256 with 600,000 iterations, 256-bit AES-GCM, and a
  random 16-byte salt plus 12-byte IV per build.
- **The password is never transmitted anywhere.** A visitor who knows it can decrypt the
  album list locally, and that key can then be shared. Treat the password as "access to
  the album list", not as per-user authentication.
- **A weak password can be brute-forced offline.** Anyone can download the ciphertext from
  `albums.enc.json` and try passwords against it without touching your site. Use a
  long, random password; PBKDF2 raises the cost per guess but does not make a guessable
  password safe.
- Password entry is not rate-limited and there is no lockout, because there is no server
  to enforce it. Brute-forcing is only slowed by the KDF cost in the visitor's own browser.
- Once unlocked, the album list lives in the page's memory only. Nothing is written to
  `localStorage`, `sessionStorage`, or cookies, and there is no "remember me".
- The embedded Ente albums are public links on Ente's side. The embed reveals the album
  contents to anyone who has the Ente token; this password only gates your index of
  albums. If you need the photos themselves to be secret, keep the Ente link's own
  password protection enabled.
- `<meta name="robots" content="noindex, nofollow">` is set as a best-effort measure only.

## Local development

```sh
npm run serve   # http://localhost:4173
npm test        # crypto round-trip and validation tests
npm run encrypt # re-encrypt albums.json -> albums.enc.json
```

`npm run encrypt` prompts for the password, or reads it from `GALLERY_PASSWORD`.

## Adding or changing albums

1. In Ente, open the album, create a **public link**, then copy either the link or
   **Copy embed HTML**. The admin page accepts all of these:

   | What you paste | Example |
   | --- | --- |
   | Embed snippet | `<iframe src="https://embed.ente.com/?t=TOKEN#KEY" ...>` |
   | Public album link | `https://albums.ente.com/?t=TOKEN#KEY` |
   | Token only | `https://albums.ente.com/?t=TOKEN` |
   | Newer path link | `https://albums.ente.com/TOKEN#KEY` |
   | Schemeless or relative | `?t=TOKEN#KEY`, `//albums.ente.com/?t=TOKEN#KEY` |

   The host is ignored, so `albums.ente.com`, `embed.ente.com` and a self-hosted
   custom domain all work. A link with no `#` fragment yields a token but no
   collection key; the admin page says so when you paste one, because the
   fragment is a URL fragment and some apps and browsers drop it.
2. Copy `albums.sample.json` to `albums.json` and edit it. `albums.json`
   holds your real tokens and is git-ignored, so it never reaches the repository.
3. Re-encrypt and reload.

```json
{
  "albums": [
    {
      "id": "iceland-2026",
      "title": "Iceland 2026",
      "description": "Ring road, ten days",
      "token": "JK7YPAUXKI",
      "collectionId": "6jaSwxNdfGH8aAmacKDoFFt16BqkmDsfQSSWPJDTc7wy"
    }
  ]
}
```

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | yes | Stable identifier, must be unique. Not shown in the UI. |
| `title` | yes | Card heading, or the tooltip on a special button. |
| `token` | yes | The `t=` value from the Ente link. |
| `collectionId` | no | The `#` fragment from the Ente link, i.e. the collection key. Omit it if your link has no fragment; the embed is then built without one. |
| `description` | no | Secondary line on the card. |
| `parent` | no | ID of a regular grid album to nest under. Cannot be set on albums with `kind: "all"` or `kind: "upload"`. The parent must exist and cannot be a special album. Creates a hierarchy (drill-down in the gallery). |
| `kind` | no | `all` or `upload` to give the album its own header button. Omit for a normal grid album. |

## The two special albums

## Subalbums

Albums can be nested under another regular album by setting `parent` to the target album's `id`. In the gallery:

- Parent albums display a small "N albums" button next to "Open in Ente"; clicking it drills down into that album's children. Breadcrumbs let you go back up.
- Parents still open their Ente embed when you click the card body (the main click is unchanged).
- Special albums (`kind: "all"` and `kind: "upload"`) cannot have a parent and cannot be used as parents.
- Validation prevents cycles and rejects references to unknown or special parents.
- Removing a parent in the admin promotes its children to the top level and reports how many were moved.

**Master album / "All photos":** `kind: "all"` is the manually maintained aggregate collection in Ente. The gallery cannot compute a union of photos across albums from the page; it only embeds Ente iframes. If a subalbum's photos should appear in the master, add them to that Ente aggregate collection yourself. The `parent` hierarchy affects browsing only — it does not automatically add or remove photos from the master.


`kind: "all"` and `kind: "upload"` are ordinary Ente public links that get a button in
the gallery header, next to **Lock**, instead of a card in the grid. There can be one of
each; a second one is rejected so it cannot silently shadow the first. Omit the buttons'
container is automatic — with neither configured, no buttons appear.

- **All photos** — a public link to a collection holding everything you want shown
  here. In Ente this is usually a shared album you keep up to date, since a public link
  points at one collection. It opens the embed, like a grid album.
- **Upload** — a public link with **uploads enabled**. The embed cannot receive uploads,
  so this button does not open the embed at all: it is a link to
  `https://albums.ente.com/?t=…`, the real album, where a visitor can add photos.
  Anyone who can open the gallery can then upload, so only enable this collection's
  uploads if that is what you want.

Add them by ticking the two checkboxes in the **Header buttons** section of
`admin.html`; the titles are filled in for you.

The two kinds are edited **only** there. A record in the album list has no placement
control: it is always a grid card, and its fields are only its own — title, description,
token, collection key. To turn an existing card into a header button, tick the checkbox
and paste the link into the row above; the card keeps its own entry in the grid until you
remove it. The other direction is easier, since each special row has its own **Move to
the grid** button, which drops the kind and turns the album back into a card.

## Opening an album in Ente

Every embed has a way out to Ente proper:

- each grid card has an **Open in Ente** link under it;
- the album dialog has an **Open in Ente** button, which is how you reach Ente from the
  *All photos* button, since that one has no card;
- the *Upload* button is itself a link to the album.

All of them go to `https://albums.ente.com/?t=<token>#<collection key>`, with the
fragment dropped when there is no collection key. Each one opens in a **new tab** and
carries `rel="noopener noreferrer"`, so the gallery is still there when you come back,
the new page gets no handle on this one, and the Ente URL — which carries the album
token — is not advertised to the site you are leaving. `noopener` is what `noreferrer`
implies anyway; it is spelled out because `target="_blank"` is the part that needs it.
The link text does not say "new tab", so each one carries it in its tooltip instead.

`npm run encrypt` fails with a specific message if a field is missing, if an id is
duplicated, if a token contains a character that would break the embed URL, if `kind` is
not one of the two special values, or if a special kind is used twice.

> **Before you publish:** the `albums.enc.json` currently in this repository is a
> throwaway test artifact, encrypted with a known password and containing a sample album.
> Run `npm run encrypt` with your real password and your real `albums.json`, then
> commit the result.

## Editing the database

`admin.html` is a browser-based editor for the album database. It runs entirely
client-side: nothing is uploaded anywhere, and the same PBKDF2/AES-GCM code the
gallery uses does the work.

1. Open `admin.html` on the deployed site.
2. Enter the password of the **currently published** database and choose
   *Load from site*. You can also reopen a file you downloaded earlier.
3. Add albums by pasting the embed snippet Ente gives you; the token and collection
   id are read out of it automatically. Existing albums can be edited or removed.
4. Choose *Encrypt and download*. By default the new file is encrypted with **the same
   password**; tick *Change the gallery password* only if you actually want a new one.
5. Commit the downloaded `albums.enc.json` to `main`. The site serves whatever is
   committed there, so nothing changes until you push.

The admin page is a convenience, not a security boundary: it is gated by exactly the
same password as the gallery, so anyone who can open the gallery can open the editor
and download the database. It has no privileged access to anything.

Passwords are never persisted. They live in the page's memory for the lifetime of the
tab, are not written to cookies, `localStorage` or `sessionStorage`, are never sent
anywhere, and the input fields are emptied as soon as they are no longer needed.

## Deploying to GitHub Pages

Pages serves this repository as-is; `.nojekyll` disables Jekyll processing, so there is
no base-path or Liquid configuration to worry about.

1. In the repository settings, set **Pages → Source** to **Deploy from a branch**, branch
   `main`, folder `/ (root)`.
2. Make sure the committed `albums.enc.json` is encrypted with your real password.
3. Push. The site is served from `https://<user>.github.io/<repo>/`, or from the domain in
   `CNAME` if one is set.

## Branches

`main` is the only branch the site is served from, and it is the only one that may be
pushed. A pre-push hook refuses anything else.

`develop` is local-only and carries everything that is not needed to serve the site:
`tools/`, `package.json`, this README, `albums.sample.json`, and the test suite. Publishing
means copying the runtime files from `develop` onto `main` — the two branches have separate
histories and are not meant to be merged or rebased into each other.

Because the runtime files are copied rather than merged, **`main` and `develop` do not
carry the same `albums.enc.json`**. `develop` keeps a database encrypted with a known
throwaway password so the test suites can run offline; `main` carries the real one. Two
consequences:

- Do not run `npm run encrypt` expecting to publish. It rewrites `develop`'s copy. Replace
  `albums.enc.json` on `main` with the file downloaded from `admin.html` instead.
- If you do replace it, check the diff before pushing: a normal publish touches only the
  runtime files, and a diff that includes `albums.enc.json` means the database is changing
  too.

## Layout

```
index.html              lock screen, album grid, album dialog
admin.html              database editor: load, add, re-encrypt, download
css/style.css           shared styles
css/admin.css           admin page styles
js/crypto.js            PBKDF2 + AES-GCM, shared by the browser and Node
js/album.js             album validation, ente embed URLs, embed link parsing
js/app.js               load, decrypt, render, lock
js/admin.js             the admin page
favicon.svg
albums.enc.json         the database: every album, encrypted (the only one)
albums.json             plaintext album source (git-ignored, never commit)
albums.sample.json      schema reference
tools/encrypt.mjs       re-encrypt the album source
tools/serve.mjs         dependency-free static server for local testing
tools/crypto.test.mjs   node:test suite
```

Changing the password means re-running `npm run encrypt`. There is no way to change it
without the data, and no recovery if it is lost.
