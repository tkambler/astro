# Verifying Astronote in Safari

Use real Safari for mobile layout and scrolling regressions. Chromium device
emulation is useful for general responsive work, but it does not exercise
WebKit's viewport, compositing, or scrolling behavior.

## One-time Safari setup

1. In Safari, open **Develop → Developer Settings…**.
2. Enable **Allow remote automation**.
3. In a normal macOS Terminal, run:

   ```sh
   sudo safaridriver --enable
   ```

Safari stores this authorization in:

```text
~/Library/WebDriver/com.apple.Safari.plist
```

The file should contain `AllowRemoteAutomation = true`.

## Agent Safehouse

Safehouse 0.3.1 does not include a Safari/WebDriver integration. The existing
`safe-codex` configuration enables macOS GUI support indirectly through its
Electron integration, but that is not enough for `safaridriver`. SafariDriver
starts an Apple XPC service, and the Safehouse process sandbox prevents that
startup. The symptom is an immediate, silent exit with status 1 even though
Safari remote automation is enabled correctly.

The preferred least-privilege solution is to run SafariDriver outside
Safehouse and let Codex use its localhost WebDriver endpoint:

```sh
# Run this in a normal Terminal and leave it running.
safaridriver -p 4444
```

This keeps Codex sandboxed. Only the Apple driver process runs on the host,
and Codex communicates with it over `127.0.0.1:4444`.

Do not add a broad `mach-lookup` exemption to Safehouse merely to make the
driver start. Adding `~/Library/WebDriver` with `--add-dirs` is also
insufficient by itself: the failure is IPC/XPC access, not just filesystem
access. If Safehouse gains a maintained Safari integration, prefer that
integration. Until then, the host-driver bridge above is the supported local
workflow.

Confirm the bridge from inside `safe-codex`:

```sh
curl -sS http://127.0.0.1:4444/status | jq
```

Expected result:

```json
{"value":{"message":"","ready":true}}
```

## Start an isolated Safari session

SafariDriver creates an isolated automation session. It does not reuse the
normal Safari profile, saved sign-in, or production IndexedDB data.

```sh
curl -sS -X POST http://127.0.0.1:4444/session \
  -H 'Content-Type: application/json' \
  --data '{"capabilities":{"alwaysMatch":{"browserName":"safari"}}}' \
  | tee /tmp/astronote-safari-session.json

session_id=$(plutil -extract value.sessionId raw \
  /tmp/astronote-safari-session.json)
```

Do not enable `safari:automaticInspection` for viewport tests. Opening Web
Inspector can consume the narrow window and cause `innerWidth` to become zero.

Safari currently enforces a minimum automation-window width of 500 pixels.
That still activates Astronote's mobile breakpoint. Set a phone-like height:

```sh
curl -sS -X POST \
  "http://127.0.0.1:4444/session/$session_id/window/rect" \
  -H 'Content-Type: application/json' \
  --data '{"x":40,"y":40,"width":500,"height":932}'
```

Load production:

```sh
curl -sS -X POST \
  "http://127.0.0.1:4444/session/$session_id/url" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://notes.snapcrunch.io"}'
```

For an uncommitted fix, build the browser client and serve it locally:

```sh
npm run build --workspace=@astronote/browser-client
npm run preview --workspace=@astronote/browser-client -- \
  --host 127.0.0.1 --port 4173
```

Then navigate the Safari session to `http://127.0.0.1:4173`.

## Use disposable test notes

Never test destructive operations against the user's normal Safari profile.
The isolated WebDriver profile starts with separate storage, so it is safe to
create many local-only notes there. Use `execute/async` to open
`astronote-local-v2`, add records owned by `guest`, and reload the page.

Each test record must include the complete local note shape:

```js
{
  key: `guest:${id}`,
  ownerId: 'guest',
  id,
  collection: 'Notes',
  title,
  body: '',
  tags: [],
  pinned: false,
  purged: false,
  revision: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
  dirty: true,
  mutationId: id,
  baseRevision: 0,
  syncedBody: '',
  syncedTitle: '',
}
```

Use at least 100 records so the document is much taller than every tested
viewport.

## Scroll and viewport stress test

Test behavior, not merely initial appearance. Run at least 50–60 cycles that:

1. Alternate the Safari window height among values such as 700, 780, 900, and
   932 pixels.
2. Alternate between the top and bottom of the note list.
3. Read element geometry after each operation.
4. Fail immediately if any invariant is violated.

For the mobile app shell, verify:

- `window.scrollY` remains zero and the document does not scroll.
- `.results` is the only vertical scrolling region in the note list.
- `.results.scrollTop` reaches both zero and the bottom of the note list.
- All seeded `.result` rows remain in the DOM.
- `.mobile-list-heading` begins at the viewport top.
- `.omnibar` begins immediately below the mobile heading.
- `.sidebar-heading` begins immediately below the omnibar.
- `.statusbar.getBoundingClientRect().bottom === window.innerHeight` within a
  small subpixel tolerance.
- `.statusbar.getBoundingClientRect().height === 24`; the list footer deliberately
  does not inherit the mutable iOS bottom safe-area inset.
- Opening a note from the middle of the list and pressing **Back to notes**
  restores the previous `.results.scrollTop`.

Do not stop at the list. Repeat the viewport-height cycle for every
`mobile-detail` view and verify that each outer view ends at
`window.innerHeight`:

- Note editor, including `.attachment-dock`.
- Settings section list and an open settings section.
- Account panel.
- Open attachment sheet and its bottom sheet panel.

The app shell uses the dynamic viewport (`100dvh`) so the visible layout follows
browser chrome and software-keyboard changes without introducing document
scrolling.

The mobile shell is fixed to the dynamic viewport and owns exactly one
scrolling region per view. On the notes list that region is `.results`; the
document and the header/footer chrome never scroll. This keeps the bottom safe
area inside the shell instead of positioning the footer against a separately
scrolling document.

## Screenshots and their limits

SafariDriver's screenshot endpoint is not authoritative for nested or
document scrolling. In Safari 26.6.2 it can capture from the wrong scroll
coordinate: fixed chrome may disappear for an inner scroller, and a
document-scrolled page can be returned as an empty background even while DOM
geometry is correct.

Use screenshots for an initial visual check, but use DOM geometry and explicit
scroll assertions for automated pass/fail decisions. For final validation of
an installed iOS PWA, test on a paired physical iPhone or an installed iOS
Simulator runtime. Desktop Safari at a narrow width is real WebKit evidence,
but it does not reproduce iOS safe areas, standalone display mode, or touch
momentum exactly.

## Production verification

After deployment:

```sh
curl -fsS https://notes.snapcrunch.io/api/health
ssh nuc 'cd /home/tim/services/astronote && \
  git rev-parse --short HEAD && \
  docker compose -f docker-compose.nuc.yml ps'
```

Also navigate the existing SafariDriver session to production and rerun the
same scroll, resize, footer, and scroll-restoration assertions. A successful
local run alone is not deployment verification.

## Cleanup

Delete the isolated session when finished:

```sh
curl -sS -X DELETE \
  "http://127.0.0.1:4444/session/$session_id"
```

Then stop the host-side `safaridriver` with **Control-C** in its Terminal.
