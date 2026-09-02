# Changelog

All notable changes to System Map Card are documented here. This project
follows [Semantic Versioning](https://semver.org/): the patch digit is a fix,
the minor digit adds a feature, and the major digit changes something that
was already there in a way an existing dashboard would notice.

`VERSION` in `system-map-card.js` is the source of truth and CI refuses to
publish a release whose tag doesn't match it.

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
