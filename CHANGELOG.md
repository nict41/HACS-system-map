# Changelog

All notable changes to System Map Card are documented here. This project
follows [Semantic Versioning](https://semver.org/): the patch digit is a fix,
the minor digit adds a feature, and the major digit changes something that
was already there in a way an existing dashboard would notice.

`VERSION` in `system-map-card.js` is the source of truth and CI refuses to
publish a release whose tag doesn't match it.

## [1.14.2] - 2026-09-03

### Fixed

- **The card was reading the wrong hundred lines of a tunnel's log.** A
  tunnel configured from its provider's dashboard logs its ingress rules
  exactly once, when it starts, and the card asked Supervisor for the log
  with no line count - so it got the default window, the tail. On a tunnel
  that has been up for days those rules are far behind it. The read
  succeeded, the log was healthy, and it simply did not contain the thing
  being looked for: no routes, so no hostname pills on any card, no lines
  from the tunnel to what it exposes, and no error anywhere to say why. The
  route scan now asks for the whole retained journal, as a `Range` header so
  the signed path stays exactly what was signed, falling back to the plain
  request if the range is refused.
- **A way in whose rules were never found now says so.** Nothing is drawn for
  a route that does not exist, so the map was missing the hostnames and the
  lines to them and looked like it had lost them rather than never having had
  them. The Exposed pill reports it, with what to do about it.
- **A tunnel no longer reports a service category.** It is decided while the
  add-on is still in the services tier, and being a way in moves it out; the
  leftover showed in the evidence panel as `kind: Other services` on
  something the same row called `tier: remote`.

## [1.14.1] - 2026-09-03

### Fixed

- **A tunnel's lines to what it exposes were invisible.** They were drawn -
  one edge per resolved route - but as grey dashed lines identical to the
  thirty others on the map, which left "what is reachable from the internet"
  unanswerable from the picture, in a card that puts that phrase in a tier
  heading. They are now drawn in the same amber as the hostname pill on the
  far end and the boundary node itself, so exposure is one colour wherever it
  appears: an amber line from the tunnel, an amber pill on what it reaches.
- **Hostnames that reached nothing were reported as a plain count.** When a
  tunnel's rules parse but none of them match anything on this machine, no
  pill and no line is drawn for them - so the map looks like the hostnames
  were lost rather than unmatched. The Exposed pill now flags that case and
  says how many, pointing at the evidence panel for what each one aimed at.

### Verified

- Nothing else has been lost since v1.9.0, where hostnames were last
  confirmed working: the whole route pipeline is byte-identical, and the same
  fixture rendered through both versions differs only in the integrations
  grid's label, which was renamed on purpose in 1.12.0.

## [1.14.0] - 2026-09-03

### Added

- **The services tier splits into what kind of service each one is.** It is
  the honest default - an add-on lands there when its ports say nothing more
  specific - so on a real system it ends up holding nearly everything, thirty
  cards in one box. It now draws as up to four labelled boxes:

  - **Network services** - other software connects to it: it publishes a
    protocol the card recognises (SMB, MQTT, NFS, SQL, Redis, mDNS), or its
    manifest offers a service to other add-ons.
  - **Apps** - a person opens it: it has ingress, or publishes a web UI.
  - **Administration** - it can change this system: the Supervisor
    `manager`/`admin` role, the Docker API, full hardware access, the host
    process list or D-Bus, a privileged capability, write access to Home
    Assistant's own configuration, other add-ons' configuration or the
    backups, or an SSH port.
  - **Other services** - running, and the manifest says nothing more.

  Every branch reads a field of the add-on's own manifest, so the answer is
  the same on anyone's instance, and each node's panel and the evidence
  panel both say which category it landed in and on what evidence.

  Two orderings carry the weight. A file server has to map Home Assistant's
  config folders in order to share them, so the protocol it serves decides
  what it is, ahead of that folder access. SSH is the reverse - a protocol
  whose purpose is administering the machine - so port 22 is administrative
  evidence rather than a service offered. Read-only access to the
  configuration is not administration either; add-ons ask to read it far more
  often than to write it.

  The split has to earn itself: four boxes holding one card each are worse
  than one holding four. It applies only when there are at least six services
  and at least two of the *named* categories have real membership - a split
  into one real category plus "Other services" says almost nothing. The
  sub-boxes keep the services colour, so the tier still reads as one tier.
  `group_services: false` turns it off.

## [1.13.2] - 2026-09-03

### Fixed

- **The PNG export still lost the card's styling**, and the previous two
  attempts at this were fixing symptoms. The export worked by copying the
  card's stylesheet into the exported file and filtering out the rules that
  could not apply there - which made a correct picture depend on parsing CSS
  correctly, in a hand-written regex, against a stylesheet that keeps
  growing. Every way that parse could go wrong produced an image that looked
  nothing like the card, with no error anywhere: labels in a serif, tier
  names in sentence case, chip text invisible, node names anchored at the
  start and running out sideways.

  There is no stylesheet in the exported file any more. Each element's
  computed style is read off the live map and written onto the export as
  presentation attributes, so the file carries exactly what the browser
  actually painted - no cascade to re-resolve, no theme variables to look
  up, and nothing to parse. `text-transform`, which restyles glyphs rather
  than the string and so cannot travel as an attribute, is applied to the
  text itself.

  The screenshot harness now compares the export against the live rendering
  and fails if they disagree - every colour, size and anchor the map is drawn
  with has to appear in the exported file. That check is the actual fix here:
  the previous two rounds were verified by looking at a rendered picture,
  which is exactly the kind of check that passes while the bug is still
  there.

## [1.13.1] - 2026-09-03

### Fixed

- **An edge label could be written across a tier's own name.** The label
  placer had been taught to avoid the tier outlines but not the labels
  hanging above them, so "4 hostnames" landed on top of "REMOTE ACCESS /
  ENTRY & EXIT POINTS".

## [1.13.0] - 2026-09-03

Findings from a pass through the card as a user rather than as its author -
on a phone, on a Core install with no Supervisor, and with a real entity
lookup driven end to end.

### Added

- **Keyboard and screen-reader access.** The map was mouse-and-touch only:
  every node, and the detail panel behind it, was unreachable from a
  keyboard, and a screen reader was offered a `<title>` on an unfocusable
  `<g>` it could never land on. Nodes and chips are now focusable, named,
  and activated by Enter or Space through the same handler as a click. The
  icon-only buttons have accessible names rather than tooltips.

### Changed

- **The integration grid draws chips, not circles.** A fixed-radius circle
  with the label written inside truncated `utility_meter (3)` and let
  `systemmonitor` spill over its own edge. A chip sized to its own label has
  neither problem, and the varying widths make the grid easier to scan.
- **The legend moved out of the map.** As an overlay it covered the bottom of
  the map, and on a narrow card it wrapped to four lines and hid half of it -
  an overlay obscuring the thing it annotates.
- **A map too tall for its space fits its width** instead of being shrunk to
  fit entirely. Containing a map this tall in a phone's card renders the node
  names at two or three pixels: technically the whole system, legibly
  nothing. The threshold is the rendered label size, so a desktop card that
  can show everything legibly still does.

### Fixed

- **Panning could scroll the map off-screen.** Nothing clamped the view to
  the map's bounds, so looking up an entity near the bottom centred on the
  answer and left the top half off-screen above a screenful of nothing. The
  clamp is applied where every path meets, so the drag, the pinch, the wheel
  and the finder all obey it.
- **Editing the card in the visual editor leaked a listener set per
  keystroke.** `setConfig` rebuilds the card and the editor calls it on every
  character, so the window, document and card listeners were re-added each
  time: twenty characters meant one click running the detail panel twenty
  times, each with its own render and refetch, and twenty listeners holding
  the card alive for the life of the page. They are bound once and released
  when the card leaves the page.
- **Selecting a config entry in the list dimmed the whole map and lit
  nothing**, since entries are no longer drawn - their integration is. It
  now lights the integration.
- **A dead band of empty space sat between the last tier and the first
  grid**, from stacking sections by summing paddings. They stack from the
  previous box's real bottom edge, at the same gap the tiers use.
- **Edge labels landing on a tier outline had that border drawn through
  them**, which reads as struck-through text. The outlines are obstacles to
  the label placer now, as the nodes already were.
- **A Core or Container install showed the host as `:8123`.** With no
  Supervisor there is no network info, and a bare port is not an address.

## [1.12.0] - 2026-09-03

### Changed

- **One node per integration, not per config entry.** An integration that
  makes an entry per device or per helper - a local Tuya bridge with three
  plugs, a dozen utility meters, switch-as-x - drew a row of identical
  circles that said nothing the single node doesn't. They are merged, with
  the count in the label (`localtuya (3)`), and the merged node wears the
  worst state among its entries so one broken entry out of five can't be
  swallowed by a green circle. Nothing becomes unreachable: the entries are
  still listed individually below the map and in the merged node's own
  detail panel, and the entity finder answers in both currencies at once -
  the integration for the map, the specific entry for the list.

### Fixed

- **The map didn't fit its own view.** The view was fitted on the first
  render and never again, and the first render happens before any data has
  arrived - so the map it fitted was a fraction of the final one. Everything
  that loaded afterwards sat below the bottom edge, which is why the map
  read as tiny and cut off with empty margins either side. It now re-fits
  whenever its own size changes, and stops doing so the moment the user
  zooms or pans, since a view that snapped back on every refresh would be
  worse than one that never moved. The reset button hands control back.

## [1.11.0] - 2026-09-03

### Added

- **Selecting a node lights its own connections.** "What is this joined to"
  is the question a diagram exists to answer, and it was unanswerable: a
  click opened a panel and left two dozen identical grey lines on screen.
  The selected node's edges are drawn in amber with their labels picked out,
  its neighbours stay lit, and everything else dims. The entity finder's
  highlight still outranks a selection when both are live - they are
  different claims.
- **Cards per row is configurable**, and the canvas widens to suit, so a
  landscape dashboard can use its width instead of drawing a tall column of
  cards with empty margins either side. The auto-grids below take their own
  column count from that same width rather than adding a second knob.

### Fixed

- **The PNG export rendered in a serif, with grey pills and no dashed
  boundary.** Two faults. A standalone SVG inherits nothing and SVG's
  default font is a serif, so every label came out in Times while the card
  on screen used the dashboard's font - which it gets by inheritance and
  never declares. And the filter deciding which CSS can apply inside the SVG
  treated anything outside braces as a selector, so a comment above a rule
  was swallowed into that rule's selector; since most rules here are written
  under a comment, what got dropped was the amber hostname pill, the
  edge-label halos, the dashed Internet boundary and the highlight ring.
- **Rows stretched to the full width whatever their length**, so a last row
  of three was spaced like a row of ten and no two rows lined up. Rows now
  keep a fixed column step and centre as a block.

## [1.10.0] - 2026-09-02

### Added

- **Pinch to zoom, and two-finger pan.** A phone has no scroll wheel and the
  on-screen zoom buttons are a poor substitute for the gesture everyone
  already knows. Two fingers now zoom the map about the point between them:
  whatever was under the midpoint when the fingers went down stays under it
  for the whole gesture, so the map tracks the fingers rather than drifting,
  and dragging both fingers pans as a side effect of the same maths. Lifting
  back to one finger resumes panning from where that finger currently is
  instead of jumping the map, and the lift that ends a pinch no longer opens
  the detail panel of whatever happened to be underneath. The card's click
  handling moved into a method of its own so the gesture tests can exercise
  it without standing up the whole shell.

### Fixed

- **The hostname pill was white text on amber.** The rules written for the
  old circular nodes (`.smc-node text`) are more specific than the card's own
  (`.smc-card-name`, `.smc-host-pill-text`), so they won the cascade and
  painted every card, pill included - which is why the pill's dark text never
  applied and the name and address rendered at the same size and colour. The
  circle rules are now scoped to the nodes they were written for, and the
  card rules qualified so they win outright.

## [1.9.0] - 2026-09-02

### Changed

- **Nodes are cards, not circles.** A circle could hold a name and a couple of
  cramped lines beneath it; the facts worth showing per node - name, LAN
  address, public hostname, what is wrong with it - had outgrown that. Each
  node is now a portrait card with a status stripe across the top, the
  add-on's own icon, the wrapped name, and its addresses stacked below.
  Highlighting, dimming, the problem badge and the dashed boundary style all
  moved onto the card's own outline.
- **A public hostname is now a filled amber pill inside its card.** It used to
  be one more grey sub-line, indistinguishable at a glance from the LAN
  address next to it, which defeated the point of deriving it. It now carries
  the same amber as the EXPOSED status pill and the boundary node, so which
  services are reachable from outside reads across the whole map without
  looking anything up.

### Fixed

- **The hostname pill painted black on black.** It shared the `smc-pill` class
  with the status bar's HTML pills, whose rules set `background` - which means
  nothing to an SVG rect - so it fell back to a black fill on a black card and
  the hostname read as ordinary body text. The SVG pill has its own class and
  its own paint rules now, with a test that they exist.
- **Card contents sat at the top of a fixed-height box.** A one-line node left
  half its card empty. The content block is measured and centred instead.

## [1.8.1] - 2026-09-02

### Fixed

- **The PNG export had no icons.** An SVG rendered through an `<img>` fetches
  nothing external, so every add-on icon - a URL into Supervisor - came out
  blank and each node exported as an empty circle. Icons are now inlined as
  data URIs before the map is rasterised; one that can't be fetched is
  dropped rather than failing the export.
- **A tunnel's edges repeated the hostname already on the node.** The target
  wears the hostname as its badge and sub-label, so printing it along the
  edge as well put the same string on screen twice, which reads as two
  different facts. Those edges are now drawn unlabelled.

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
