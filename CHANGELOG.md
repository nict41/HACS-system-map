# Changelog

All notable changes to System Map Card are documented here. This project
follows [Semantic Versioning](https://semver.org/): the patch digit is a fix,
the minor digit adds a feature, and the major digit changes something that
was already there in a way an existing dashboard would notice.

`VERSION` in `system-map-card.js` is the source of truth and CI refuses to
publish a release whose tag doesn't match it.

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
