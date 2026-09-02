# Changelog

All notable changes to System Map Card are documented here. This project
follows [Semantic Versioning](https://semver.org/): the patch digit is a fix,
the minor digit adds a feature, and the major digit changes something that
was already there in a way an existing dashboard would notice.

`VERSION` in `system-map-card.js` is the source of truth and CI refuses to
publish a release whose tag doesn't match it.

## [1.8.0] - 2026-09-02

### Fixed

- **No add-on log had ever been read.** Add-on logs are plain text and the
  WebSocket `supervisor/api` proxy speaks only JSON, so every read through it
  failed - and the failure was disguised: the catch block returned the error
  message *as though it were the log*. A failed read therefore looked like a
  successful one of about sixty bytes, the route parser found no rules in
  those sixty bytes, and the evidence panel dutifully reported "log read
  (60 bytes)". That is why no Cloudflare hostname ever reached a service, and
  why the diagnostics pointed nowhere: they were reporting a success that had
  not happened. Logs are now fetched over REST with the URL signed first -
  the route Home Assistant's own frontend takes for the same endpoint - with
  the WebSocket proxy kept as a fallback. A failure now returns nothing,
  records why, and the evidence panel says **log could not be read** with the
  reason.
- **Add-ons were moved into remote access for merely mentioning a tunnel.**
  Matching an option name is reason enough to spend a log read, and nowhere
  near enough to claim an add-on terminates outside traffic - which is how
  Let's Encrypt (holding a Cloudflare API token for DNS challenges) and
  Pingvin Share (configuring a trusted proxy) ended up filed as entry points.
  Only parsed routes, the tunnel log markers, or a VPN port earn that tier
  now. Regression introduced in 1.7.1.
- **Exporting the map saved an unnamed file.** A detached anchor pointed at a
  multi-megabyte `data:` URL, which several browsers - the companion app's
  webview among them - handle by ignoring the download name. The export now
  goes through a blob URL from an anchor attached to the document, and the
  object URL is revoked on a later tick so the download isn't cancelled
  before it starts.

## [1.7.1] - 2026-09-02

### Fixed

- **A tunnel add-on sat among the ordinary services whenever its rules
  couldn't be read.** The remote-access tier was decided by whether any route
  had been successfully parsed for an add-on - so the same failures that hid
  the hostnames also moved Cloudflared out of "remote access / entry & exit
  points", leaving Tailscale there alone. Being a way in and having readable
  rules are different facts. An add-on is now placed in that tier on its own
  evidence: tunnel-shaped options, or a log that identifies it as one. It is
  drawn one hop from the Internet node either way, labelled `tunnel` rather
  than a hostname count, and says plainly that its routes could not be read.
- The log markers for this are deliberately narrow - the exact lines tunnels
  and VPNs print, not the word "tunnel" or "ingress", which would catch half
  the add-ons on a system given Home Assistant has an ingress of its own.

## [1.7.0] - 2026-09-02

### Fixed

Two ways a Cloudflare hostname could fail to reach the add-on serving it,
both silent:

- **A rule's address had to be confirmed local by `/network/info`.** If that
  endpoint hadn't answered, or reported a different interface from the one
  the rule names, every rule was rejected as "somewhere else" and no service
  got a hostname. Any private address (RFC1918, loopback, link-local, unique
  local IPv6) is now recognised as this machine on its own merits - a tunnel
  ingress rule pointing at `192.168.8.25` needs no corroboration.
- **A remotely-managed tunnel can have empty options**, since it is
  configured entirely outside Home Assistant. Log reading was gated on an
  add-on's options naming a tunnel, so such an add-on was skipped and its
  rules never read. When that cheap path finds nothing, every running
  add-on's log is now scanned and the parser decides - a log either contains
  ingress rules or it doesn't. The usual case is still one or two reads.

### Added

- **The evidence panel shows the whole route chain**, so a hostname that
  doesn't land can be diagnosed instead of guessed at. A new "Route
  discovery" section lists which logs were read, how many bytes and rules
  came out of each, which add-ons were skipped and why, whether the fallback
  scan ran, and what is being treated as local. Each rule then reports the
  host and port parsed out of it, whether that host is this machine, exactly
  why it did or didn't match an add-on, and - when it didn't - every port
  each add-on actually reports.

## [1.6.1] - 2026-09-02

### Fixed

The LAN address was generic already - every add-on publishing a port got
one - but three nodes fell through it, which made it look like a feature
built for one add-on:

- **Home Assistant itself** showed only its public hostname, never its LAN
  address. It is reachable on the network like anything else, and now says
  so.
- **A host-networked SMB server showed nothing at all.** It publishes no
  visible port, so there was no address to show - but a recognised protocol
  implies its own port, and SMB is 445 wherever it runs. Any add-on whose
  role is known now falls back to that role's port.
- **The share node** named the add-on serving it but not where to reach it.
  It now shows the address you would actually type, `\\192.168.8.25\NAS1`.

Both rules are now asserted over every node rather than for a named add-on,
since "it works for Immich" was true the whole time these three were blank.

## [1.6.0] - 2026-09-02

### Added

- **Add-ons wear their own icons.** Nearly every add-on publishes no port the
  card recognises, so nearly every add-on fell back to the same generic
  cloud - a wall of identical shapes that told you nothing. Supervisor serves
  each add-on's real icon, so the card now shows that instead. The endpoint
  needs authentication an `<image>` tag cannot send, so each URL is signed
  first (`auth/sign_path`) exactly as Home Assistant's own frontend does it.
  The icon is drawn inside the circle, leaving a ring of the status colour
  visible around it, and anything without a shipped icon keeps the icon
  derived from what it does.
- **Local and public reachability are both on the map.** "On the LAN" and
  "also reachable from outside" are different facts, so each gets a line
  under the node: Immich reads `192.168.8.25:8080` and `nas.example.com`, one
  above the other. A problem still takes the first line, since that outranks
  both.

## [1.5.0] - 2026-09-02

### Fixed

Three bugs, all of which showed up together on a real instance as "no share
node, and no hostnames on anything".

- **Ports were only ever read from `network`.** An add-on running on the host
  network publishes nothing through that field - it is `null` - and that is
  the normal case for Samba and for several media add-ons. So their ports
  were invisible: no SMB server was detected, no share node was drawn, and
  every tunnel rule pointing at one of their ports failed to match. Ports are
  now also read from the add-on's web-UI template (which carries the literal
  port precisely when there is no mapping to look one up in) and from its
  ingress port.
- **A host-networked Samba is now recognised** by its own `workgroup` option
  when its ports aren't visible. That is a Samba concept and nothing else's,
  which makes it evidence rather than a guess at the add-on's name.
- **Unresolved tunnel rules were silently blamed on Home Assistant.** Any
  local rule whose port matched no add-on fell back to the host, so with
  host-networked add-ons every subdomain was attributed to Home Assistant and
  the add-ons actually serving them got no hostname at all. Only Home
  Assistant's own port resolves to Home Assistant now; anything else is left
  honestly unmatched. Rules pointing at an add-on's container address also
  resolve properly.
- **The status bar never saw the routes.** Add-on options and tunnel rules
  arrive after the first paint, and the late refresh redrew only the graph -
  so the Exposed pill, built entirely from routes, could never appear. The
  whole card is redrawn now.

### Added

- A tunnel add-on wears its own hostnames: `4 hostnames · 1 unmatched` as its
  sub-label, and the full list of hostname → service → what it matched in its
  detail panel. So "what is exposed, and through what" is answerable from the
  map even when a rule cannot be attributed to the add-on behind it.

## [1.4.0] - 2026-09-02

### Added

- **The outside world is a node.** "Which of these is a way in?" was
  answerable only by reading tier labels and edge text. The boundary is now
  drawn - a dashed orange **Internet** node - and every entry point is one
  hop from it, so the shape of the map answers the question. An entry point
  is anything terminating traffic from outside: an add-on publishing
  hostnames through a tunnel, or one running a VPN. Both are established from
  evidence (ingress rules, published ports), not from names, and the edge
  says which - `4 hostnames` or `VPN`. No ways in means no boundary node,
  because there would be nothing to assert.
- **Public hostnames are on the map again**, and this time on the node itself
  rather than in a panel you have to click into: the subdomain is both the
  node's badge and its sub-label, so `nas.example.com` sits under Immich and
  `ha.example.com` under Home Assistant. A hostname outranks the device and
  entity counts for that sub-label, being the more useful thing to know at a
  glance.
- An **Exposed** pill in the status bar: how many hostnames are reachable
  from outside and through what, with the full hostname → service mapping
  behind a click.

### Fixed

- Badge text is no longer forced to upper case. It was written for the words
  it used to hold; a hostname in capitals reads as shouting.

## [1.3.1] - 2026-09-02

### Fixed

- The Release workflow lost a release to a transient GitHub API failure, in
  two compounding ways. The v1.3.0 run passed its tests and version check and
  then got `HTTP 504` from the create-release call - but the call had already
  half-succeeded, leaving a **draft** release behind. A draft has no tag,
  404s from `/releases/tags/`, and is invisible to HACS; worse, the workflow's
  "already released?" check used `gh release view`, which *does* find drafts,
  so a re-run skipped every step and reported success while HACS still saw
  nothing. Creation now retries three times with a backoff, and "already
  released" means published: a draft is published rather than skipped over.

## [1.3.0] - 2026-09-02

### Added

- **The exported share is a node.** Saying "Samba serves NAS1" and "Immich
  reads NAS1" as two edge labels left the reader to join them up. The share
  is now drawn, so the chain is the shape of the picture: disk →
  `serves (moredisks)` → the add-on exporting it → `exports` → **NAS1 (SMB)**
  → `mounts (external_library)` → each consumer. A share takes the state of
  the add-on exporting it, so it goes grey when that add-on stops.
- **An evidence panel** (`show_debug`), listing what the card actually saw
  and what it concluded: per add-on its state, published ports, derived
  roles and tier, option keys, folder mappings, whether its log was read, and
  every edge derived for it - plus the external routes with what each
  resolved to, the discovered hardware with its paths and labels, and the
  fetches that failed. Everything the map claims is inferred from something,
  and this is where to look when an inference is wrong or missing.
- **Service links from logs** (`scan_service_logs`, off by default). An
  add-on often announces what it depends on at runtime rather than in its
  options - Immich reports its machine-learning sidecar as "became healthy
  (http://192.168.8.25:3004)" - and that host:port resolves to another add-on
  exactly as a tunnel's ingress rule does. Off by default because it means
  reading every running add-on's whole log. Only the host and port are ever
  taken from a log line, and a URL carrying credentials is skipped outright
  rather than stripped.

### Fixed

- **Public URLs disappeared.** Routes were parsed from the last 400 lines of
  a tunnel add-on's log, but the ingress rules are logged once at startup -
  so on a tunnel that had been up a while and chattering since, the line had
  scrolled out of the window and every route was lost. Logs are now parsed in
  full; the tail limit applies only to the log shown in the detail panel.

## [1.2.0] - 2026-09-02

### Changed

- **The map is now fully derived.** The hand-written layout, edges and role
  text are gone: there is no longer any node, position or relationship in the
  source that describes one particular home lab. The card is the same code on
  every instance, and a change to the system redraws it rather than making it
  wrong. What replaced each piece:
  - Node positions: a barycentre pass that places a node near the average
    position of what it connects to, tier by tier down the page.
  - Tiers: the ports an add-on publishes. 53 or 67 is network
    infrastructure; a VPN port is remote access; an add-on that publishes
    hostnames for other things is a way in. Anything else is a service,
    which is the honest default.
  - Add-on to add-on edges: the identifiers add-ons use for each other in
    their own options, so `mqtt://core-mosquitto:1883` becomes an edge
    labelled `mqtt.server`.
  - Public URLs and the remote-access tier: the ingress rules of whichever
    add-on is serving tunnels. Read from its options where they live there,
    and **from its log where they don't** - a Cloudflare tunnel can be
    managed from Cloudflare's dashboard, in which case the add-on says so
    itself and the rules only ever appear in the running log. A rule pointing
    at the host's own LAN address is resolved by port to the add-on
    publishing it.
  - Routers: integrations reporting `device_tracker` entities with
    `source_type: router`, which is the one signal for "network
    infrastructure" that doesn't need the integration to be known by name.
  - Role text: generated from the derived facts.
  The only built-in knowledge left is `PORT_ROLES` and
  `DOMAIN_SERVICE_PORTS`, and both are about protocols - what a container
  publishing 53 or 445 or 1883 must be - never about anyone's particular
  add-ons.
- Every add-on is now a node in its tier, so the separate "other add-ons"
  grid is empty on a normal instance.
- Releases are cut automatically when `VERSION` changes on `main`, rather
  than needing a tag to be pushed by hand.

## [1.1.2] - 2026-09-02

### Fixed

- One add-on update counted as two. Home Assistant reports an add-on update
  twice - as an `update.*` entity the Supervisor creates, named
  "<Add-on> Update", and as the `update_available` flag on the add-on itself,
  named "<Add-on>" - and a set of the raw names doesn't collapse those,
  because the two spellings differ by that one word. Deduplication now
  ignores a trailing "update" and punctuation, so the two spellings land on
  the same key, and the shorter name is the one displayed.
- Edge labels no longer pile up. They were drawn at their edge's exact
  midpoint, so several edges converging on one node stacked their labels in
  the same few pixels - around the host, "serves (moredisks)", "admin access"
  and "NAS1 (SMB loop)" were written on top of each other and on the host's
  own name. Labels are now nudged vertically until they clear both each other
  and every node, taking the least-obscured position when nothing is
  completely free, and each is drawn with a halo in the background colour so
  a label crossing an edge line stays readable.

### Changed

- The Release workflow copes with a release published from the GitHub
  website. Publishing there creates the tag, which fires the workflow, which
  previously failed trying to create a release that already existed; it now
  attaches the card to whichever release is there. The tag-vs-`VERSION` check
  runs either way.

## [1.1.1] - 2026-09-02

### Added

- MIT `LICENSE`, which HACS validation requires.

### Fixed

- A Container or Core install has no Supervisor, so all eight Supervisor
  endpoints fail at once and the error strip filled with near-identical "not
  found" messages - which reads like the card is broken when most of it works
  fine without them. Three or more Supervisor failures now collapse to one
  line naming what needs HA OS/Supervised; anything else is still listed
  individually, since those are real faults worth the detail.

### Changed

- The `hacs/action` job in CI is advisory rather than blocking. Its remaining
  findings are entry requirements for the HACS *default store* and don't
  affect installing this repo as a custom repository. See the comment in
  `.github/workflows/validate.yml` for what's outstanding.

## [1.1.0] - 2026-09-02

### Added

- Disks referenced by **filesystem label** rather than path are now matched.
  Samba addresses its disks by label (`moredisks: ["NAS1"]`), so its claim on
  a drive was previously invisible - the matcher only looked for paths like
  `/media/NAS1`. Labels are matched strictly (the option's whole value, or
  the last segment of a path it holds) and labels under three characters are
  ignored, because a substring test on a short label would match half the
  options on the system.
- **Re-published shares are followed.** Several add-ons referencing one disk
  is usually one of them mounting and serving it, and the rest reaching it
  over that share. Where a claimant publishes SMB - detected from its own
  published ports, 445 or 139, not from its name - it gets a `serves
  (moredisks)` edge from the drive, and the other add-ons referencing that
  disk are drawn downstream of *it* with an `SMB: <share>` edge instead of
  hanging off the hardware. That is what the dependency actually is: it's the
  share that breaks when that add-on stops, not the disk. With no SMB server
  among the claimants, every one of them keeps its direct edge as before.
- The drive detail panel separates who mounts a disk from who reaches it over
  the share.

### Fixed

- A disk republished to several add-ons listed all of them under its node,
  overflowing across the tier. The label now names only who mounts it, at
  most two, with the rest in the detail panel.

## [1.0.0] - 2026-09-02

First tagged release. Everything below shipped before tagging began; it is
recorded here so the history isn't lost.

### Added

- Layered topology map of the whole server - hardware, the services using
  it, LAN infrastructure and remote-access entry points - as colour-coded
  tiers with zoom, pan and per-node detail
- Auto-generated grids for every add-on and *every* config entry, so no
  installed thing is ever missing from the map
- Entity finder that resolves an entity to the node(s) serving it, tracing
  through helper entities such as `switch_as_x` back to their real source
- Status bar: Core / OS / Supervisor versions, pending updates, disk free,
  uptime, last backup age, internet connectivity and open repair issues
- Problem detection: entity states, the repairs registry and System Health
  resolved back onto the node that owns them, drawn as a red ring and an
  `n/total unavailable` count
- Hardware discovery from Supervisor's `/hardware/info`, with ownership
  edges derived by finding a device's by-id path or mount point in an
  add-on's own options - labelled with the option that matched
- Live per-add-on CPU, memory, network and disk, plus an optional log tail
- Device / entity / area counts per node, host stat tiles with one-hour
  sparklines, an optional group-by-area layout, a legend, PNG export of the
  whole map, and a background refresh
- Visual editor covering every option, with no YAML required
- `VERSION` constant, shown in the card header and logged to the console

### Fixed

- Visual editor changes had no effect on the card. Every option inside a
  named `ha-form` expandable section was written to
  `config.<section>.<option>`, which `setConfig` never reads, so the form
  worked and the card never changed. Sections are now flattened, and a test
  asserts none of them can regain a name.
- A config change now re-renders from data already in hand instead of
  refetching, so editing in the visual editor no longer fires a dozen API
  calls per keystroke. Data that a newly-enabled option genuinely needs is
  fetched once, and not retried on every subsequent keystroke if it failed.
- The entity finder reported anything outside a hand-written platform table
  as "not modeled on this map" - a camera served by MJPEG, among most other
  integrations. It now falls back to the entity's own config entry, which
  always has a node.
