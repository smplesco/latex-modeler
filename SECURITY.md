# Security Policy

LaTeX Modeler runs entirely in your browser (or in the Windows app, which is the
same code in a desktop window). It has no accounts and no server of its own.
Pages and boards live on your device: in files you save, in a folder you choose,
and in your browser's storage. It has two parts:

- **Pages** (the main app at latexmodeler.app): LaTeX pages with real 3D figures,
  auto-modelling, templates and exports.
- **Boards** (board mode at latexmodeler.app/board, formerly Screenboard at
  smplesco.github.io/screenboard): a freehand chalkboard and whiteboard with live
  sessions.

## Supported Versions

LaTeX Modeler doesn't publish numbered releases for the web. The site always
runs the latest code from the `main` branch, and installed copies update
themselves the next time they're opened online. For the Windows app, the latest
release on GitHub is supported.

| Version                                          | Supported          |
| ------------------------------------------------ | ------------------ |
| Latest (latexmodeler.app / `main` branch)        | :white_check_mark: |
| Latest Windows app release                       | :white_check_mark: |
| The old Screenboard address (smplesco.github.io/screenboard), which now only hands boards over and forwards | :white_check_mark: |
| Older copies (downloaded HTML files, forks, installs that haven't updated) | :x: |

If you're reporting a problem, please check it on the live site first.

## Reporting a Vulnerability

**Please don't open a public issue for security problems.**

Report it privately through GitHub instead:

1. Go to this repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe what you found, how to reproduce it, and what someone could do
   with it. A sample `.bd`, `.screenboard` or exported file, or a short screen
   recording, helps a lot.

What to expect:

- **Acknowledgement within 7 days.** This is a one-person hobby project, so
  replies aren't instant, but every report gets read.
- **Updates at least every 14 days** until the report is closed.
- **If it's accepted:** I'll work on a fix, aiming for 30 days or less for
  serious issues, and let you know when it's live. With your permission,
  you'll be credited in the fix's commit message.
- **If it's declined:** I'll explain why (for example, it's out of scope below,
  or it can't be reproduced), and you're welcome to follow up with more detail.

Please give me a reasonable chance to fix a problem before sharing it publicly.

## What's in scope

Things I especially want to hear about:

- A `.bd` page, share link, `.screenboard` file, library backup
  (`.screenboard-backup`), pasted content, dropped file or file shared from
  another app that runs code, reads data it shouldn't, or makes the app contact
  another website when opened.
- An exported HTML page, video, SVG, PDF, PNG, GLB/STL or board file that carries
  hidden scripts or personal data.
- Anything a person in a live board session can send that runs code on someone
  else's screen, gets around watch-only mode, pausing, pinned items or removal,
  or lets them draw after the host has made new links.
- Problems with how pages and boards are kept in your browser's storage, in a
  library folder, or written back to a file you saved.
- A way around the content security policy or the library hash checks described
  under "Third-party code".
- Anything that lets a site other than the old Screenboard address hand boards to
  board mode, or read them back (see "Moving from the old Screenboard address").

## Pages: what stays on your device

- **Open pages** are kept in this browser's storage (localStorage) so they're
  still there next time. Start-screen pictures of templates and examples are
  cached there too.
- **Share links** carry the whole page inside the link itself (after the `#`,
  which browsers never send to a server). Anyone with the link can read the page.
- **Exports** (HTML, video, images, 3D models) are made on your device and
  downloaded. Nothing is uploaded.
- **Ink** (pen, highlighter) you draw on a page is kept with that page in this
  browser's storage, and goes wherever the page goes: its `.bd` file, share link,
  interactive HTML export and SVG export. In a file it is one last comment line
  (`//@ink` followed by a list of strokes). Reading it back only accepts known
  fields, plain `#rrggbb` colours and numbers within limits; anything else is
  dropped, and the line can never run as code.
- **Working offline.** After one visit the browser keeps a copy of the app's own
  files (a service worker, `sw.js`) so pages open without a connection. It only
  stores files from this site, never pages from other sites or anything you type.
  Board mode keeps its own copy the same way (`board/sw.js`). Neither is used in
  the desktop app.
- **Sliders and slides.** The values you set on sliders, and the slide you're on,
  are kept with the page in this browser's storage. Slider values given to the page
  are only ever numbers, clamped to each slider's range.
- **Handwriting** is read on your device (the recogniser and the letter shapes it
  compares with ship with the app). Nothing you write is sent anywhere.
- **TikZ import** only reads the code you paste or open: it never runs LaTeX or
  fetches anything, and what it makes is an ordinary page you can read.
- **PDF and TikZ exports** are made on your device and downloaded.
- **AR.** On Android the camera feed goes to the browser's AR system to find a
  surface; LaTeX Modeler never sees or records it. On iPhone and iPad the page is
  handed to the system's AR Quick Look as a model file made on your device.
- **The presenter window** is a second window of this same page (the browser may
  ask you to allow pop-ups); it shows nothing that isn't already in the page.
- **Board tabs.** A board opened from the start screen runs in a frame from this
  same site. The two only exchange the board's name and id, and a "save now"
  request when you close its tab; messages from anywhere else are ignored.
- **Live recording** captures only the 3D viewer, plus your microphone if you tick
  "mic" (the browser asks first). The video is made on your device and downloaded.

## Pages: presenting live (security model)

- **Peer to peer.** Your browser connects straight to each viewer's browser over
  WebRTC (encrypted). A public PeerJS server (`0.peerjs.com`) only introduces the
  browsers to each other; the page itself never passes through it, and nothing
  is uploaded or stored anywhere. The PeerJS library is the same pinned copy board
  mode uses, checked with Subresource Integrity.
- **The link is the key.** A live link holds a random session id and a random
  10-character key after the `#` (never sent to a server). A viewer who doesn't
  send the right key within 15 seconds is disconnected without seeing anything.
  Anyone you give the link to can watch, until you press **Stop presenting live**.
- **What viewers get:** the page's code and ink, the slide, the timeline time,
  slider values and the camera. Viewers send nothing back except the key. What
  arrives is checked before it's used (sizes, numbers within limits, at most 40
  sliders); a page that arrives is run like any other page, so it can only draw.
- **Viewers' copies** aren't kept unless they press **Save a copy**.

## Boards: LaTeX Modeler figures on a board

- A 3D figure or page on a board is a picture plus the LaTeX Modeler page code it
  came from. The code is run by LaTeX Modeler's own page language, which can't run
  JavaScript, open other pages or use the network.
- LaTeX Modeler draws those figures in a frame from the same site
  (`figure.html`). Board mode only talks to it directly (same origin), and model
  data coming from a board file goes through the same checks as everything else
  in the file (size limits, known fields only; anything else is dropped).
- "Open in LaTeX Modeler" opens a new tab with the page inside the link itself,
  the same way share links work.

## Boards: how live sessions work (security model)

- **Links are the keys.** Anyone with the "Can draw" link can draw on the board,
  and anyone with the "View only" link can watch. Share them like you would a
  meeting link. The host can make new links at any time, which stops the old
  draw link from giving drawing rights.
- **The host is in charge.** Every change passes through the host's browser,
  which ignores changes from people who are only allowed to watch, and can
  remove people. The session ends when the host closes their board.
- **Direct connections.** Browsers connect to each other with WebRTC, which
  encrypts traffic between them. A free public matchmaking service
  ([PeerJS](https://peerjs.com)) introduces the browsers, and, on strict
  networks, may relay the already-encrypted traffic. A public Google server
  (stun.l.google.com) helps each browser find a direct route. These services
  can see connection details such as IP addresses and the random session ID,
  but not what's drawn.
- **Network check.** "Check my network" in the board's Share panel and Settings
  runs the same steps as a real session (loading the connection code, reaching the
  matchmaking server, and trying the direct and relayed routes) without sharing
  anything, and shows which of them your network blocks.
- **Nothing is stored online.** When a session ends, each person keeps their
  own copy of the board on their device. Nothing is kept on a server.

## Boards: your library and files (what stays on your device)

- **The library.** Every board you work on is kept in this browser's storage
  (IndexedDB) on this device: the board itself, small preview pictures, the
  words on it (so search works), and a few earlier versions. None of it is
  uploaded. Turning off "Keep my boards in this browser" in Settings stops it.
  Boards in the trash are removed for good after 30 days.
- **Backups.** "Back up everything" downloads the whole library as one file to
  your device. Restoring a backup only reads the file you pick.
- **Saving to a file.** In browsers that support it, Ctrl+S writes back to the
  file you chose, and board mode remembers that one file so it can save there
  again. The browser asks before the first write.
- **Library folder.** If you choose a folder, board mode reads and writes
  `.screenboard` files in that folder only. If the folder is inside a sync
  service such as OneDrive or Google Drive, that service copies the files under
  its own terms. Board mode itself still sends nothing.
- **Desktop app.** Double-clicking a `.screenboard` file opens it in board mode.
  Board mode asks the app for the file it was opened with, and that is the only
  file it can read this way; it can't name a path of its own.
- **Sharing to board mode.** On Android, a picture or PDF shared to the
  installed app is held in the browser's cache on your device until the app
  opens it, then removed.

## Things board mode asks the browser for

Each of these only happens when you use the feature, and the browser asks you
first where it normally would. Nothing below is sent anywhere by board mode.

- **Camera** for the camera bubble. The video stays on your screen. It is
  included in a recording only if you record while the bubble is showing.
- **Microphone** for recordings with sound (also on pages, for live recording).
- **A window or screen** for "Grab a window", which takes one still picture and
  then stops capturing straight away.
- **Clipboard** to copy a board or selection as a picture, and to paste.
- **Files and folders** as described above.
- **A separate small window** for presenter notes. Notes are saved in the board
  file, and are not sent to people in a live session.
- **Keeping the screen awake** while recording, presenting or in a session.

## Moving from the old Screenboard address

Boards saved at smplesco.github.io/screenboard belong to that address in your
browser, so they're handed over once, when you press **Move my boards** there:

- The old site opens latexmodeler.app/board in a new window and waits for it to
  say it's ready. Then it sends its library backup to that window only, addressed
  to the exact origin `https://latexmodeler.app`.
- Board mode only accepts this from the window that opened it, and only from the
  exact origin `https://smplesco.github.io`. Every board goes through the same
  checks as a backup file, and the old site's copy is left as it was.
- Afterwards the old address forwards to the new one. **Save a backup** is always
  there as a manual alternative.

## Out of scope

- Availability of third-party services (the PeerJS matchmaking and relay
  servers, GitHub Pages, and any sync service you put a library folder in).
- People you've given a link to doing what the link allows, such as drawing
  something unwanted with a "Can draw" link. The host can switch them to watch
  only, erase their drawings or remove them.
- Flooding a live session you've been invited into with large amounts of
  drawing, or other denial-of-service within a session.
- Pages that are slow or heavy because of what their own code asks for (for
  example a huge surface), when nothing outside the page is affected.
- Issues that need someone to already control your device or browser.
- Social engineering, or reports based only on automated scanner output.

## Third-party code

Everything the app needs ships with it and is served from latexmodeler.app.
Nothing loads from other websites, with one exception: board live sessions talk
to the PeerJS matchmaking server.

- **Pages** bundle three.js and MathJax (`vendor/tex-svg-full.js`). Exported
  compact HTML pages load MathJax 3.2.2 from jsDelivr only if a label wasn't
  typeset ahead of time.
- **Boards** bundle MathJax 3.2.2, jsPDF 2.5.1, JSZip 3.10.1, PDF.js 3.11.174 and
  PeerJS 1.5.4 in `board/lib/`, byte-for-byte the files published on npm.
- **Pinned by hash.** Each board library, including the PDF reader's background
  worker, is still tied to the SHA-384 hash of the exact file it was tested
  with. If a copy were ever changed, the browser refuses to run it and the
  feature reports that it couldn't load.
- **Content security policy.** Board mode only allows scripts from the site
  itself, and only allows network connections to the site and the PeerJS
  matchmaking server (0.peerjs.com). Plugins, forms posting to other sites and
  changed base addresses are blocked. Live-session traffic between browsers
  (WebRTC) is separate from this and is described above.

Licences for all bundled code are in `public/licenses/` and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Vulnerabilities in those
libraries should be reported to their own projects, but let me know too if one
affects LaTeX Modeler.
