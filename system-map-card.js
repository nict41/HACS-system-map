// Lovelace custom card: a live topology *and health* map of this Home
// Assistant server - discovered physical hardware at the top with the add-on
// that owns each piece derived from that add-on's own options, LAN-wide
// network infrastructure, remote-access entry/exit points in their own
// (colour-coded) section, confirmed externally-exposed services with both
// their internal port and public URL, every remaining add-on and every
// config entry in auto-generated grids (so nothing is ever missing), a
// status bar of the numbers you'd check first, and an entity finder that
// highlights which node(s) serve a given entity - including tracing through
// "helper" entities like switch_as_x back to their real source.
//
// The thing that makes it a monitor rather than a diagram is the joins: an
// add-on can be "started" and an integration "loaded" while every entity
// they serve is dead, so entity states, the repairs registry and System
// Health are all resolved back onto the node that owns them and drawn as a
// ring and a count on that node.
//
// Everything is configurable from the visual editor - see DEFAULTS and
// EDITOR_SCHEMA, which are deliberately written against the same key names
// so an option can't be settable in one and ignored by the other.
//
// Data sources (all live, no backend add-on required):
//   - WS `supervisor/api` {endpoint:"/addons", method:"get"} -> add-on list
//   - WS `supervisor/api` {endpoint:"/addons/<slug>/info", ...} -> full
//     per-add-on detail (state, version, network/ports, and the `options`
//     the hardware-ownership edges are derived from)
//   - WS `supervisor/api` /addons/<slug>/stats + /logs -> live CPU, memory,
//     network and disk per add-on, and a log tail; both fetched only when a
//     node is clicked, since /stats is per-container and polling it for
//     thirty add-ons would be its own performance problem
//   - WS `supervisor/api` /hardware/info -> drives and serial devices, which
//     is where the hardware tier comes from
//   - WS `supervisor/api` /host/info, /os/info, /core/info, /supervisor/info,
//     /network/info, /backups -> the status bar
//   - WS `repairs/list_issues` -> open repair issues, resolved onto nodes
//   - WS `system_health/info` -> per-integration health. This one *streams*
//     (it answers with the domains it knows and then pushes each one's data
//     as its health callback resolves), so it's subscribed to for a moment
//     rather than awaited as a request
//   - WS `history/history_during_period` -> the host-stat sparklines
//   - WS `config/area_registry/list` -> area names, for the counts and the
//     optional group-by-area layout
//   - WS `config_entries/get` -> every integration's domain, title, state,
//     disabled_by, source, and (for helper integrations like switch_as_x)
//     its `options.entity_id` - the entity it wraps
//   - WS `config/device_registry/list` -> device counts per config entry
//   - WS `config/entity_registry/list` -> entity -> platform mapping, used
//     only by the entity finder - fetched LAZILY on first use of that
//     search box, not on card load. An earlier version fetched this
//     upfront alongside everything else and gated the *entire* first
//     render on it; on an instance with a large entity registry that made
//     the whole card (including node clicks) appear stuck on "Loading" -
//     it wasn't a hang, the render pipeline was just waiting on a payload
//     nothing else on the card actually needs.
//   - `hass.states` for System Monitor sensors and the entity-search list
//
// Every one of those beyond the first three is enrichment: each is fetched
// through _fetch(), which records a failure against its own key and lets the
// rest of the card render regardless. Several are Supervisor-only, so an
// instance without the Supervisor degrades to the curated map rather than
// breaking.
//
// Nothing on this map is hand-placed. The hardware tier comes from
// Supervisor's /hardware/info; which add-on owns a device is read out of that
// add-on's own options (findDeviceInOptions looks for the device's by-id
// path, mount point or filesystem label anywhere in the options tree, and
// labels the edge with the option key that matched - `owns (serial.port)`,
// `serves (moredisks)`). An add-on's tier comes from the ports it publishes,
// its edges from the other add-ons it names in its options, and its public
// URL from whichever tunnel add-on is routing a hostname to its port. Node
// positions are computed by a barycentre pass, not authored.
//
// The one piece of built-in knowledge is PORT_ROLES and DOMAIN_SERVICE_PORTS
// below, and that is about protocols - what a container publishing 53 or 445
// or 1883 must be - never about anybody's particular add-ons. So the map is
// the same code on every instance, and moving a dongle or adding a tunnel
// route redraws it rather than making it wrong.
//
// External routes are read from a tunnel add-on's options where they live
// there, and from its log where they don't: a Cloudflare tunnel can be
// managed from Cloudflare's dashboard, in which case the add-on says so
// itself ("All app configuration options except tunnel_token will be
// ignored") and the ingress rules only ever appear in the running log.
//
// The entity finder is necessarily approximate: HA's entity registry records
// which *integration* (platform) created an entity, not which add-on. For
// platforms with an unambiguous single add-on (mqtt -> Zigbee2MQTT +
// Mosquitto, huawei_lte -> the Huawei node, etc.) that's a reliable
// mapping - see DOMAIN_SERVICE_PORTS. Helper integrations that wrap another
// entity (switch_as_x is the confirmed case here - its config entry stores
// `options.entity_id` pointing at the wrapped entity) are resolved through
// to that source entity first, generically, by following `options.entity_id`
// on the entity's owning config entry - not hardcoded to switch_as_x by
// name, so it should also work for any other integration following the same
// convention. Every config entry is now on the map either way: a platform
// with no curated node falls back to the entity's own config entry, and
// every config entry is drawn as a node in the auto-generated "Integrations"
// grid. So "isn't modeled as a node on this map" - which any entity outside
// a hand-written platform table used to hit, camera.* served by
// MJPEG among them - is no longer a reachable answer for an entity backed by
// a config entry. The one honest remaining miss is an entity from a
// YAML-configured platform that has no config entry at all, which the finder
// reports as exactly that rather than guessing.
//
// Install: Settings -> Dashboards -> (three dots) -> Resources -> Add
// resource, URL `/local/system-map-card.js` (bump `?v=` on the URL after
// each edit - browsers cache JS modules aggressively). Then add a card with
// `type: custom:system-map-card`. To make it fill an entire dashboard, put
// it as the only card on a view with View type "Panel".

// Bumped with every release and checked against the git tag by CI, so a
// version in the console is always the version of the file that's running -
// which is the first thing worth knowing when a dashboard misbehaves after
// an update, and the quickest way to catch a stale browser cache.
const VERSION = "1.14.0";

console.info(
  `%c SYSTEM-MAP-CARD %c v${VERSION} `,
  "color: white; background: #3f51b5; font-weight: 700;",
  "color: #3f51b5; background: white; font-weight: 700;"
);

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

// --- export helpers --------------------------------------------------------
// An exported SVG is a document on its own: no stylesheet reaches it, nothing
// resolves the theme's custom properties for it, and SVG's own defaults - a
// serif font, black fill, text anchored at the start - are nothing like what
// the card draws.
//
// This used to be handled by copying the card's rules into the file and
// filtering out the ones that could not apply. That was the wrong shape: it
// made the export depend on parsing CSS correctly, and every way the parse
// could be wrong - a comment glued to a selector, a rule the filter judged
// inapplicable, a var() nested past the regex - showed up as a picture that
// looked nothing like the card, with no error anywhere. So instead of
// re-deriving what the browser would paint, ask it what it *did* paint.

// The properties that decide how an SVG element is drawn. Anything about
// interaction (cursor, pointer-events, transitions) is left behind: a still
// image has none of it.
const SVG_PAINT_PROPS = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
];

// Copies each live element's computed style onto its clone as presentation
// attributes. `live` and `clone` must be the same tree - the clone comes from
// cloneNode(true) - so the two walks stay in step index for index.
const inlineComputedStyles = (live, clone) => {
  const liveEls = [live, ...live.querySelectorAll("*")];
  const cloneEls = [clone, ...clone.querySelectorAll("*")];
  for (let i = 0; i < cloneEls.length && i < liveEls.length; i++) {
    const computed = getComputedStyle(liveEls[i]);
    const el = cloneEls[i];
    for (const prop of SVG_PAINT_PROPS) {
      const value = computed.getPropertyValue(prop);
      // "none" is meaningful for fill and stroke and must be written out;
      // everything else is only worth carrying when it has a value.
      if (value && value !== "normal" && value !== "auto") el.setAttribute(prop, value);
    }
    // text-transform restyles the glyphs, not the string, so it does not
    // survive as an attribute - the tier labels came out in sentence case.
    // Apply it to the text itself instead.
    const transform = computed.getPropertyValue("text-transform");
    if (el.tagName === "text" && transform && transform !== "none") {
      const text = el.textContent || "";
      el.textContent =
        transform === "uppercase"
          ? text.toUpperCase()
          : transform === "lowercase"
            ? text.toLowerCase()
            : text.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    // Styling now travels in the attributes; a class attribute left behind
    // only invites something downstream to try to restyle it.
    el.removeAttribute("class");
  }
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

// Material Design Icons path data (24x24 viewBox), fetched verbatim from
// the @mdi/svg package rather than typed from memory - guessing SVG path
// coordinates by hand would risk silently rendering a garbled icon. One
// icon per curated node below; the auto-generated "other add-ons" grid
// doesn't get custom icons since add-ons don't carry icon metadata via the
// Supervisor API the way entities do.
const ICON_PATHS = {
  chip: "M6,4H18V5H21V7H18V9H21V11H18V13H21V15H18V17H21V19H18V20H6V19H3V17H6V15H3V13H6V11H3V9H6V7H3V5H6V4M11,15V18H12V15H11M13,15V18H14V15H13M15,15V18H16V15H15Z",
  "usb-port": "M8 2C6.9 2 6 2.9 6 4V12H5V16L9 20V22H15V20L19 16V12H18V4C18 2.9 17.11 2 16 2M8 4H16V12H8M9 7V9H11V7M13 7V9H15V7Z",
  harddisk: "M6,2H18A2,2 0 0,1 20,4V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V4A2,2 0 0,1 6,2M12,4A6,6 0 0,0 6,10C6,13.31 8.69,16 12.1,16L11.22,13.77C10.95,13.29 11.11,12.68 11.59,12.4L12.45,11.9C12.93,11.63 13.54,11.79 13.82,12.27L15.74,14.69C17.12,13.59 18,11.9 18,10A6,6 0 0,0 12,4M12,9A1,1 0 0,1 13,10A1,1 0 0,1 12,11A1,1 0 0,1 11,10A1,1 0 0,1 12,9M7,18A1,1 0 0,0 6,19A1,1 0 0,0 7,20A1,1 0 0,0 8,19A1,1 0 0,0 7,18M12.09,13.27L14.58,19.58L17.17,18.08L12.95,12.77L12.09,13.27Z",
  zigbee: "M4.06,6.15C3.97,6.17 3.88,6.22 3.8,6.28C2.66,7.9 2,9.87 2,12A10,10 0 0,0 12,22C15,22 17.68,20.68 19.5,18.6L17,18.85C14.25,19.15 11.45,19.19 8.66,18.96C7.95,18.94 7.24,18.76 6.59,18.45C5.73,18.06 5.15,17.23 5.07,16.29C5.06,16.13 5.12,16 5.23,15.87L7.42,13.6L15.03,5.7V5.6H10.84C8.57,5.64 6.31,5.82 4.06,6.15M20.17,17.5C20.26,17.47 20.35,17.44 20.43,17.39C21.42,15.83 22,14 22,12A10,10 0 0,0 12,2C9.22,2 6.7,3.13 4.89,4.97H5.17C8.28,4.57 11.43,4.47 14.56,4.65C15.5,4.64 16.45,4.82 17.33,5.17C18.25,5.53 18.89,6.38 19,7.37C19,7.53 18.93,7.7 18.82,7.82L9.71,17.19L9,17.95V18.06H13.14C15.5,18 17.84,17.81 20.17,17.5Z",
  robot: "M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7H14A7,7 0 0,1 21,14H22A1,1 0 0,1 23,15V18A1,1 0 0,1 22,19H21V20A2,2 0 0,1 19,22H5A2,2 0 0,1 3,20V19H2A1,1 0 0,1 1,18V15A1,1 0 0,1 2,14H3A7,7 0 0,1 10,7H11V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2M7.5,13A2.5,2.5 0 0,0 5,15.5A2.5,2.5 0 0,0 7.5,18A2.5,2.5 0 0,0 10,15.5A2.5,2.5 0 0,0 7.5,13M16.5,13A2.5,2.5 0 0,0 14,15.5A2.5,2.5 0 0,0 16.5,18A2.5,2.5 0 0,0 19,15.5A2.5,2.5 0 0,0 16.5,13Z",
  "folder-network": "M3,15V5A2,2 0 0,1 5,3H11L13,5H19A2,2 0 0,1 21,7V15A2,2 0 0,1 19,17H13V19H14A1,1 0 0,1 15,20H22V22H15A1,1 0 0,1 14,23H10A1,1 0 0,1 9,22H2V20H9A1,1 0 0,1 10,19H11V17H5A2,2 0 0,1 3,15Z",
  "close-network-outline": "M15,20A1,1 0 0,0 14,19H13V17H17A2,2 0 0,0 19,15V5A2,2 0 0,0 17,3H7A2,2 0 0,0 5,5V15A2,2 0 0,0 7,17H11V19H10A1,1 0 0,0 9,20H2V22H9A1,1 0 0,0 10,23H14A1,1 0 0,0 15,22H22V20H15M7,15V5H17V15H7M15.54,12.12L13.41,10L15.53,7.87L14.12,6.46L12,8.59L9.88,6.46L8.47,7.87L10.59,10L8.47,12.13L9.88,13.54L12,11.41L14.12,13.54L15.54,12.12Z",
  pulse: "M3,13H5.79L10.1,4.79L11.28,13.75L14.5,9.66L17.83,13H21V15H17L14.67,12.67L9.92,18.73L8.94,11.31L7,15H3V13Z",
  "image-multiple": "M22,16V4A2,2 0 0,0 20,2H8A2,2 0 0,0 6,4V16A2,2 0 0,0 8,18H20A2,2 0 0,0 22,16M11,12L13.03,14.71L16,11L20,16H8M2,6V20A2,2 0 0,0 4,22H18V20H4V6",
  brain: "M21.33,12.91C21.42,14.46 20.71,15.95 19.44,16.86L20.21,18.35C20.44,18.8 20.47,19.33 20.27,19.8C20.08,20.27 19.69,20.64 19.21,20.8L18.42,21.05C18.25,21.11 18.06,21.14 17.88,21.14C17.37,21.14 16.89,20.91 16.56,20.5L14.44,18C13.55,17.85 12.71,17.47 12,16.9C11.5,17.05 11,17.13 10.5,17.13C9.62,17.13 8.74,16.86 8,16.34C7.47,16.5 6.93,16.57 6.38,16.56C5.59,16.57 4.81,16.41 4.08,16.11C2.65,15.47 1.7,14.07 1.65,12.5C1.57,11.78 1.69,11.05 2,10.39C1.71,9.64 1.68,8.82 1.93,8.06C2.3,7.11 3,6.32 3.87,5.82C4.45,4.13 6.08,3 7.87,3.12C9.47,1.62 11.92,1.46 13.7,2.75C14.12,2.64 14.56,2.58 15,2.58C16.36,2.55 17.65,3.15 18.5,4.22C20.54,4.75 22,6.57 22.08,8.69C22.13,9.8 21.83,10.89 21.22,11.82C21.29,12.18 21.33,12.54 21.33,12.91M16.33,11.5C16.9,11.57 17.35,12 17.35,12.57A1,1 0 0,1 16.35,13.57H15.72C15.4,14.47 14.84,15.26 14.1,15.86C14.35,15.95 14.61,16 14.87,16.07C20,16 19.4,12.87 19.4,12.82C19.34,11.39 18.14,10.27 16.71,10.33A1,1 0 0,1 15.71,9.33A1,1 0 0,1 16.71,8.33C17.94,8.36 19.12,8.82 20.04,9.63C20.09,9.34 20.12,9.04 20.12,8.74C20.06,7.5 19.5,6.42 17.25,6.21C16,3.25 12.85,4.89 12.85,5.81V5.81C12.82,6.04 13.06,6.53 13.1,6.56A1,1 0 0,1 14.1,7.56C14.1,8.11 13.65,8.56 13.1,8.56V8.56C12.57,8.54 12.07,8.34 11.67,8C11.19,8.31 10.64,8.5 10.07,8.56V8.56C9.5,8.61 9.03,8.21 9,7.66C8.92,7.1 9.33,6.61 9.88,6.56C10.04,6.54 10.82,6.42 10.82,5.79V5.79C10.82,5.13 11.07,4.5 11.5,4C10.58,3.75 9.59,4.08 8.59,5.29C6.75,5 6,5.25 5.45,7.2C4.5,7.67 4,8 3.78,9C4.86,8.78 5.97,8.87 7,9.25C7.5,9.44 7.78,10 7.59,10.54C7.4,11.06 6.82,11.32 6.3,11.13C5.57,10.81 4.75,10.79 4,11.07C3.68,11.34 3.68,11.9 3.68,12.34C3.68,13.08 4.05,13.77 4.68,14.17C5.21,14.44 5.8,14.58 6.39,14.57C6.24,14.31 6.11,14.04 6,13.76C5.81,13.22 6.1,12.63 6.64,12.44C7.18,12.25 7.77,12.54 7.96,13.08C8.36,14.22 9.38,15 10.58,15.13C11.95,15.06 13.17,14.25 13.77,13C14,11.62 15.11,11.5 16.33,11.5M18.33,18.97L17.71,17.67L17,17.83L18,19.08L18.33,18.97M13.68,10.36C13.7,9.83 13.3,9.38 12.77,9.33C12.06,9.29 11.37,9.53 10.84,10C10.27,10.58 9.97,11.38 10,12.19A1,1 0 0,0 11,13.19C11.57,13.19 12,12.74 12,12.19C12,11.92 12.07,11.65 12.23,11.43C12.35,11.33 12.5,11.28 12.66,11.28C13.21,11.31 13.68,10.9 13.68,10.36Z",
  "book-open-page-variant": "M19 2L14 6.5V17.5L19 13V2M6.5 5C4.55 5 2.45 5.4 1 6.5V21.16C1 21.41 1.25 21.66 1.5 21.66C1.6 21.66 1.65 21.59 1.75 21.59C3.1 20.94 5.05 20.5 6.5 20.5C8.45 20.5 10.55 20.9 12 22C13.35 21.15 15.8 20.5 17.5 20.5C19.15 20.5 20.85 20.81 22.25 21.56C22.35 21.61 22.4 21.59 22.5 21.59C22.75 21.59 23 21.34 23 21.09V6.5C22.4 6.05 21.75 5.75 21 5.5V19C19.9 18.65 18.7 18.5 17.5 18.5C15.8 18.5 13.35 19.15 12 20V6.5C10.55 5.4 8.45 5 6.5 5Z",
  "shield-check": "M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1Z",
  "access-point-network": "M4.93,3.93C3.12,5.74 2,8.24 2,11C2,13.76 3.12,16.26 4.93,18.07L6.34,16.66C4.89,15.22 4,13.22 4,11C4,8.79 4.89,6.78 6.34,5.34L4.93,3.93M19.07,3.93L17.66,5.34C19.11,6.78 20,8.79 20,11C20,13.22 19.11,15.22 17.66,16.66L19.07,18.07C20.88,16.26 22,13.76 22,11C22,8.24 20.88,5.74 19.07,3.93M7.76,6.76C6.67,7.85 6,9.35 6,11C6,12.65 6.67,14.15 7.76,15.24L9.17,13.83C8.45,13.11 8,12.11 8,11C8,9.89 8.45,8.89 9.17,8.17L7.76,6.76M16.24,6.76L14.83,8.17C15.55,8.89 16,9.89 16,11C16,12.11 15.55,13.11 14.83,13.83L16.24,15.24C17.33,14.15 18,12.65 18,11C18,9.35 17.33,7.85 16.24,6.76M12,9A2,2 0 0,0 10,11A2,2 0 0,0 12,13A2,2 0 0,0 14,11A2,2 0 0,0 12,9M11,15V19H10A1,1 0 0,0 9,20H2V22H9A1,1 0 0,0 10,23H14A1,1 0 0,0 15,22H22V20H15A1,1 0 0,0 14,19H13V15H11Z",
  "router-wireless": "M20.2,5.9L21,5.1C19.6,3.7 17.8,3 16,3C14.2,3 12.4,3.7 11,5.1L11.8,5.9C13,4.8 14.5,4.2 16,4.2C17.5,4.2 19,4.8 20.2,5.9M19.3,6.7C18.4,5.8 17.2,5.3 16,5.3C14.8,5.3 13.6,5.8 12.7,6.7L13.5,7.5C14.2,6.8 15.1,6.5 16,6.5C16.9,6.5 17.8,6.8 18.5,7.5L19.3,6.7M19,13H17V9H15V13H5A2,2 0 0,0 3,15V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V15A2,2 0 0,0 19,13M8,18H6V16H8V18M11.5,18H9.5V16H11.5V18M15,18H13V16H15V18Z",
  antenna: "M12 7.5C12.69 7.5 13.27 7.73 13.76 8.2S14.5 9.27 14.5 10C14.5 11.05 14 11.81 13 12.28V21H11V12.28C10 11.81 9.5 11.05 9.5 10C9.5 9.27 9.76 8.67 10.24 8.2S11.31 7.5 12 7.5M16.69 5.3C17.94 6.55 18.61 8.11 18.7 10C18.7 11.8 18.03 13.38 16.69 14.72L15.5 13.5C16.5 12.59 17 11.42 17 10C17 8.67 16.5 7.5 15.5 6.5L16.69 5.3M6.09 4.08C4.5 5.67 3.7 7.64 3.7 10S4.5 14.3 6.09 15.89L4.92 17.11C3 15.08 2 12.7 2 10C2 7.3 3 4.94 4.92 2.91L6.09 4.08M19.08 2.91C21 4.94 22 7.3 22 10C22 12.8 21 15.17 19.08 17.11L17.91 15.89C19.5 14.3 20.3 12.33 20.3 10S19.5 5.67 17.91 4.08L19.08 2.91M7.31 5.3L8.5 6.5C7.5 7.42 7 8.58 7 10C7 11.33 7.5 12.5 8.5 13.5L7.31 14.72C5.97 13.38 5.3 11.8 5.3 10C5.3 8.2 5.97 6.64 7.31 5.3Z",
  vpn: "M9,5H15L12,8L9,5M10.5,14.66C10.2,15 10,15.5 10,16A2,2 0 0,0 12,18A2,2 0 0,0 14,16C14,15.45 13.78,14.95 13.41,14.59L14.83,13.17C15.55,13.9 16,14.9 16,16A4,4 0 0,1 12,20A4,4 0 0,1 8,16C8,14.93 8.42,13.96 9.1,13.25L9.09,13.24L16.17,6.17V6.17C16.89,5.45 17.89,5 19,5A4,4 0 0,1 23,9A4,4 0 0,1 19,13C17.9,13 16.9,12.55 16.17,11.83L17.59,10.41C17.95,10.78 18.45,11 19,11A2,2 0 0,0 21,9A2,2 0 0,0 19,7C18.45,7 17.95,7.22 17.59,7.59L10.5,14.66M6.41,7.59C6.05,7.22 5.55,7 5,7A2,2 0 0,0 3,9A2,2 0 0,0 5,11C5.55,11 6.05,10.78 6.41,10.41L7.83,11.83C7.1,12.55 6.1,13 5,13A4,4 0 0,1 1,9A4,4 0 0,1 5,5C6.11,5 7.11,5.45 7.83,6.17V6.17L10.59,8.93L9.17,10.35L6.41,7.59Z",
  "cloud-outline": "M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20M6.5 18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18M12 12Z",
  wordpress: "M3.42,12C3.42,10.76 3.69,9.58 4.16,8.5L8.26,19.72C5.39,18.33 3.42,15.4 3.42,12M17.79,11.57C17.79,12.3 17.5,13.15 17.14,14.34L16.28,17.2L13.18,8L14.16,7.9C14.63,7.84 14.57,7.16 14.11,7.19C14.11,7.19 12.72,7.3 11.82,7.3L9.56,7.19C9.1,7.16 9.05,7.87 9.5,7.9L10.41,8L11.75,11.64L9.87,17.27L6.74,8L7.73,7.9C8.19,7.84 8.13,7.16 7.67,7.19C7.67,7.19 6.28,7.3 5.38,7.3L4.83,7.29C6.37,4.96 9,3.42 12,3.42C14.23,3.42 16.27,4.28 17.79,5.67H17.68C16.84,5.67 16.24,6.4 16.24,7.19C16.24,7.9 16.65,8.5 17.08,9.2C17.41,9.77 17.79,10.5 17.79,11.57M12.15,12.75L14.79,19.97L14.85,20.09C13.96,20.41 13,20.58 12,20.58C11.16,20.58 10.35,20.46 9.58,20.23L12.15,12.75M19.53,7.88C20.2,9.11 20.58,10.5 20.58,12C20.58,15.16 18.86,17.93 16.31,19.41L18.93,11.84C19.42,10.62 19.59,9.64 19.59,8.77L19.53,7.88M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,21.54C17.26,21.54 21.54,17.26 21.54,12C21.54,6.74 17.26,2.46 12,2.46C6.74,2.46 2.46,6.74 2.46,12C2.46,17.26 6.74,21.54 12,21.54Z",
  "share-variant": "M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L15.96,7.19C16.5,7.69 17.21,8 18,8A3,3 0 0,0 21,5A3,3 0 0,0 18,2A3,3 0 0,0 15,5C15,5.24 15.04,5.47 15.09,5.7L8.04,9.81C7.5,9.31 6.79,9 6,9A3,3 0 0,0 3,12A3,3 0 0,0 6,15C6.79,15 7.5,14.69 8.04,14.19L15.16,18.34C15.11,18.55 15.08,18.77 15.08,19C15.08,20.61 16.39,21.91 18,21.91C19.61,21.91 20.92,20.61 20.92,19A2.92,2.92 0 0,0 18,16.08Z",
};

// Hand-placed layout, grouped into four tiers (see `tier` on each node +
// TIER_META/TIER_COLORS below) plus small satellites off their owning node
// (ZHA off Zigbee2MQTT, Immich ML off Immich) and the confirmed
// Cloudflare-exposed services hanging off Cloudflared. Fixed coordinates
// rather than a force-directed graph - predictable and legible without a
// graphing library; zoom/pan makes a bigger canvas practical. Each node's
// `icon` is a key into ICON_PATHS above.
// The tiers, top to bottom. A node's tier is decided by evidence (see
// PORT_ROLES) rather than declared, but the order they stack in, and what
// each one is called, is a presentation choice.
const TIER_ORDER = ["hardware", "services", "network", "remote"];
const TIER_META = {
  hardware: "Physical hardware",
  services: "Services",
  network: "Network infrastructure (LAN)",
  remote: "Remote access / entry & exit points",
};
// Distinct hues per tier so the bounding boxes read as different sections
// at a glance, not just "same grey box repeated four times".
const groupLabel = (group) =>
  group.startsWith("services:") ? SERVICE_CATEGORIES[group.slice(9)] || TIER_META.services : TIER_META[group];
// Sub-groups keep the services colour: they are one tier subdivided, and
// four unrelated hues would read as four tiers.
const groupColor = (group) => TIER_COLORS[group.startsWith("services:") ? "services" : group];

const TIER_COLORS = {
  hardware: "#42a5f5", // blue
  services: "#ab47bc", // purple
  network: "#26a69a", // teal
  remote: "#ffa726", // orange
};
const OTHER_GRID_COLOR = "#78909c"; // neutral - not a real "tier", just leftovers

// What a container publishes says what it is, on any instance - so tiering
// is decided by ports and by evidence, never by an add-on's name or slug.
// This table is the only domain knowledge the card carries, and it is about
// protocols rather than about anyone's particular add-ons.
const PORT_ROLES = [
  { port: 53, role: "DNS resolver", tier: "network" },
  { port: 67, role: "DHCP server", tier: "network" },
  { port: 68, role: "DHCP server", tier: "network" },
  { port: 51820, role: "WireGuard VPN", tier: "remote" },
  { port: 41641, role: "Tailscale", tier: "remote" },
  { port: 1194, role: "OpenVPN", tier: "remote" },
  // `kind` splits the protocols that other software connects to from the one
  // whose whole purpose is administering the machine. SSH is not a service
  // this system offers; it is how you go and change it.
  { port: 445, role: "SMB file server", kind: "service" },
  { port: 139, role: "SMB file server", kind: "service" },
  { port: 2049, role: "NFS server", kind: "service" },
  { port: 1883, role: "MQTT broker", kind: "service" },
  { port: 8883, role: "MQTT broker (TLS)", kind: "service" },
  { port: 3306, role: "MySQL / MariaDB", kind: "service" },
  { port: 5432, role: "PostgreSQL", kind: "service" },
  { port: 6379, role: "Redis", kind: "service" },
  { port: 22, role: "SSH", kind: "admin" },
  { port: 5353, role: "mDNS", kind: "service" },
];

// --- what kind of service is this? -----------------------------------------
// The services tier is the honest default - an add-on lands there when its
// ports say nothing more specific - so on a real system it ends up holding
// nearly everything, thirty-odd identical cards in one box. These split it,
// and every branch cites a field of the add-on's own manifest rather than
// knowing anything about particular add-ons, so the answer is the same on
// anyone's instance and can be shown as evidence rather than asserted.

const SERVICE_CATEGORIES = {
  netsvc: "Network services",
  apps: "Apps",
  admin: "Administration",
  other: "Other services",
};
// Top to bottom: what other things depend on, then what you use, then what
// changes the system, then what we can't say anything about.
const CATEGORY_ORDER = ["netsvc", "apps", "admin", "other"];
// Below this many services in one box there is nothing to break up.
const GROUP_SERVICES_MIN = 6;

// Folders holding Home Assistant's own configuration, another add-on's, or
// the backups. An add-on that can write these can change how the system is
// set up. Deliberately not `addon_config` (its own directory), `ssl`,
// `share` or `media`, which are just places to keep things.
const ADMIN_FOLDERS = new Set(["config", "homeassistant_config", "addons", "all_addon_configs", "addon_configs", "backup"]);
// The capabilities that amount to running as root on the host.
const ADMIN_CAPS = new Set(["SYS_ADMIN", "SYS_RAWIO", "SYS_MODULE", "SYS_PTRACE", "DAC_READ_SEARCH"]);

// `map` comes back as ["config:rw", ...] on older add-ons and as
// [{type, read_only}, ...] on newer ones, and occasionally as an object
// keyed by folder. All three mean the same thing.
const mappedFolders = (info, writableOnly = false) => {
  const raw = info?.map;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([type, v]) => ({ type, ...(v || {}) }));
  return list
    .map((entry) => {
      const object = entry && typeof entry === "object";
      const text = String(object ? entry.type || "" : entry);
      const [folder, mode] = text.split(":");
      // Reading Home Assistant's configuration is not the same as being able
      // to change it, and add-ons ask for one far more often than the other.
      const readOnly = object ? entry.read_only === true : /^ro$/i.test(mode || "");
      return { folder: folder.trim().toLowerCase(), readOnly };
    })
    .filter((e) => e.folder && (!writableOnly || !e.readOnly))
    .map((e) => e.folder);
};

// Order matters here. A file server has to map Home Assistant's config
// folders in order to share them, which would otherwise read as
// "administration" - what it *is* is decided by the protocol it serves. SSH
// is the reverse: a protocol that exists to administer the machine, so port
// 22 counts as administrative evidence rather than as a service offered.
const categoriseService = (info, ports = []) => {
  const served = PORT_ROLES.filter((r) => r.kind === "service" && ports.includes(r.port));
  if (served.length) return { category: "netsvc", why: `serves ${[...new Set(served.map((r) => r.role))].join(", ")}` };
  if ((info?.services || []).some((entry) => /:provide/i.test(String(entry))))
    return { category: "netsvc", why: "its manifest offers a service to other add-ons" };

  const adminPorts = PORT_ROLES.filter((r) => r.kind === "admin" && ports.includes(r.port));
  const folders = mappedFolders(info, true).filter((f) => ADMIN_FOLDERS.has(f));
  const caps = (info?.privileged || []).map((c) => String(c).toUpperCase()).filter((c) => ADMIN_CAPS.has(c));
  const why =
    (adminPorts.length && `serves ${adminPorts.map((r) => r.role).join(", ")}`) ||
    (/^(manager|admin)$/i.test(info?.hassio_role || "") && `holds the Supervisor "${info.hassio_role}" role`) ||
    (info?.docker_api === true && "can drive the Docker API") ||
    (info?.full_access === true && "runs with full hardware access") ||
    (info?.host_pid === true && "shares the host's process list") ||
    (info?.host_dbus === true && "can talk to the host over D-Bus") ||
    (caps.length && `runs privileged (${caps.join(", ")})`) ||
    (folders.length && `can write ${folders.join(", ")}`);
  if (why) return { category: "admin", why };

  if (info?.ingress === true) return { category: "apps", why: "opens in the sidebar through ingress" };
  if (info?.webui) return { category: "apps", why: "publishes a web UI" };
  return { category: "other", why: "no protocol, web UI or system access to go on" };
};

// An integration domain and the port of the service it talks to, so an
// integration can be joined to whichever add-on actually serves it - the
// generic replacement for a hand-written "mqtt entities belong to these two
// add-ons" table.
const DOMAIN_SERVICE_PORTS = {
  mqtt: 1883,
  mariadb: 3306,
  mysql: 3306,
  postgresql: 5432,
  recorder: 3306,
};

// A tunnel's ingress rules point at addresses on this network. Recognising
// them must not depend on /network/info having answered, or on the rule
// naming the same interface the Supervisor reports - so any private address
// counts. This is what makes "http://192.168.8.25:8080" resolvable on an
// instance where the network endpoint returned nothing useful.
function isPrivateAddress(host) {
  return (
    /^127\./.test(host) ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host)
  );
}

// Hostnames that mean "this machine" inside an ingress or proxy rule, so a
// route pointing at one is resolved by port rather than by name.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "homeassistant", "hassio", "supervisor", "host.docker.internal"]);

// Supervisor exposes an add-on to other containers as its slug with
// underscores swapped for hyphens; Docker names the container `addon_<slug>`.
// Both spellings turn up in options and in ingress rules, so both are matched.
function addonIdentifiers(slug) {
  const dashed = String(slug).replace(/_/g, "-");
  return [slug, dashed, `addon_${slug}`, `addon_${dashed}`];
}

// Looks like a hostname someone would put in DNS: at least two labels, a
// non-numeric TLD. Deliberately strict - an option value of "mqtt" or a
// version string must not be mistaken for an external route.
// An icon chosen from what the add-on does, not what it's called.
const ROLE_ICONS = [
  [/DNS|DHCP|mDNS/, "shield-check"],
  [/VPN|Tailscale|WireGuard|OpenVPN/, "vpn"],
  [/SMB|NFS/, "folder-network"],
  [/MQTT/, "access-point-network"],
  [/SQL|Redis|Postgre/, "harddisk"],
  [/SSH/, "robot"],
];
const TIER_ICONS = { network: "access-point-network", remote: "vpn", services: "cloud-outline" };
function iconForAddon(addon, roles, tier) {
  for (const role of roles) {
    const hit = ROLE_ICONS.find(([pattern]) => pattern.test(role.role));
    if (hit) return hit[1];
  }
  // Nothing recognisable published: say so with a neutral icon for the tier
  // rather than implying knowledge the card doesn't have.
  return TIER_ICONS[tier] || "cloud-outline";
}

// Ingress rules as an add-on writes them into its own options. Two shapes
// cover the common tunnel add-ons: a single hostname for Home Assistant
// itself, and a list of {hostname, service} pairs for everything else.
function collectRoutes(options) {
  const out = [];
  if (!options || typeof options !== "object") return out;
  for (const [key, value] of Object.entries(options)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && looksLikeHostname(item.hostname) && item.service) {
          out.push({ hostname: item.hostname, service: item.service, source: `options.${key}` });
        }
      }
    } else if (typeof value === "string" && /host/i.test(key) && looksLikeHostname(value)) {
      // A bare hostname option with nothing to point at is the add-on
      // publishing Home Assistant itself, which is port 8123 by definition.
      out.push({ hostname: value, service: "http://homeassistant:8123", source: `options.${key}` });
    }
  }
  return out;
}

// Routes read out of a running add-on's log. Needed because a tunnel can be
// managed remotely - cloudflared says so itself ("All app configuration
// options except tunnel_token will be ignored") and then logs the ingress
// rules it was handed, as an escaped JSON blob, each time the configuration
// version changes. The last one logged is the one in force.
function routesFromLog(text) {
  if (typeof text !== "string") return [];
  let latest = null;
  for (const match of text.matchAll(/config="((?:[^"\\]|\\.)*)"/g)) {
    try {
      // The blob is JSON that has been escaped *into* a quoted log field, so
      // it needs unescaping before it can be parsed.
      const parsed = JSON.parse(JSON.parse(`"${match[1]}"`));
      if (Array.isArray(parsed?.ingress)) latest = parsed.ingress;
    } catch (_) {
      // A truncated line at the head of the log tail - skip it, a later
      // config= line is the one that matters anyway.
    }
  }
  const out = (latest || [])
    // The catch-all rule has a service but no hostname, and isn't a route.
    .filter((rule) => looksLikeHostname(rule?.hostname) && rule?.service)
    .map((rule) => ({ hostname: rule.hostname, service: rule.service, source: "log" }));

  // Older cloudflared and several proxies log one rule per line instead.
  for (const match of text.matchAll(/hostname=(\S+)\s+service=(\S+)/g)) {
    if (looksLikeHostname(match[1]) && !out.some((r) => r.hostname === match[1])) {
      out.push({ hostname: match[1], service: match[2], source: "log" });
    }
  }
  return out;
}

// Every http(s) endpoint an add-on's log mentions, deduplicated. Used to
// derive "this add-on talks to that one" where the dependency is announced at
// runtime rather than written in the options. Deliberately only host:port -
// no paths, no query strings, nothing that could carry a credential onto the
// map.
function servicesFromLog(text) {
  if (typeof text !== "string") return [];
  const seen = new Map();
  for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+):(\d{2,5})/gi)) {
    const service = `http://${match[1]}:${match[2]}`;
    if (!seen.has(service)) seen.set(service, { service, host: match[1], port: parseInt(match[2], 10) });
  }
  return [...seen.values()];
}

// Does this log belong to something that terminates traffic from outside?
// Deliberately narrow markers: a remotely-managed tunnel may log no ingress
// rules this card can parse, but it still announces itself, and "is this a
// way in" is a much lower bar to clear than "what does it route". Loose
// matching on a word like "tunnel" or "ingress" would catch half the add-ons
// on a system - Home Assistant has its own ingress - so these are the exact
// lines the tunnels and VPNs print.
const TUNNEL_LOG_MARKERS = [
  /tunnelID=/i,
  /Starting tunnel/i,
  /Registered tunnel connection/i,
  /Cloudflare Tunnel/i,
  /\btailscaled?\b/i,
  /\bwireguard\b/i,
  /wg[0-9]+: link becomes ready/i,
];
function looksLikeTunnelLog(text) {
  return typeof text === "string" && TUNNEL_LOG_MARKERS.some((marker) => marker.test(text));
}

// Whose logs are worth reading for routes? An add-on holding a tunnel or
// proxy credential, since that's exactly the case where the rules live
// somewhere else and its options can't tell us anything. Keyed on the option
// names it declares rather than on the add-on's name.
//
// This decides only where to spend a log read. It must never decide a tier:
// the match is loose on purpose, and it catches things that merely *talk* to
// a tunnel provider rather than being one - a certificate add-on with a
// Cloudflare API token for DNS challenges, say.
function looksLikeIngressProvider(options, prefix = "") {
  if (!options || typeof options !== "object") return false;
  return Object.entries(options).some(([key, value]) => {
    if (/tunnel|ingress|proxy|zone|cloudflare/i.test(key)) return true;
    return value && typeof value === "object" && !Array.isArray(value) && looksLikeIngressProvider(value, key);
  });
}

function looksLikeHostname(value) {
  return typeof value === "string" && /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(value.trim());
}

const HOST_STATS = [
  { key: "cpu", label: "CPU", entity: "sensor.processor_use", suffix: "%" },
  { key: "ram", label: "RAM", entity: "sensor.system_monitor_memory_use_percent", suffix: "%" },
  { key: "disk", label: "Disk (/config)", entity: "sensor.disk_use_percent_config", suffix: "%" },
];


const INTERNET_COLOR = "#ffa726"; // the boundary, in the remote tier's own hue
const COLORS = {
  started: "var(--success-color, #43a047)",
  loaded: "var(--success-color, #43a047)",
  stopped: "var(--disabled-text-color, #9e9e9e)",
  not_loaded: "var(--disabled-text-color, #9e9e9e)",
  error: "var(--error-color, #db4437)",
  setup_error: "var(--error-color, #db4437)",
  disabled: "var(--warning-color, #ff9800)",
  ignored: "var(--warning-color, #ff9800)",
  host: "var(--primary-color, #3f51b5)",
  hardware: "#546e7a",
  internet: INTERNET_COLOR,
  unknown: "#78909c",
};

function colorFor(status) {
  return COLORS[status] || COLORS.unknown;
}

function addonStatus(addon) {
  if (!addon) return "unknown";
  if (addon.state === "started") return "started";
  if (addon.state === "stopped") return "stopped";
  if (addon.state === "error") return "error";
  return addon.state || "unknown";
}

function describeError(e) {
  if (!e) return "unknown error";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

function entryStatus(entry) {
  if (!entry) return "unknown";
  if (entry.disabled_by) return "disabled";
  if (entry.source === "ignore") return "ignored";
  if (entry.state && entry.state !== "loaded") return "error";
  return "loaded";
}

// The state a merged node should wear. Worst wins, because one dead entry
// out of five is exactly the fact merging must not swallow - "loaded" on a
// node covering a broken integration would be a lie the map tells.
const STATUS_SEVERITY = { error: 4, unknown: 3, disabled: 2, ignored: 2, stopped: 2, loaded: 1, started: 1 };
function worstStatus(statuses) {
  return statuses.reduce(
    (worst, s) => ((STATUS_SEVERITY[s] || 3) > (STATUS_SEVERITY[worst] || 3) ? s : worst),
    statuses[0] || "unknown"
  );
}

// "Inactive" for the purposes of the hide-inactive filter - deliberately
// narrower than "not green": an add-on/integration in an *error* state
// stays visible even with the filter on, since that's something the user
// probably wants to notice, not hide.
function isInactiveStatus(status) {
  return status === "stopped" || status === "disabled" || status === "ignored";
}

// Add-on `network` field (e.g. {"80/tcp": 5051}) -> readable summary.
// `null` host-port means the container port isn't published to the host
// (only reachable from other containers / via ingress).
function formatNetwork(network) {
  if (!network || typeof network !== "object") return null;
  const parts = Object.entries(network).map(([containerPort, hostPort]) =>
    hostPort ? `${containerPort} → host:${hostPort}` : `${containerPort} (internal only)`
  );
  return parts.length ? parts.join(", ") : null;
}

// Grid layout for anything not placed in a tier above -
// this is what keeps the map from ever "missing" something again as
// add-ons come and go, without hand-placing coordinates for each one.
// Chip geometry for the auto-grids. A chip is sized to its own label, so
// there is no column count to configure - they flow and wrap at the canvas
// edge, whatever width the tier layout above them was given.
// The vertical gap between one labelled box and the next, tiers and grids
// alike, with room above each for its own label.
// A node name is drawn at this size in user units; below about six device
// pixels it is a grey smudge rather than a word, and that is the line
// between "the whole map" being useful and being decorative.
const CARD_NAME_PX = 12.5;
const MIN_READABLE_PX = 6;
const TIER_BOX_GAP = 46;
const CHIP_H = 28;
const CHIP_GAP = 10;
const GRID_PAD = 16;
// 11px at the dashboard's font, averaged. Only needs to be close: it decides
// where a chip wraps, and a few pixels either way is a slightly ragged right
// edge, not a broken layout.
const CHIP_CHAR_W = 6.1;
const chipWidth = (label) => Math.round(30 + String(label).length * CHIP_CHAR_W);
const OTHER_GRID = { marginX: 90, rowH: 40 };
// Deliberately denser than the add-on grid: there are roughly ten times as
// many config entries as leftover add-ons, and at the add-on grid's spacing
// they alone would stretch the map tall enough to make fit-to-view useless.
const ENTRY_GRID = { marginX: 80, rowH: 38 };
const ENTRY_GRID_COLOR = "#5c6bc0"; // indigo - distinct from the four tiers and the add-on grid
const GRID_START_Y = 1180; // first auto-grid sits below the curated layout

// Hardware row geometry. The host occupies slot 0; discovered devices fill
// the rest of the row and wrap, and everything below the hardware tier is
// pushed down by however many extra rows that takes (see _layout).
// Everything here comes from the Supervisor, which a Container or Core
// install doesn't have. Their failures are one fact, not eight, and are
// reported as one - see _renderErrors.
const SUPERVISOR_KEYS = new Set(["addons", "host", "core", "os", "supervisor", "network", "backups", "hardware"]);

// A node is a card, not a circle. 148 wide is set by the longest thing it
// has to hold legibly - a hostname like "share.nicholastoo.com" at 9.5px -
// since a truncated hostname defeats the point of showing one at all.
const CARD_W = 148;
const CARD_H = 144;
const CARD_HOST_W = 166; // the host earns a little more room
const CARD_HOST_H = 152;
const cardSize = (n) => (n.kind === "host" ? { w: CARD_HOST_W, h: CARD_HOST_H } : { w: CARD_W, h: CARD_H });

// Auto-layout geometry for the tiers below the hardware row.
const LAYOUT_ROW_H = 182; // a card plus breathing room
const LAYOUT_TIER_GAP = 40;
const LAYOUT_MARGIN_X = 110;
const LAYOUT_COL_STEP = 200; // a 148-wide card plus the gap between columns
const LAYOUT_DEFAULT_COLUMNS = 6;
const LAYOUT_MIN_COLUMNS = 3;
const LAYOUT_MAX_COLUMNS = 12;

const HW_ROW_H = 182;
const HW_MARGIN_X = 90;

// The canvas is as wide as the column count needs it to be, rather than the
// column count being squeezed into a fixed canvas - otherwise asking for more
// columns just draws the same cards closer together until they overlap. A
// wide dashboard can therefore be told to use its width.
const layoutGeometry = (columns) => {
  const cols = clamp(Math.round(columns) || LAYOUT_DEFAULT_COLUMNS, LAYOUT_MIN_COLUMNS, LAYOUT_MAX_COLUMNS);
  const width = 2 * LAYOUT_MARGIN_X + (cols - 1) * LAYOUT_COL_STEP;
  // One more slot than the service rows: the hardware row is a header, and
  // an odd count keeps the host in the true middle of it.
  const hwPerRow = cols + 1;
  const hostCol = Math.floor(hwPerRow / 2);
  // First-row devices fill outward from the host rather than left-to-right,
  // so a single dongle lands next to the host, not at the far edge.
  const row0 = [];
  for (let d = 1; row0.length < hwPerRow - 1; d++) {
    if (hostCol - d >= 0) row0.push(hostCol - d);
    if (hostCol + d < hwPerRow && row0.length < hwPerRow - 1) row0.push(hostCol + d);
  }
  const hwColW = (width - 2 * HW_MARGIN_X) / (hwPerRow - 1);
  return {
    cols,
    width,
    hwPerRow,
    hostCol,
    hwColX: (col) => HW_MARGIN_X + col * hwColW,
    // Slots beside the host on row 0; everything after wraps into full rows.
    hwSlot: (i) =>
      i < row0.length
        ? { row: 0, col: row0[i] }
        : { row: 1 + Math.floor((i - row0.length) / hwPerRow), col: (i - row0.length) % hwPerRow },
    hwRowCount: (n) => (n <= row0.length ? 1 : 1 + Math.ceil((n - row0.length) / hwPerRow)),
  };
};

// Every user-facing option, with its default. This object is the single
// source of truth for the card's config: setConfig() spreads it, and the
// visual editor's schema below is written against the same key names, so a
// new option can't end up settable in one and ignored by the other.
const DEFAULTS = {
  title: "System Map",
  graph_height: 480,
  // Columns of service cards. The canvas widens to suit, so a landscape
  // dashboard can be told to use its width instead of drawing a tall
  // column of cards with empty margins either side.
  columns: LAYOUT_DEFAULT_COLUMNS,
  refresh_interval: 60, // seconds; 0 disables background refresh
  hide_inactive: false,
  // Sections
  show_status_bar: true,
  show_host_stats: true,
  show_legend: true,
  show_entity_finder: true,
  show_addon_grid: true,
  show_integration_grid: true,
  show_integration_list: true,
  // Data joins
  highlight_problems: true, // unavailable entities / repair issues / error states
  show_counts: true, // devices - entities - areas per node
  show_addon_stats: true, // live CPU/RAM in the detail panel
  show_addon_logs: false, // log tail in the detail panel - off by default, logs can carry secrets
  show_sparklines: true, // host CPU/RAM history strip
  discover_hardware: true, // build the hardware tier from Supervisor's hardware/info
  group_by_area: false,
  // Split the services tier into Apps / Network services / Administration,
  // each from the add-on's own manifest. Ignored when there are too few
  // services for the split to tell anyone anything.
  group_services: true,
  scan_service_logs: false, // read every running add-on's log for services it dials
  show_debug: false, // the evidence panel: what the card saw, and what it concluded
  tiers: ["hardware", "services", "network", "remote"],
  // Overrides for instances that don't run System Monitor under these names
  cpu_entity: "",
  ram_entity: "",
  disk_entity: "",
  temperature_entity: "",
};

// ha-form schema for the visual editor. Grouped into expandable sections so
// the panel opens short: title and the two numbers people actually change
// first, everything else folded away.
const EDITOR_SCHEMA = [
  { name: "title", selector: { text: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "graph_height", selector: { number: { min: 240, max: 1600, step: 20, unit_of_measurement: "px", mode: "box" } } },
      { name: "refresh_interval", selector: { number: { min: 0, max: 3600, step: 10, unit_of_measurement: "s", mode: "box" } } },
      {
        name: "columns",
        selector: {
          number: { min: LAYOUT_MIN_COLUMNS, max: LAYOUT_MAX_COLUMNS, step: 1, mode: "slider" },
        },
      },
    ],
  },
  {
    // name MUST stay empty and flatten MUST stay true on every expandable
    // here. ha-form nests a named section's values under that name - a
    // toggle inside `name: "sections"` is written to
    // config.sections.show_status_bar, which setConfig never looks at, so
    // the form appears to work and changes nothing. Empty name is the
    // long-standing way to flatten (getValue returns the whole data object
    // when a schema item has no name); `flatten: true` is the explicit
    // modern spelling. Both are set so this holds on either. The header text
    // comes from `title`, since with no name there's nothing to label.
    type: "expandable",
    name: "",
    flatten: true,
    title: "Sections & tiers",
    icon: "mdi:view-dashboard-outline",
    schema: [
      {
        type: "grid",
        name: "",
        schema: [
          { name: "show_status_bar", selector: { boolean: {} } },
          { name: "show_host_stats", selector: { boolean: {} } },
          { name: "show_sparklines", selector: { boolean: {} } },
          { name: "show_legend", selector: { boolean: {} } },
          { name: "show_entity_finder", selector: { boolean: {} } },
          { name: "show_addon_grid", selector: { boolean: {} } },
          { name: "show_integration_grid", selector: { boolean: {} } },
          { name: "show_integration_list", selector: { boolean: {} } },
        ],
      },
      {
        name: "tiers",
        selector: {
          select: {
            multiple: true,
            mode: "list",
            options: [
              { value: "hardware", label: "Physical hardware" },
              { value: "services", label: "Services using that hardware" },
              { value: "network", label: "Network infrastructure (LAN)" },
              { value: "remote", label: "Remote access / entry & exit points" },
            ],
          },
        },
      },
    ],
  },
  {
    type: "expandable",
    name: "",
    flatten: true,
    title: "Live data & joins",
    icon: "mdi:database-search-outline",
    schema: [
      {
        type: "grid",
        name: "",
        schema: [
          { name: "highlight_problems", selector: { boolean: {} } },
          { name: "show_counts", selector: { boolean: {} } },
          { name: "discover_hardware", selector: { boolean: {} } },
          { name: "group_by_area", selector: { boolean: {} } },
          { name: "group_services", selector: { boolean: {} } },
          { name: "show_addon_stats", selector: { boolean: {} } },
          { name: "show_addon_logs", selector: { boolean: {} } },
          { name: "scan_service_logs", selector: { boolean: {} } },
          { name: "show_debug", selector: { boolean: {} } },
          { name: "hide_inactive", selector: { boolean: {} } },
        ],
      },
    ],
  },
  {
    type: "expandable",
    name: "",
    flatten: true,
    title: "Host stat entities (leave empty to auto-detect)",
    icon: "mdi:speedometer",
    schema: [
      { name: "cpu_entity", selector: { entity: { domain: ["sensor"] } } },
      { name: "ram_entity", selector: { entity: { domain: ["sensor"] } } },
      { name: "disk_entity", selector: { entity: { domain: ["sensor"] } } },
      { name: "temperature_entity", selector: { entity: { domain: ["sensor"] } } },
    ],
  },
];

// ha-form renders `name` verbatim unless given a label, and "show_addon_logs"
// is not a label. Kept next to the schema so the two stay in step.
const EDITOR_LABELS = {
  title: "Title",
  graph_height: "Map height",
  columns: "Cards per row",
  refresh_interval: "Refresh every (0 = off)",
  hide_inactive: "Hide inactive by default",
  show_status_bar: "Status bar",
  show_host_stats: "Host stats",
  show_sparklines: "Sparklines",
  show_legend: "Legend",
  show_entity_finder: "Entity finder",
  show_addon_grid: "Add-on grid",
  show_integration_grid: "Integration grid",
  show_integration_list: "Integration list",
  tiers: "Tiers to draw",
  highlight_problems: "Flag problems",
  show_counts: "Device / entity counts",
  discover_hardware: "Discover hardware",
  group_by_area: "Group by area",
  group_services: "Group services by kind",
  show_addon_stats: "Add-on CPU / RAM",
  show_addon_logs: "Add-on log tail",
  scan_service_logs: "Scan logs for service links (slow)",
  show_debug: "Show the evidence panel",
  cpu_entity: "CPU",
  ram_entity: "Memory",
  disk_entity: "Disk",
  temperature_entity: "Temperature",
};

// --- small formatters -------------------------------------------------------

function formatBytes(n) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// Coarse on purpose: this is read at a glance next to a version number, so
// "3 days" beats "3d 4h 12m".
function formatAge(sinceMs) {
  if (!isFinite(sinceMs) || sinceMs < 0) return null;
  const mins = Math.floor(sinceMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}

function parseDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return isFinite(t) ? t : null;
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

// A by-id path like "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_..." carries
// the vendor and product; the trailing serial is noise on a 32px circle.
function prettySerialName(device) {
  const raw = String(device.by_id || device.name || "serial");
  const tail = raw.split("/").pop().replace(/^usb-/, "");
  const words = tail.split(/[_-]/).filter(Boolean);
  const trimmed = words.slice(0, 4).join(" ");
  return trimmed || device.dev_path || "Serial device";
}

// Walks an add-on's options looking for a reference to `device`, and returns
// {option, matched} - the option key that matched and the exact string it
// matched on. Recursive because options nest (Zigbee2MQTT keeps its adapter
// under `serial.port`, Samba its disks under `moredisks`).
function findDeviceInOptions(options, device, prefix = "") {
  if (!options || typeof options !== "object") return null;
  for (const [key, value] of Object.entries(options)) {
    const option = prefix ? `${prefix}.${key}` : key;
    const strings =
      typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v) => typeof v === "string") : null;
    if (strings) {
      for (const str of strings) {
        const matched = matchDeviceValue(str, device);
        if (matched) return { option, matched };
      }
    } else if (value && typeof value === "object") {
      const hit = findDeviceInOptions(value, device, option);
      if (hit) return hit;
    }
  }
  return null;
}

// Two kinds of reference need two kinds of match, and conflating them is
// wrong in both directions:
//   - A *path* is matched as a substring, because add-ons store device paths
//     inside longer strings (a device spec with a suffix, a URI).
//   - A *filesystem label* cannot be. Samba addresses disks by label, not
//     path (`moredisks: ["NAS1"]`), and a substring test on a short label
//     like "NAS1" or "MEDIA" would match half the options on the system. So
//     a label has to *be* the option's value, or the last segment of a path
//     it holds - which still catches both `NAS1` and `/media/NAS1`.
function matchDeviceValue(value, device) {
  const path = (device.paths || []).find((p) => p && value.includes(p));
  if (path) return path;
  const trimmed = String(value).trim().replace(/\/+$/, "");
  const tail = trimmed.split("/").pop().toLowerCase();
  const lower = trimmed.toLowerCase();
  return (device.labels || []).find((l) => l.toLowerCase() === lower || l.toLowerCase() === tail) || null;
}

// An add-on publishing SMB is a file server, whatever it's called. Read off
// its own published ports rather than its slug, so this holds for any Samba
// add-on rather than the one this map was written against.
// Every port an add-on can be reached on from the host. `network` alone is
// not enough: an add-on running with host networking publishes nothing
// through it (the field is null), which is exactly the case for the common
// Samba and media add-ons - so their ports were invisible, no share was
// detected, and every tunnel rule pointing at one of their ports failed to
// resolve. The web-UI template carries the port in that case.
function hostPortsFor(info) {
  const ports = new Set();
  for (const value of Object.values(info?.network || {})) {
    if (typeof value === "number" && value > 0) ports.add(value);
  }
  const webui = String(info?.webui || "");
  // `[PORT:3001]` names a *container* port, which is the host port only when
  // there is no mapping to look it up in. Handled first, then stripped, so
  // the literal scan below can't read the same digits a second time.
  for (const match of webui.matchAll(/\[PORT:(\d{2,5})\]/g)) {
    const container = parseInt(match[1], 10);
    const mapped = info?.network?.[`${container}/tcp`];
    ports.add(typeof mapped === "number" && mapped > 0 ? mapped : container);
  }
  for (const match of webui.replace(/\[PORT:\d+\]/g, "").matchAll(/:(\d{2,5})\b/g)) {
    ports.add(parseInt(match[1], 10));
  }
  if (typeof info?.ingress_port === "number" && info.ingress_port > 0) ports.add(info.ingress_port);
  return ports;
}

const SMB_PORTS = [445, 139];
// An SMB server either publishes the ports, or - when it runs on the host
// network and so publishes nothing visible - declares SMB's own settings in
// its options. `workgroup` is a Samba concept and nothing else's, which makes
// it evidence rather than a guess at the add-on's name.
function servesSmb(info) {
  const ports = hostPortsFor(info);
  if (SMB_PORTS.some((port) => ports.has(port))) return true;
  return Object.keys(info?.options || {}).some((key) => /^workgroup$|smb|samba/i.test(key));
}

// Breaks a node's name across at most two lines, on word boundaries where it
// can. Widths are estimated from character count - close enough at these
// sizes, and it avoids measuring text, which SVG makes expensive.
function wrapLabel(text, maxChars, maxLines = 2) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (!lines.length) return [""];
  // Whatever didn't fit is marked as cut rather than silently dropped.
  const used = lines.join(" ").length;
  if (used < String(text).length) lines[lines.length - 1] = truncate(lines[lines.length - 1], maxChars);
  return lines.map((l) => truncate(l, maxChars + 2));
}

// Sparkline over a fixed box, normalised to its own min/max - these sit next
// to the number they summarise, so the shape is the point, not the scale.
function sparklinePath(values, w, h) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
}

class SystemMapCard extends HTMLElement {
  // Lovelace calls this to open the visual editor, and to seed the config
  // when the card is picked from the card picker.
  static getConfigElement() {
    return document.createElement("system-map-card-editor");
  }

  static getStubConfig() {
    return { type: "custom:system-map-card" };
  }

  setConfig(config) {
    const first = !this._config;
    // A null/absent option must fall back to its default rather than
    // disabling the feature - ha-form writes `undefined` into a key when a
    // boolean is toggled back off in some HA versions, and an entity picker
    // that's been cleared comes back as "".
    clearTimeout(this._refreshTimer);
    this._config = { ...DEFAULTS, ...config };
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (this._config[k] === undefined || this._config[k] === null) this._config[k] = v;
    }
    if (!Array.isArray(this._config.tiers) || !this._config.tiers.length) this._config.tiers = DEFAULTS.tiers;

    // Section toggles change the markup and tier/hardware changes change the
    // map's extent, so both always need redoing; the fetched data does not.
    this._built = false;
    this._viewBox = null;
    // Set once the user zooms or pans, after which the card stops re-fitting
    // the view for them - a map that snapped back on every refresh would be
    // unusable.
    this._viewMoved = false;
    this._fittedTo = null;
    if (!first) return this._applyConfig();

    this._loaded = false;
    this._addons = [];
    this._entries = [];
    this._devices = [];
    this._entityRegistry = [];
    this._entityRegistryByEntityId = new Map();
    this._entityRegistryLoading = null;
    this._loadErrors = {};
    this._detailKey = null; // currently-open detail panel, e.g. "node:host"
    this._addonInfoCache = new Map();
    this._addonStatsCache = new Map();
    this._areas = [];
    this._hardware = null; // Supervisor /hardware/info payload
    this._system = {}; // host/os/core/supervisor/network/backups summaries
    this._issues = []; // repairs/list_issues
    this._systemHealth = {}; // system_health/info, domain -> info map
    this._derived = { nodes: [], edges: [] }; // hardware nodes/edges discovered at runtime
    this._problems = new Map(); // node key -> {unavailable, total, issues, health}
    this._counts = new Map(); // node key -> {devices, entities, areas}
    this._history = {}; // stat key -> [values] for the sparklines
    this._logRoutes = []; // ingress rules read out of logs
    this._logServices = []; // host:port endpoints add-ons named in their logs
    this._logSizes = new Map(); // slug -> bytes of log read, for the evidence panel
    this._logErrors = new Map(); // slug -> why its log could not be read
    this._addonIcons = new Map(); // slug -> signed URL of the add-on's own icon
    this._refreshTimer = null;
    this._naturalViewBox = null; // full-fit viewBox, recomputed each render
    // Set of namespaced keys highlighted by the entity finder, or null:
    // "node:<id>" | "addon:<slug>" | "entry:<entry_id>". Namespaced because a
    // highlight can land on a curated node, an auto-grid add-on, or an
    // auto-grid integration, and those three id spaces can collide.
    this._highlight = null;
    // The node the user has selected, if any - a separate concept from the
    // entity finder's highlight, since the two answer different questions
    // and can be on at once.
    this._focus = null;
    // key -> {x, y, r} for every node actually drawn, rebuilt on each graph
    // render. Used to pan the view onto a highlight, and to tell "highlighted
    // but off-screen" apart from "highlighted but filtered out of the map".
    this._nodePositions = new Map();
    try {
      this._hideInactive = localStorage.getItem("smc-hide-inactive") === "1";
    } catch (_) {
      this._hideInactive = false;
    }
  }

  // Re-applies a changed config to data we already have. Deliberately does
  // NOT refetch: the visual editor calls setConfig on every keystroke in the
  // title field, and a dozen API calls per character is not a preview. Only
  // the three config-dependent indices are rebuilt, all from data in memory.
  _applyConfig() {
    if (!this._hass) return; // not mounted yet; `set hass` will build it
    this._build();
    this._built = true;

    // Turning a join on for the first time can need data that was never
    // fetched. Keyed on the data actually being absent (and not having
    // already failed), so this fires once on the toggle rather than on every
    // subsequent keystroke.
    const missing =
      ((this._config.highlight_problems || this._config.show_counts) && !this._entityRegistry.length && !this._loadErrors.entities) ||
      (this._config.discover_hardware && !this._hardware && !this._loadErrors.hardware);
    if (this._loaded && missing) return void this._refreshData();

    this._derive();
    this._buildProblemIndex();
    this._buildCounts();
    try {
      this._renderAll();
    } catch (e) {
      console.error("system-map-card: render failed", e);
      this._loadErrors.render = describeError(e);
      this._renderErrors();
    }
    const loadingEl = this.querySelector(".smc-loading");
    if (loadingEl) loadingEl.hidden = this._loaded;
    if (this._config.show_sparklines && !Object.keys(this._history).length) this._loadHistory();
    this._scheduleRefresh();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._build();
      this._built = true;
    }
    if (!this._loaded) {
      this._loaded = true;
      this._refreshData();
    } else {
      // Cheap path: hass updates fire on every state change in the house,
      // so only refresh the host stats text here - the add-on/integration
      // fetch below only reruns on first load or a manual refresh click.
      this._renderHostStats();
      if (this._detailKey === "node:host") this._renderDetail();
    }
  }

  getCardSize() {
    return 22;
  }

  // Hint for HA's "sections" dashboard layout so the card can be given a
  // generous default footprint there; harmless no-op on layouts that don't
  // read it. For truly filling an entire dashboard, a "Panel" view (see
  // file header) is the reliable route - Lovelace's outer layout is
  // ultimately controlled by the view type, not by the card alone.
  getLayoutOptions() {
    return { grid_columns: 12, grid_rows: 16, grid_min_columns: 6, grid_min_rows: 8 };
  }

  _build() {
    const cfg = this._config;
    this.innerHTML = `
      <ha-card>
        <div class="smc-header">
          <span class="smc-title">${escapeHtml(this._config.title)}</span>
          <label class="smc-filter">
            <input type="checkbox" class="smc-hide-inactive" />
            Hide inactive
          </label>
          <span class="smc-version" title="System Map Card version">v${VERSION}</span>
          <button class="smc-refresh" title="Refresh" aria-label="Refresh">&#8635;</button>
        </div>
        <div class="smc-errors" hidden></div>
        ${cfg.show_status_bar ? `<div class="smc-status"></div>` : ""}
        ${cfg.show_host_stats ? `<div class="smc-stats"></div>` : ""}
        <div class="smc-graph-wrap" style="flex:0 0 auto;height:${Number(cfg.graph_height) || DEFAULTS.graph_height}px">
          <div class="smc-loading">Loading system map…</div>
          <div class="smc-graph"></div>
          <div class="smc-zoom-controls">
            <button class="smc-zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
            <button class="smc-zoom-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
            <button class="smc-zoom-reset" title="Fit to view" aria-label="Fit to view">&#10021;</button>
            <button class="smc-export" title="Download as PNG" aria-label="Download as PNG">&#8681;</button>
          </div>
        </div>
        ${cfg.show_legend ? `<div class="smc-legend"></div>` : ""}
        <div class="smc-detail" hidden></div>
        ${cfg.show_entity_finder ? `<div class="smc-finder">
          <h3>Find an entity <span class="smc-hint">- highlights which node(s) serve it</span></h3>
          <div class="smc-entity-search">
            <input type="text" class="smc-entity-input" placeholder="e.g. switch.3d_printer_power" autocomplete="off" />
            <button class="smc-entity-clear" title="Clear" hidden>&#10005;</button>
          </div>
          <div class="smc-entity-suggestions" hidden></div>
          <div class="smc-entity-result"></div>
        </div>` : ""}
        ${cfg.show_debug ? `<details class="smc-debug"><summary>Evidence - what the card saw</summary><div class="smc-debug-body"></div></details>` : ""}
        ${cfg.show_integration_list ? `<div class="smc-lists">
          <div class="smc-col">
            <h3>Integrations <span class="smc-count" data-count="integrations"></span> <span class="smc-hint">- every one is also a node on the map above</span></h3>
            <div class="smc-chips" data-list="integrations"></div>
          </div>
        </div>` : ""}
      </ha-card>
      <style>
        :host { display: block; height: 100%; }
        ha-card { padding: 12px 16px 16px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
        .smc-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; flex: 0 0 auto; }
        .smc-title { font-size: 1.2em; font-weight: 500; color: var(--primary-text-color); flex: 1; }
        .smc-filter { display: flex; align-items: center; gap: 4px; font-size: 0.85em; color: var(--secondary-text-color); cursor: pointer; user-select: none; }
        .smc-version { font-size: 0.72em; color: var(--secondary-text-color); opacity: 0.7; letter-spacing: 0.3px; }
        .smc-refresh { background: none; border: none; font-size: 1.3em; cursor: pointer; color: var(--secondary-text-color); line-height: 1; padding: 4px 8px; }
        .smc-refresh:hover { color: var(--primary-text-color); }
        .smc-errors { background: var(--error-color, #db4437); color: white; border-radius: 6px; padding: 6px 10px; font-size: 0.85em; margin-bottom: 8px; flex: 0 0 auto; }
        .smc-graph-wrap { position: relative; overflow: hidden; touch-action: none; border-radius: 8px; background: var(--secondary-background-color, #f7f7f7); }
        .smc-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); font-size: 0.95em; z-index: 1; background: var(--secondary-background-color, #f7f7f7); }
        .smc-loading[hidden] { display: none; }
        .smc-graph { position: absolute; inset: 0; }
        .smc-graph svg { width: 100%; height: 100%; display: block; cursor: grab; }
        .smc-zoom-controls { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column; gap: 4px; z-index: 2; }
        .smc-zoom-controls button { width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color); cursor: pointer; font-size: 1em; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .smc-zoom-controls button:hover { background: var(--secondary-background-color, #eee); }
        .smc-tier-box { stroke-width: 2; }
        .smc-tier-label { font-size: 12px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
        .smc-badge { fill: #ffca28; font-size: 10px; font-weight: 700; text-anchor: middle; letter-spacing: 0.3px; }
        .smc-node circle { stroke: var(--card-background-color, #fff); stroke-width: 3; cursor: pointer; transition: opacity 0.15s ease; }
        .smc-chip-bg { fill: var(--card-background-color, #1c1c1c); stroke: var(--divider-color, #4a4a4a); stroke-width: 1; cursor: pointer; }
        .smc-chip-node:hover .smc-chip-bg { stroke: var(--primary-color, #3f51b5); }
        .smc-chip-text { fill: var(--primary-text-color); font-size: 11px; font-weight: 500; text-anchor: start; pointer-events: none; }
        .smc-chip-dot { pointer-events: none; }
        .smc-chip-node.smc-problem .smc-chip-bg { stroke: var(--error-color, #db4437); stroke-width: 2; }
        .smc-chip-node.smc-hi .smc-chip-bg { stroke: #ffca28; stroke-width: 2.5; }
        .smc-node.smc-dim { opacity: 0.2; }
        .smc-edge { stroke: var(--divider-color, #999); stroke-width: 2; fill: none; transition: opacity 0.15s ease; }
        .smc-edge.dashed { stroke-dasharray: 5 4; opacity: 0.6; }
        .smc-edge.smc-dim { opacity: 0.08; }
        /* A selected node's own connections. Colour rather than width alone:
           at map scale a 2px line and a 3px line are the same line, and the
           whole point is to pick these out of two dozen others. */
        .smc-edge.smc-edge-hot { stroke: #ffca28; stroke-width: 3.5; opacity: 1; }
        .smc-edge.dashed.smc-edge-hot { opacity: 1; }
        .smc-edge-label.smc-dim { opacity: 0.15; }
        .smc-edge-label.smc-edge-label-hot { fill: #ffca28; font-weight: 700; }
        /* paint-order draws the stroke behind the fill, giving each label a
           halo in the graph's own background colour - so where a label does
           end up crossing an edge line it stays readable. */
        .smc-edge-label { fill: var(--secondary-text-color); font-size: 10px; text-anchor: middle;
          paint-order: stroke; stroke: var(--secondary-background-color, #f7f7f7); stroke-width: 3px; stroke-linejoin: round; }
        .smc-detail { margin: 10px 0; padding: 10px 12px; border-radius: 8px; background: var(--secondary-background-color, #f2f2f2); font-size: 0.9em; color: var(--primary-text-color); position: relative; flex: 0 0 auto; }
        .smc-detail-close { position: absolute; top: 6px; right: 10px; cursor: pointer; color: var(--secondary-text-color); font-size: 1.1em; }
        .smc-role { margin: 4px 0 8px; color: var(--primary-text-color); opacity: 0.85; }
        .smc-detail dl { margin: 4px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
        .smc-detail dt { color: var(--secondary-text-color); }
        .smc-detail dd { margin: 0; word-break: break-word; }
        .smc-detail dd a { color: var(--primary-color); }
        .smc-finder { flex: 0 0 auto; margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: var(--secondary-background-color, #f2f2f2); position: relative; }
        .smc-finder h3 { margin: 0 0 6px; font-size: 0.95em; font-weight: 500; color: var(--primary-text-color); }
        .smc-hint { font-weight: 400; color: var(--secondary-text-color); font-size: 0.85em; }
        .smc-entity-search { display: flex; align-items: center; gap: 6px; }
        .smc-entity-input { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color); font-size: 0.9em; }
        .smc-entity-clear { background: none; border: none; cursor: pointer; color: var(--secondary-text-color); font-size: 1em; }
        .smc-entity-suggestions { position: absolute; left: 12px; right: 12px; top: 66px; background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, #ccc); border-radius: 6px; max-height: 200px; overflow-y: auto; z-index: 3; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
        .smc-entity-suggestions div { padding: 6px 10px; cursor: pointer; font-size: 0.85em; color: var(--primary-text-color); }
        .smc-entity-suggestions div:hover { background: var(--secondary-background-color, #eee); }
        .smc-entity-result { margin-top: 6px; font-size: 0.85em; color: var(--primary-text-color); }
        .smc-lists { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; flex: 0 0 auto; }
        .smc-col { flex: 1 1 260px; min-width: 220px; }
        .smc-col h3 { font-size: 0.95em; color: var(--secondary-text-color); margin: 4px 0; font-weight: 500; }
        .smc-count { font-weight: 400; opacity: 0.7; }
        .smc-chips { max-height: 160px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 6px; padding-right: 4px; }
        .smc-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 12px; background: var(--card-background-color, #eee); font-size: 0.82em; cursor: pointer; color: var(--primary-text-color); border: 1px solid var(--divider-color, transparent); }
        .smc-chip:hover { border-color: var(--primary-color); }
        .smc-chip.smc-hi { border-color: #ffca28; box-shadow: 0 0 0 2px rgba(255, 202, 40, 0.55); }
        .smc-chip.smc-dim { opacity: 0.35; }
        .smc-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
        .smc-status { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; flex: 0 0 auto; }
        .smc-pill { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 10px; border-radius: 8px; background: var(--secondary-background-color, #f2f2f2); border: 1px solid var(--divider-color, transparent); border-left-width: 3px; font-size: 0.8em; cursor: pointer; color: var(--primary-text-color); }
        .smc-pill:hover { border-color: var(--primary-color); }
        .smc-pill .smc-pill-label { color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: 0.4px; font-size: 0.85em; }
        .smc-pill .smc-pill-value { font-weight: 600; }
        .smc-pill.ok { border-left-color: var(--success-color, #43a047); }
        .smc-pill.warn { border-left-color: var(--warning-color, #ff9800); }
        .smc-pill.bad { border-left-color: var(--error-color, #db4437); }
        .smc-pill.info { border-left-color: var(--primary-color, #3f51b5); }
        .smc-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; flex: 0 0 auto; }
        .smc-stat { flex: 1 1 120px; min-width: 110px; padding: 6px 10px; border-radius: 8px; background: var(--secondary-background-color, #f2f2f2); }
        .smc-stat-label { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.5px; color: var(--secondary-text-color); }
        .smc-stat-value { font-size: 1.15em; font-weight: 600; color: var(--primary-text-color); line-height: 1.3; }
        .smc-stat svg { display: block; width: 100%; height: 22px; overflow: visible; }
        .smc-stat path { fill: none; stroke: var(--primary-color, #3f51b5); stroke-width: 1.5; }
        .smc-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 6px 2px 0; font-size: 0.72em; color: var(--secondary-text-color); flex: 0 0 auto; }
        .smc-legend span { display: inline-flex; align-items: center; gap: 4px; }
        .smc-legend i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
        /* The boundary node gets a dashed ring: it isn't a thing running on
           this machine, it's where the machine stops. */
        .smc-card-node.smc-internet .smc-card { stroke: #ffa726; stroke-width: 2; stroke-dasharray: 7 4; }
        .smc-card { fill: var(--card-background-color, #1c1c1c); stroke: var(--divider-color, #4a4a4a); stroke-width: 1; cursor: pointer; transition: opacity 0.15s ease; }
        .smc-card-node:hover .smc-card { stroke: var(--primary-color, #3f51b5); stroke-width: 2; }
        .smc-card-stripe { pointer-events: none; }
        .smc-card-node .smc-card-name { fill: var(--primary-text-color); font-size: 12.5px; font-weight: 600; text-anchor: middle; pointer-events: none; }
        .smc-card-node .smc-card-sub { fill: var(--secondary-text-color); font-size: 10px; font-weight: 400; text-anchor: middle; pointer-events: none; }
        .smc-card-node .smc-card-sub.smc-card-bad { fill: var(--error-color, #db4437); font-weight: 600; }
        /* The hostname is the one fact worth spotting from across the room -
           if a node has one it is reachable from outside - so it gets the
           same amber the boundary and the EXPOSED status pill use, filled
           rather than outlined so it reads before the node's own name does. */
        .smc-card-node .smc-host-pill { fill: #ffca28; pointer-events: none; }
        .smc-card-node .smc-host-pill-text { fill: #1b1b1b; font-size: 10.5px; font-weight: 700; text-anchor: middle; letter-spacing: 0.2px; pointer-events: none; }
        .smc-card-node.smc-problem .smc-card { stroke: var(--error-color, #db4437); stroke-width: 2; }
        .smc-card-node.smc-hi .smc-card { stroke: #ffca28; stroke-width: 3; }
        .smc-node:focus { outline: none; }
        .smc-node:focus-visible .smc-card, .smc-node:focus-visible .smc-chip-bg { stroke: var(--primary-color, #3f51b5); stroke-width: 3; }
        .smc-chip:focus-visible { outline: 2px solid var(--primary-color, #3f51b5); outline-offset: 1px; }
        .smc-problem-badge { fill: var(--error-color, #db4437); font-size: 10px; font-weight: 700; text-anchor: middle; }
        .smc-detail-section { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--divider-color, #ddd); }
        .smc-detail-section h4 { margin: 0 0 4px; font-size: 0.85em; font-weight: 600; color: var(--secondary-text-color); }
        .smc-debug { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: var(--secondary-background-color, #f2f2f2); font-size: 0.85em; color: var(--primary-text-color); flex: 0 0 auto; }
        .smc-debug summary { cursor: pointer; font-weight: 500; color: var(--secondary-text-color); }
        .smc-debug-body { margin-top: 8px; max-height: 420px; overflow: auto; }
        .smc-debug table { width: 100%; border-collapse: collapse; font-size: 0.92em; }
        .smc-debug th { text-align: left; font-weight: 500; color: var(--secondary-text-color); padding: 3px 8px 3px 0; vertical-align: top; white-space: nowrap; }
        .smc-debug td { padding: 3px 8px 3px 0; vertical-align: top; word-break: break-word; }
        .smc-debug tr + tr td, .smc-debug tr + tr th { border-top: 1px solid var(--divider-color, #ddd); }
        .smc-debug h4 { margin: 10px 0 4px; font-size: 0.95em; color: var(--primary-text-color); }
        .smc-debug h4:first-child { margin-top: 0; }
        .smc-debug code { font-family: var(--code-font-family, monospace); font-size: 0.95em; opacity: 0.9; }
        .smc-debug .smc-none { color: var(--secondary-text-color); font-style: italic; }
        .smc-log { margin: 0; max-height: 160px; overflow: auto; font-family: var(--code-font-family, monospace); font-size: 0.75em; white-space: pre-wrap; word-break: break-word; background: var(--card-background-color, #fff); border-radius: 6px; padding: 6px 8px; }
      </style>
    `;

    this.querySelector(".smc-refresh").addEventListener("click", () => this._refreshData());

    const filterCb = this.querySelector(".smc-hide-inactive");
    filterCb.checked = this._hideInactive;
    filterCb.addEventListener("change", () => {
      this._hideInactive = filterCb.checked;
      try {
        localStorage.setItem("smc-hide-inactive", this._hideInactive ? "1" : "0");
      } catch (_) {}
      this._renderGraph();
      this._renderChipList("integrations");
    });

    this._buildZoomPan();
    this._buildEntityFinder();
    this._bindOnce();
  }

  // Listeners that outlive the markup: on the card element itself, which
  // survives innerHTML being replaced, and on window/document, which survive
  // everything. _build() re-runs on every setConfig - and the visual editor
  // calls setConfig on every keystroke - so binding these there added a
  // fresh set per character typed: twenty keystrokes meant one click firing
  // _openDetail twenty times, each with its own render and refetch. They are
  // bound once and released when the card leaves the page.
  _bindOnce() {
    if (this._bound) return;
    this._bound = true;

    // Event delegation, so re-rendering the graph never has to rewire.
    this.addEventListener("click", (ev) => this._onCardClick(ev));

    // Escape closes whichever overlay is open.
    this._onKeyDown = (ev) => {
      if (ev.key !== "Escape") return;
      if (this._detailKey) this._closeDetail();
      if (this._highlight) this._clearHighlight();
      this._clearFocus();
    };
    window.addEventListener("keydown", this._onKeyDown);

    // Enter/Space on a focused node does what clicking it does. Routed
    // through the same handler so the two can never diverge.
    this.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      if (!ev.target?.closest?.("[data-node], [data-node-addon], [data-node-domain], [data-chip]")) return;
      ev.preventDefault();
      this._onCardClick(ev);
    });

    // Click-away closes the entity finder's suggestions.
    this._onDocClick = (ev) => {
      if (!this.contains(ev.target)) return;
      if (ev.target.closest(".smc-entity-search, .smc-entity-suggestions")) return;
      const el = this.querySelector(".smc-entity-suggestions");
      if (el) el.hidden = true;
    };
    document.addEventListener("click", this._onDocClick);
  }

  // Delegated: one listener for the whole card, so re-rendering the graph
  // never has to rewire anything.
  _onCardClick(ev) {
    if (ev.target.closest(".smc-filter, .smc-zoom-controls, .smc-finder")) return;
    // A pinch ends as a pointerup on whatever was under the fingers, which
    // the browser then reports as a click on that node.
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }
    const node = ev.target.closest("[data-node]");
    if (node) return this._openDetail("node", node.getAttribute("data-node"));
    const addonNode = ev.target.closest("[data-node-addon]");
    if (addonNode) return this._openDetail("addon", addonNode.getAttribute("data-node-addon"));
    const entryNode = ev.target.closest("[data-node-entry]");
    if (entryNode) return this._openDetail("entry", entryNode.getAttribute("data-node-entry"));
    const domainNode = ev.target.closest("[data-node-domain]");
    if (domainNode) return this._openDetail("domain", domainNode.getAttribute("data-node-domain"));
    const pill = ev.target.closest("[data-status]");
    if (pill) return this._openDetail("status", pill.getAttribute("data-status"));
    const chip = ev.target.closest("[data-chip]");
    if (chip) return this._openDetail(chip.getAttribute("data-chip-kind"), chip.getAttribute("data-chip"));
    const close = ev.target.closest(".smc-detail-close");
    if (close) return this._closeDetail();
  }

  // --- zoom / pan -----------------------------------------------------
  // Pointer capture is deliberately deferred until the pointer has actually
  // moved past a small threshold, not engaged on every pointerdown. Per the
  // Pointer Events spec, an active capture retargets the *click* event
  // (not just pointer events) to the capturing element - engaging it
  // unconditionally silently broke every node-click in an earlier version
  // of this card, since ev.target on click stopped being the clicked node.

  _buildZoomPan() {
    const wrap = this.querySelector(".smc-graph-wrap");
    wrap.addEventListener(
      "wheel",
      (ev) => {
        const svg = this.querySelector(".smc-graph svg");
        if (!svg) return;
        ev.preventDefault();
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX;
        pt.y = ev.clientY;
        const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
        this._zoomBy(ev.deltaY > 0 ? 1.15 : 1 / 1.15, svgPt.x, svgPt.y);
      },
      { passive: false }
    );

    // Every pointer currently down, because a phone's second finger is what
    // turns a pan into a pinch and there is no other way to know it arrived.
    const pointers = new Map();
    let pointerState = null; // one-finger / mouse drag
    let pinch = null; // two-finger zoom
    const DRAG_THRESHOLD = 4;

    const graphSvg = () => this.querySelector(".smc-graph svg");

    // Screen to user space through the live CTM rather than by dividing out
    // the element's box: the SVG letterboxes inside its element whenever the
    // two aspect ratios differ, and the CTM already accounts for that.
    const toSvg = (x, y) => {
      const svg = graphSvg();
      const ctm = svg?.getScreenCTM?.();
      if (!ctm) return null;
      const pt = svg.createSVGPoint();
      pt.x = x;
      pt.y = y;
      return pt.matrixTransform(ctm.inverse());
    };

    const endDrag = () => {
      if (pointerState?.dragging) {
        try {
          wrap.releasePointerCapture(pointerState.pointerId);
        } catch (_) {}
      }
      pointerState = null;
      const svg = graphSvg();
      if (svg) svg.style.cursor = "grab";
    };

    const beginDrag = (pointerId, clientX, clientY) => {
      const svg = graphSvg();
      if (!svg || !this._viewBox) return;
      pointerState = {
        pointerId,
        startX: clientX,
        startY: clientY,
        vbX: this._viewBox.x,
        vbY: this._viewBox.y,
        rectW: svg.clientWidth || 1,
        rectH: svg.clientHeight || 1,
        dragging: false,
      };
    };

    const beginPinch = () => {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (!dist || !mid || !this._viewBox) return;
      // A one-finger drag may already be in flight and holding pointer
      // capture; left running it would pan against the pinch.
      endDrag();
      pinch = { dist, mid, vb: { ...this._viewBox } };
    };

    wrap.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".smc-zoom-controls")) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) return beginPinch();
      if (pointers.size > 2) return;
      beginDrag(ev.pointerId, ev.clientX, ev.clientY);
    });

    wrap.addEventListener("pointermove", (ev) => {
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (pinch && pointers.size >= 2) {
        ev.preventDefault();
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist) this._pinchTo(pinch, dist, toSvg((a.x + b.x) / 2, (a.y + b.y) / 2));
        return;
      }

      if (!pointerState || pointerState.pointerId !== ev.pointerId || !this._viewBox) return;
      const dx = ev.clientX - pointerState.startX;
      const dy = ev.clientY - pointerState.startY;
      if (!pointerState.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        pointerState.dragging = true;
        wrap.setPointerCapture(pointerState.pointerId);
        const svg = graphSvg();
        if (svg) svg.style.cursor = "grabbing";
      }
      const vb = this._viewBox;
      vb.x = pointerState.vbX - dx * (vb.w / pointerState.rectW);
      vb.y = pointerState.vbY - dy * (vb.h / pointerState.rectH);
      this._viewMoved = true;
      this._applyViewBox();
    });

    const releasePointer = (ev) => {
      pointers.delete(ev.pointerId);
      if (pinch) {
        if (pointers.size >= 2) return;
        pinch = null;
        // Lifting one finger must not hand the map to the other mid-gesture:
        // the remaining pointer has travelled since it went down, so the
        // drag is re-seeded from where that finger is now, not where it was.
        const [id, pos] = [...pointers.entries()][0] || [];
        this._suppressClick = true;
        if (id === undefined) return endDrag();
        return beginDrag(id, pos.x, pos.y);
      }
      if (pointerState?.pointerId === ev.pointerId) endDrag();
    };
    wrap.addEventListener("pointerup", releasePointer);
    wrap.addEventListener("pointercancel", releasePointer);

    this.querySelector(".smc-zoom-in").addEventListener("click", () => this._zoomBy(0.8));
    this.querySelector(".smc-zoom-out").addEventListener("click", () => this._zoomBy(1.25));
    this.querySelector(".smc-zoom-reset").addEventListener("click", () => this._resetView());
    this.querySelector(".smc-export").addEventListener("click", () => {
      this._exportPng().catch((e) => {
        this._loadErrors.export = describeError(e);
        this._renderErrors();
      });
    });
  }

  // Renders the *whole* map, not the current viewport - the point of an
  // export is the bit that didn't fit on screen. Inlines the computed colours
  // for the handful of CSS custom properties the SVG references, since a
  // detached <img> resolves none of the theme's variables.
  // Builds the standalone SVG the export rasterises: the *whole* map rather
  // than the current viewport, with everything a detached <img> cannot fetch
  // or resolve for itself folded in. Split out from the export so it can be
  // rendered and inspected without a browser download.
  async _exportSvg() {
    const svg = this.querySelector(".smc-graph svg");
    const nat = this._naturalViewBox;
    if (!svg || !nat) return null;
    const clone = svg.cloneNode(true);

    // An SVG rendered through an <img> fetches nothing external, so the
    // add-on icons - which are URLs into Supervisor - came out blank and
    // every node was an empty circle. Inline them as data URIs first. A
    // failure just drops that one icon rather than the export.
    await Promise.all(
      [...clone.querySelectorAll("image")].map(async (img) => {
        const href = img.getAttribute("href") || img.getAttribute("xlink:href");
        if (!href || href.startsWith("data:")) return;
        try {
          const res = await fetch(href);
          const blob = await res.blob();
          const dataUri = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          img.setAttribute("href", dataUri);
        } catch (e) {
          img.remove();
        }
      })
    );
    clone.setAttribute("viewBox", `${nat.x} ${nat.y} ${nat.w} ${nat.h}`);
    clone.setAttribute("width", nat.w);
    clone.setAttribute("height", nat.h);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    inlineComputedStyles(svg, clone);
    return new XMLSerializer().serializeToString(clone);
  }

  async _exportPng() {
    const nat = this._naturalViewBox;
    const markup = await this._exportSvg();
    if (!markup) return;

    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const styles = getComputedStyle(this);
    const img = new Image();
    img.onload = () => {
      const scale = 2; // readable node labels at the sizes this map runs to
      const canvas = document.createElement("canvas");
      canvas.width = nat.w * scale;
      canvas.height = nat.h * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = (styles.getPropertyValue("--card-background-color") || "#fff").trim();
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      // A blob, not a data: URL, and anchored in the document before the
      // click. A detached anchor pointed at a multi-megabyte data: URL is
      // where the "unnamed file" comes from: several browsers - the Home
      // Assistant companion app's webview among them - ignore the download
      // attribute in that case and save the blob under a generated name.
      canvas.toBlob((out) => {
        if (!out) {
          this._loadErrors.export = "the browser could not encode the image";
          this._renderErrors();
          return;
        }
        const href = URL.createObjectURL(out);
        const link = document.createElement("a");
        link.download = `system-map-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = href;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Revoked on a later tick: revoking synchronously can cancel the
        // download that was only just handed to the browser.
        setTimeout(() => URL.revokeObjectURL(href), 10000);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this._loadErrors.export = "the browser refused to rasterise the map";
      this._renderErrors();
    };
    img.src = url;
  }

  // How far the view may be zoomed. Zooming out has to be able to reach the
  // whole map, and for a map taller than the space it has that means a
  // viewBox wider than the map itself - otherwise the fit-to-width default
  // is also the furthest out you can ever get.
  _zoomLimits() {
    const nat = this._naturalViewBox;
    const el = this.querySelector(".smc-graph");
    const areaAspect = (el?.clientWidth || 0) / (el?.clientHeight || 1);
    return { minW: nat.w * 0.12, maxW: Math.max(nat.w, areaAspect ? nat.h * areaAspect : 0) };
  }

  _zoomBy(factor, cx, cy) {
    if (!this._viewBox || !this._naturalViewBox) return;
    this._viewMoved = true;
    const vb = this._viewBox;
    // The *current* view's aspect, not the map's: they differ as soon as the
    // view is fitted to width, and zooming must not silently reshape it.
    const aspect = vb.w / vb.h;
    const { minW, maxW } = this._zoomLimits();
    const newW = Math.min(maxW, Math.max(minW, vb.w * factor));
    const newH = newW / aspect;
    const centerX = cx ?? vb.x + vb.w / 2;
    const centerY = cy ?? vb.y + vb.h / 2;
    const ratioX = (centerX - vb.x) / vb.w;
    const ratioY = (centerY - vb.y) / vb.h;
    vb.x = centerX - ratioX * newW;
    vb.y = centerY - ratioY * newH;
    vb.w = newW;
    vb.h = newH;
    this._applyViewBox();
  }

  // A pinch is a zoom about a moving anchor: the user-space point that was
  // under the midpoint of the two fingers when they went down stays under
  // that midpoint for the whole gesture. Two-finger panning falls out of
  // that for free, since the midpoint moving is indistinguishable from it.
  _pinchTo(pinch, dist, mid) {
    if (!this._viewBox || !this._naturalViewBox || !mid) return;
    const vb = this._viewBox;
    const { minW, maxW } = this._zoomLimits();
    const newW = Math.min(maxW, Math.max(minW, pinch.vb.w * (pinch.dist / dist)));
    const newH = newW / (pinch.vb.w / pinch.vb.h);
    // How far across the current view the midpoint sits. The viewBox aspect
    // never changes, so this fraction survives the resize unaltered and can
    // be reused to place the anchor in the new box.
    const tx = (mid.x - vb.x) / vb.w;
    const ty = (mid.y - vb.y) / vb.h;
    this._viewBox = { x: pinch.mid.x - tx * newW, y: pinch.mid.y - ty * newH, w: newW, h: newH };
    this._viewMoved = true;
    this._applyViewBox();
  }

  // Show the whole map, which is the point of it - unless doing so would
  // shrink the labels past reading, and then fit the width instead and let
  // the rest be panned to. On a phone, or in a short wide dashboard row,
  // containing a map this tall renders the node names at two or three
  // pixels: technically the whole system, legibly nothing.
  _fitViewBox(natural) {
    const el = this.querySelector(".smc-graph");
    const aw = el?.clientWidth || 0;
    const ah = el?.clientHeight || 0;
    if (!aw || !ah) return { ...natural };
    const contained = Math.min(aw / natural.w, ah / natural.h);
    if (contained * CARD_NAME_PX >= MIN_READABLE_PX) return { ...natural };
    return { x: natural.x, y: natural.y, w: natural.w, h: natural.w * (ah / aw) };
  }

  _resetView() {
    if (!this._naturalViewBox) return;
    this._viewBox = this._fitViewBox(this._naturalViewBox);
    this._fittedTo = `${this._naturalViewBox.w}x${this._naturalViewBox.h}`;
    // Back under the card's control: fit-to-view again as the map changes.
    this._viewMoved = false;
    this._applyViewBox();
  }

  // Nothing may scroll past the edge of the map. Panning to a finder result
  // centred the view on the answer with no regard for the map's bounds, so
  // looking up an entity near the bottom scrolled the top half off-screen and
  // left a screenful of nothing below it. Applied here rather than at each
  // call site so the drag, the pinch, the wheel and the finder all obey it.
  _clampViewBox() {
    const vb = this._viewBox;
    const nat = this._naturalViewBox;
    if (!vb || !nat) return;
    // A view wider or taller than the map has nothing to scroll on that
    // axis, so it centres instead of sticking to an edge.
    vb.x = vb.w >= nat.w ? nat.x + (nat.w - vb.w) / 2 : clamp(vb.x, nat.x, nat.x + nat.w - vb.w);
    vb.y = vb.h >= nat.h ? nat.y + (nat.h - vb.h) / 2 : clamp(vb.y, nat.y, nat.y + nat.h - vb.h);
  }

  _applyViewBox() {
    this._clampViewBox();
    const svg = this.querySelector(".smc-graph svg");
    if (svg && this._viewBox) {
      const vb = this._viewBox;
      svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }
  }

  // --- entity finder ------------------------------------------------------

  _buildEntityFinder() {
    const input = this.querySelector(".smc-entity-input");
    if (!input) return; // finder switched off in the config
    const suggestionsEl = this.querySelector(".smc-entity-suggestions");
    const clearBtn = this.querySelector(".smc-entity-clear");

    const showSuggestions = (query) => {
      if (!query || !this._hass) {
        suggestionsEl.hidden = true;
        return;
      }
      const q = query.toLowerCase();
      const matches = Object.keys(this._hass.states)
        .filter((id) => id.toLowerCase().includes(q))
        .slice(0, 12);
      if (!matches.length) {
        suggestionsEl.hidden = true;
        return;
      }
      suggestionsEl.innerHTML = matches
        .map((id) => `<div data-entity="${escapeHtml(id)}">${escapeHtml(id)}</div>`)
        .join("");
      suggestionsEl.hidden = false;
    };

    input.addEventListener("input", () => {
      clearBtn.hidden = !input.value;
      showSuggestions(input.value.trim());
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const value = input.value.trim();
      if (value && this._hass?.states[value]) {
        suggestionsEl.hidden = true;
        this._highlightEntity(value);
      }
    });
    input.addEventListener("focus", () => showSuggestions(input.value.trim()));
    suggestionsEl.addEventListener("click", (ev) => {
      const row = ev.target.closest("[data-entity]");
      if (!row) return;
      const id = row.getAttribute("data-entity");
      input.value = id;
      clearBtn.hidden = false;
      suggestionsEl.hidden = true;
      this._highlightEntity(id);
    });
    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.hidden = true;
      suggestionsEl.hidden = true;
      this._clearHighlight();
    });
  }

  // Fetched lazily (only when the entity finder is actually used) rather
  // than on card load - see file header for why this used to make the
  // whole card look stuck on "Loading".
  async _ensureEntityRegistry(force = false) {
    if (this._entityRegistry.length && !force) return;
    if (this._entityRegistryLoading) return this._entityRegistryLoading;
    this._entityRegistryLoading = (async () => {
      try {
        const res = await this._hass.connection.sendMessagePromise({ type: "config/entity_registry/list" });
        this._entityRegistry = Array.isArray(res) ? res : [];
        this._entityRegistryByEntityId = new Map(this._entityRegistry.map((e) => [e.entity_id, e]));
        delete this._loadErrors.entities;
      } catch (e) {
        this._loadErrors.entities = describeError(e);
      }
    })();
    await this._entityRegistryLoading;
    this._entityRegistryLoading = null;
  }

  // Follows a chain of "helper wraps another entity" links back to the
  // real source entity, generically - not hardcoded to switch_as_x by name.
  // Confirmed by inspecting a real switch_as_x entity's registry record:
  // the wrapped entity_id lives at `entityRegistryEntry.options.<platform>.
  // entity_id` (e.g. `options.switch_as_x.entity_id`) - NOT on the config
  // entry (an earlier version of this checked the config entry's own
  // `options.entity_id`, which config_entries/get doesn't actually return
  // over the WS API used here, so that path silently always failed).
  _resolveEntityChain(entityId) {
    const chain = [];
    let currentId = entityId;
    const seen = new Set();
    let depth = 0;
    while (currentId && depth < 6 && !seen.has(currentId)) {
      seen.add(currentId);
      const reg = this._entityRegistryByEntityId.get(currentId) || null;
      chain.push({ entityId: currentId, reg });
      if (!reg) break;
      const entry = reg.config_entry_id ? this._entries.find((e) => e.entry_id === reg.config_entry_id) : null;
      const wrapped = reg.options?.[reg.platform]?.entity_id || entry?.options?.entity_id;
      if (wrapped && typeof wrapped === "string" && wrapped !== currentId) {
        currentId = wrapped;
        depth++;
        continue;
      }
      break;
    }
    return chain;
  }

  async _highlightEntity(entityId) {
    const resultEl = this.querySelector(".smc-entity-result");
    resultEl.textContent = "Looking up entity…";
    await this._ensureEntityRegistry();

    if (this._loadErrors.entities) {
      resultEl.textContent = `Couldn't load entity registry data: ${this._loadErrors.entities}`;
      return;
    }

    const chain = this._resolveEntityChain(entityId);
    const last = chain[chain.length - 1];
    const chainDesc =
      chain.length > 1
        ? chain.map((c, i) => (i === 0 ? c.entityId : `${c.entityId} (${c.reg?.platform || "unknown platform"})`)).join(" → via helper → ")
        : entityId;

    if (!last || !last.reg) {
      resultEl.textContent = `${chainDesc}: no registry entry found (likely has no unique_id) - can't determine which node serves it.`;
      this._clearHighlight(false);
      return;
    }

    const target = this._mapTargetForRegistryEntry(last.reg);
    if (!target) {
      resultEl.textContent = `${chainDesc} is served by the "${last.reg.platform}" integration, which has no config entry on this instance (YAML-configured), so there's no node on the map to point at.`;
      this._clearHighlight(false);
      return;
    }

    this._highlight = new Set(target.keys);
    resultEl.textContent = `${chainDesc} → highlighted: ${target.names.join(", ")}`;
    this._renderHighlightables();

    // A node can be resolved correctly and still not be drawn - the
    // hide-inactive filter removes stopped add-ons and disabled/ignored
    // integrations from the map. Saying so beats a highlight that silently
    // lands on nothing.
    const drawn = [...this._highlight].some((k) => this._nodePositions.has(k));
    if (!drawn) resultEl.textContent += ` - not currently drawn (hidden by the "Hide inactive" filter).`;
    else this._panToHighlight();
  }

  // Where does a registry entry live on this map? Three routes, in order:
  //   1. DOMAIN_SERVICE_PORTS - the add-on actually running that protocol
  //      (mqtt -> the Zigbee2MQTT/Mosquitto add-ons, not the MQTT tile).
  //   2. A curated `kind:"integration"` node for the entity's own domain.
  //   3. The entity's own config entry, which is always drawn in the
  //      auto-generated Integrations grid.
  // Route 3 is what makes "isn't modeled on this map" unreachable for any
  // entity backed by a config entry - previously anything outside the
  // hand-written table (a camera served by MJPEG, say) fell off the end here.
  _mapTargetForRegistryEntry(reg) {
    // An entity from a protocol integration is really served by whichever
    // add-on runs that protocol - an mqtt entity by the broker, not by the
    // "MQTT" tile. Derived from the port the add-on publishes, so it needs no
    // table of which add-ons those are on this particular instance.
    const port = DOMAIN_SERVICE_PORTS[reg.platform];
    if (port) {
      const providers = this._derived.nodes.filter((n) => {
        if (n.kind !== "addon") return false;
        const info = this._addonInfoCache.get(n.slug);
        return Object.keys(info?.network || {}).some((p) => parseInt(p, 10) === port);
      });
      if (providers.length) {
        return { keys: providers.map((n) => `node:${n.id}`), names: providers.map((n) => n.label) };
      }
    }

    // `config_entry_id` is the authoritative link (it survives a platform
    // whose domain differs from its entry's); the domain lookup is only a
    // fallback for registry entries that don't carry one.
    const entry =
      (reg.config_entry_id && this._entries.find((e) => e.entry_id === reg.config_entry_id)) ||
      this._findEntry(reg.platform) ||
      null;

    // A derived integration node (a router, say) if this domain got one.
    const placed = this._derived.nodes.find((n) => n.kind === "integration" && n.domain === (entry?.domain || reg.platform));
    if (placed) return { keys: [`node:${placed.id}`], names: [placed.label] };

    if (entry) {
      const name = entry.title ? `${entry.domain}: ${entry.title}` : entry.domain;
      // Two keys on purpose. The map draws one node per integration, so the
      // graph highlight has to be the domain's; the list below it is still
      // per-entry, and highlighting the exact entry there is the more useful
      // half of the answer. Both live in one set, and each view takes the
      // key it knows about.
      return {
        keys: [`domain:${entry.domain}`, `entry:${entry.entry_id}`],
        names: [`${name} (in the Integrations grid)`],
      };
    }
    return null;
  }

  // Centres the view on whatever is highlighted, keeping the current zoom.
  // Without this, a highlight landing in the Integrations grid - well below
  // the curated layout - is correct but off-screen, which is hard to tell
  // apart from the finder having done nothing at all.
  _panToHighlight() {
    if (!this._highlight?.size || !this._viewBox) return;
    const pts = [...this._highlight].map((k) => this._nodePositions.get(k)).filter(Boolean);
    if (!pts.length) return;
    const xs = pts.map((pt) => pt.x);
    const ys = pts.map((pt) => pt.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    this._viewBox.x = cx - this._viewBox.w / 2;
    this._viewBox.y = cy - this._viewBox.h / 2;
    this._applyViewBox();
  }

  // The two views a highlight can appear in. Deliberately not _renderAll():
  // that would also re-run the detail panel, which can refetch add-on info
  // over the WS API for no reason on a highlight change.
  _renderHighlightables() {
    this._renderGraph();
    this._renderChipList("integrations");
  }

  _clearHighlight(clearResultText = true) {
    this._highlight = null;
    this._focus = null;
    const resultEl = this.querySelector(".smc-entity-result");
    if (clearResultText && resultEl) resultEl.textContent = "";
    this._renderHighlightables();
  }

  // --- data -------------------------------------------------------------

  // Every fetch goes through here so a failing endpoint can never take the
  // card down with it: the error is recorded against its own key (surfaced
  // in the error strip) and the rest of the card renders on whatever did
  // arrive. Several of these are Supervisor-only or version-dependent, and
  // an instance without them should degrade, not break.
  _fetch(key, message, assign) {
    return this._hass.connection
      .sendMessagePromise(message)
      .then((res) => {
        assign(res?.data ?? res);
        delete this._loadErrors[key];
      })
      .catch((e) => {
        this._loadErrors[key] = describeError(e);
      });
  }

  _supervisor(key, endpoint, assign) {
    return this._fetch(key, { type: "supervisor/api", endpoint, method: "get" }, assign);
  }

  // system_health/info streams: it answers with the domains it knows about
  // and then pushes each one's data as the (sometimes slow) health callbacks
  // resolve. So it's a subscription, not a request - collect for a moment,
  // then stop listening and render whatever arrived. Older cores answered it
  // as a plain command, hence the fallback.
  async _fetchSystemHealth() {
    const conn = this._hass.connection;
    const absorb = (msg) => {
      const data = msg?.data ?? msg;
      if (data && typeof data === "object") Object.assign(this._systemHealth, data);
    };
    try {
      if (typeof conn.subscribeMessage === "function") {
        const unsub = await conn.subscribeMessage(absorb, { type: "system_health/info" });
        await new Promise((resolve) => setTimeout(resolve, 2500));
        try {
          await unsub();
        } catch (_) {}
      } else {
        absorb(await conn.sendMessagePromise({ type: "system_health/info" }));
      }
      delete this._loadErrors.system_health;
    } catch (e) {
      this._loadErrors.system_health = describeError(e);
    }
  }

  async _refreshData() {
    this._loadErrors = {};

    // Deliberately only these three - fast, and everything the graph's
    // *first render* needs. Entity registry (used only by the entity
    // finder) is fetched lazily on demand, see _ensureEntityRegistry.
    const addonsP = this._hass.connection
      .sendMessagePromise({ type: "supervisor/api", endpoint: "/addons", method: "get" })
      .then((res) => {
        this._addons = res?.data?.addons ?? res?.addons ?? [];
      })
      .catch((e) => {
        this._loadErrors.addons = describeError(e);
      });

    const entriesP = this._hass.connection
      .sendMessagePromise({ type: "config_entries/get" })
      .then((res) => {
        this._entries = Array.isArray(res) ? res : res?.config_entries ?? [];
      })
      .catch((e) => {
        this._loadErrors.entries = describeError(e);
      });

    const devicesP = this._hass.connection
      .sendMessagePromise({ type: "config/device_registry/list" })
      .then((res) => {
        this._devices = Array.isArray(res) ? res : [];
      })
      .catch((e) => {
        this._loadErrors.devices = describeError(e);
      });

    // Everything else is enrichment: slower, individually optional, and
    // each one already isolated by _fetch. Awaited together with the core
    // three so the first paint has them, but none can block it on failure.
    const extras = [
      this._fetch("areas", { type: "config/area_registry/list" }, (r) => {
        this._areas = Array.isArray(r) ? r : [];
      }),
      this._supervisor("host", "/host/info", (r) => (this._system.host = r)),
      this._supervisor("core", "/core/info", (r) => (this._system.core = r)),
      this._supervisor("os", "/os/info", (r) => (this._system.os = r)),
      this._supervisor("supervisor", "/supervisor/info", (r) => (this._system.supervisor = r)),
      this._supervisor("network", "/network/info", (r) => (this._system.network = r)),
      this._supervisor("backups", "/backups", (r) => (this._system.backups = r?.backups ?? [])),
      this._fetch("repairs", { type: "repairs/list_issues" }, (r) => {
        this._issues = r?.issues ?? (Array.isArray(r) ? r : []);
      }),
      this._fetchSystemHealth(),
    ];
    if (this._config.discover_hardware) {
      extras.push(this._supervisor("hardware", "/hardware/info", (r) => (this._hardware = r)));
    }
    // The problem join needs the entity registry up front, not lazily - it's
    // what maps an unavailable entity back to the node that serves it.
    if (this._config.highlight_problems || this._config.show_counts) extras.push(this._ensureEntityRegistry(true));

    await Promise.all([addonsP, entriesP, devicesP, ...extras]);
    // Deliberately NOT clearing _addonInfoCache here: it backs the derived
    // hardware edges, so clearing it on every refresh would re-fetch
    // /addons/<slug>/info for every add-on once per interval. Freshness only
    // matters for the panel being opened, and _openDetail invalidates that
    // one entry itself.
    this._addonStatsCache.clear();
    this._lastRefreshed = new Date();

    this._derive();
    this._buildProblemIndex();
    this._buildCounts();

    // Belt-and-suspenders: whatever happens in rendering, the loading
    // overlay must not get stuck showing forever, and a render bug should
    // surface as a visible error, not a silent hang.
    try {
      this._renderAll();
    } catch (e) {
      console.error("system-map-card: render failed", e);
      this._loadErrors.render = describeError(e);
      this._renderErrors();
    } finally {
      const loadingEl = this.querySelector(".smc-loading");
      if (loadingEl) loadingEl.hidden = true;
    }

    // Deliberately after the first paint, and deliberately not awaited: both
    // are slow, neither changes the shape of the map, and the derived
    // hardware edges need one /addons/<slug>/info per add-on.
    if (this._config.discover_hardware) this._loadAddonOptions();
    else this._loadRouteLogs().then(() => this._derive()).then(() => this._renderGraph());
    if (this._config.show_sparklines) this._loadHistory();
    this._scheduleRefresh();
  }

  _scheduleRefresh() {
    clearTimeout(this._refreshTimer);
    const secs = Number(this._config.refresh_interval) || 0;
    if (secs > 0) this._refreshTimer = setTimeout(() => this._refreshData(), Math.max(10, secs) * 1000);
  }

  disconnectedCallback() {
    clearTimeout(this._refreshTimer);
    // Both of these are on objects that outlive the card, so leaving them
    // attached keeps the whole card - and everything it fetched - alive for
    // the life of the page.
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    if (this._onDocClick) document.removeEventListener("click", this._onDocClick);
  }

  connectedCallback() {
    // Re-attached after being removed: the listeners released on disconnect
    // have to come back, or the card is inert on a dashboard the user
    // navigates away from and back to.
    if (this._onKeyDown) window.addEventListener("keydown", this._onKeyDown);
    if (this._onDocClick) document.addEventListener("click", this._onDocClick);
    if (this._built) this._scheduleRefresh();
  }

  // Ownership edges are derived by matching a discovered device path against
  // the add-on's own options, which means one /addons/<slug>/info per add-on.
  // Sequential on purpose: 30-odd Supervisor calls fired at once is a visible
  // stall on a Pi, and nothing is waiting on the result.
  async _loadAddonOptions() {
    for (const addon of this._addons) {
      if (!this.isConnected) return; // card removed mid-walk (dashboard switched)
      if (this._addonInfoCache.has(addon.slug)) continue;
      await this._fetchAddonInfo(addon.slug);
    }
    if (!this.isConnected) return;
    await this._loadAddonIcons();
    await this._loadRouteLogs();
    this._derive();
    this._buildProblemIndex();
    this._buildCounts();
    // Everything, not just the graph. Add-on options and tunnel routes arrive
    // after the first paint, and they feed the status bar too - redrawing
    // only the graph left the Exposed pill permanently absent, because it is
    // built from routes that did not exist at first render.
    this._renderAll();
  }

  // Add-ons ship their own icons, and Supervisor serves them - so the map can
  // show what each thing actually is instead of a wall of identical generic
  // shapes. The endpoint needs authentication that an <image> tag cannot
  // send, so each URL is signed first; that is how Home Assistant's own
  // frontend draws these. Signatures are short-lived, which is why this
  // re-runs with every refresh, and any failure just leaves the derived icon
  // in place.
  async _loadAddonIcons() {
    for (const addon of this._addons) {
      if (!this.isConnected) return;
      if (!addon.icon) continue; // the add-on ships no icon
      try {
        const res = await this._hass.connection.sendMessagePromise({
          type: "auth/sign_path",
          path: `/api/hassio/addons/${addon.slug}/icon`,
          expires: 3600,
        });
        if (res?.path) this._addonIcons.set(addon.slug, res.path);
      } catch (e) {
        this._addonIcons.delete(addon.slug);
      }
    }
  }

  // Reads the log of any add-on holding a tunnel or proxy credential. That is
  // the only way to see a remotely-managed tunnel's routes: cloudflared says
  // as much itself ("All app configuration options except tunnel_token will
  // be ignored") and then logs the ingress rules it was handed. Restricted to
  // add-ons whose *options* show they could be one, so this is one or two log
  // reads rather than one per add-on.
  async _loadRouteLogs() {
    const found = [];
    this._routeScan = { considered: [], scanned: [], fallback: false };
    this._tunnelSlugs = new Set();

    const scan = async (addon, why) => {
      const log = await this._fetchAddonLog(addon.slug, 0);
      if (log === null) {
        this._logSizes.delete(addon.slug);
        this._routeScan.scanned.push(
          `${addon.name || addon.slug}: ${why}, LOG COULD NOT BE READ - ${this._logErrors.get(addon.slug) || "unknown"}`
        );
        return;
      }
      this._logSizes.set(addon.slug, log.length);
      const routes = routesFromLog(log);
      const tunnel = looksLikeTunnelLog(log);
      if (tunnel) this._tunnelSlugs.add(addon.slug);
      this._routeScan.scanned.push(
        `${addon.name || addon.slug}: ${why}, ${log.length} bytes, ${routes.length} rule${routes.length === 1 ? "" : "s"}` +
          (tunnel ? ", log identifies it as a way in" : "")
      );
      for (const route of routes) found.push({ ...route, viaSlug: addon.slug });
    };

    for (const addon of this._addons) {
      if (!this.isConnected) return;
      const info = this._addonInfoCache.get(addon.slug);
      if (!info || info._error) continue;
      if (!looksLikeIngressProvider(info.options)) {
        this._routeScan.considered.push(`${addon.name || addon.slug}: no tunnel-shaped option`);
        continue;
      }
      // Note: deliberately NOT marked a way in here. Matching an option name
      // is reason enough to spend a log read, but not to claim the add-on
      // terminates outside traffic - Let's Encrypt holds a Cloudflare API
      // token for DNS challenges and a file-sharing add-on may configure a
      // trusted proxy, and neither is an entry point. Only parsed routes or
      // the log markers earn that.
      await scan(addon, "options name a tunnel or proxy");
    }

    // Nothing looked like a tunnel by its options, but a remotely-managed one
    // can be configured entirely outside Home Assistant - leaving an add-on
    // whose options say nothing at all. Rather than conclude there are no
    // routes, read the running add-ons' logs and let the parser decide: a
    // log either contains ingress rules or it doesn't. Only reached when the
    // cheap path found nothing, so the usual case is still one or two reads.
    if (!found.length) {
      this._routeScan.fallback = true;
      for (const addon of this._addons) {
        if (!this.isConnected) return;
        if (addon.state !== "started") continue;
        if (this._logSizes.has(addon.slug)) continue;
        await scan(addon, "fallback scan");
      }
    }

    this._logRoutes = found;

    // Optional, and off by default because it means reading every running
    // add-on's whole log. An add-on logs the services it dials at startup -
    // Immich announces its machine-learning sidecar as
    // "became healthy (http://192.168.8.25:3004)" - and that host:port
    // resolves to another add-on exactly as a tunnel's ingress rule does.
    if (!this._config.scan_service_logs) return;
    const dialled = [];
    for (const addon of this._addons) {
      if (!this.isConnected) return;
      if (addon.state !== "started") continue;
      const log = await this._fetchAddonLog(addon.slug, 0);
      this._logSizes.set(addon.slug, log ? log.length : 0);
      for (const target of servicesFromLog(log)) dialled.push({ ...target, fromSlug: addon.slug });
    }
    this._logServices = dialled;
  }

  // One hour of the two headline stats, downsampled to fit a ~60px sparkline.
  async _loadHistory() {
    const stats = this._hostStats().filter((s) => s.entity && this._hass.states[s.entity]);
    if (!stats.length) return;
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: stats.map((s) => s.entity),
        minimal_response: true,
        no_attributes: true,
      });
      this._history = {};
      for (const stat of stats) {
        const points = (res?.[stat.entity] || [])
          .map((pt) => Number(pt.s ?? pt.state))
          .filter((v) => isFinite(v));
        if (points.length > 1) this._history[stat.key] = points;
      }
      this._renderHostStats();
    } catch (e) {
      this._loadErrors.history = describeError(e);
    }
  }

  _renderAll() {
    this._renderErrors();
    this._renderStatusBar();
    this._renderLegend();
    this._renderGraph();
    this._renderChipList("integrations");
    this._renderDebug();
    this._renderHostStats();
    this._renderDetail().catch((e) => console.error("system-map-card: detail render failed", e));
    const btn = this.querySelector(".smc-refresh");
    if (btn && this._lastRefreshed) btn.title = `Refresh (last updated ${this._lastRefreshed.toLocaleTimeString()})`;
  }

  // The strip along the top: the handful of numbers you'd check first on any
  // system monitor, joined from six Supervisor endpoints, the repairs
  // registry and the update entities. Each returns a tone so a stale backup
  // or a lost uplink reads as a problem without having to be read.
  _statusItems() {
    const items = [];
    const { host, core, os, supervisor, network, backups } = this._system;

    if (core?.version) {
      items.push({
        key: "core",
        label: "Core",
        value: core.version,
        tone: core.update_available ? "warn" : "ok",
        note: core.update_available ? `update to ${core.version_latest} available` : "up to date",
      });
    }
    if (os?.version) {
      items.push({
        key: "os",
        label: "OS",
        value: os.version,
        tone: os.update_available ? "warn" : "ok",
        note: [os.board, os.update_available ? `update to ${os.version_latest} available` : "up to date"].filter(Boolean).join(" - "),
      });
    }
    if (supervisor?.version) {
      items.push({
        key: "supervisor",
        label: "Supervisor",
        value: supervisor.version,
        tone: supervisor.update_available ? "warn" : "ok",
        note: supervisor.channel ? `${supervisor.channel} channel` : "",
      });
    }

    // Supervisor reports host disk in GB, not bytes - the one endpoint here
    // that doesn't use bytes, so it's converted rather than formatBytes'd.
    if (typeof host?.disk_free === "number" && typeof host?.disk_total === "number" && host.disk_total > 0) {
      const usedPct = Math.round(((host.disk_total - host.disk_free) / host.disk_total) * 100);
      items.push({
        key: "disk",
        label: "Disk",
        value: `${host.disk_free.toFixed(1)} GB free`,
        tone: usedPct >= 90 ? "bad" : usedPct >= 75 ? "warn" : "ok",
        note: `${usedPct}% of ${host.disk_total.toFixed(0)} GB used`,
      });
    }

    // boot_timestamp is microseconds since the epoch; the magnitude guard is
    // there because that's easy to get wrong and a 55,000-year uptime is a
    // funnier bug to ship than it is to debug.
    if (host?.boot_timestamp) {
      const bootMs = host.boot_timestamp > 1e14 ? host.boot_timestamp / 1000 : host.boot_timestamp * 1000;
      const age = formatAge(Date.now() - bootMs);
      if (age) items.push({ key: "uptime", label: "Uptime", value: age, tone: "info", note: `booted ${new Date(bootMs).toLocaleString()}` });
    }

    const updates = this._pendingUpdates();
    items.push({
      key: "updates",
      label: "Updates",
      value: updates.length ? `${updates.length} pending` : "none pending",
      tone: updates.length ? "warn" : "ok",
      note: updates.slice(0, 8).join(", "),
    });

    if (Array.isArray(backups)) {
      const newest = backups.map((b) => parseDate(b.date)).filter(Boolean).sort((a, b) => b - a)[0];
      const ageMs = newest ? Date.now() - newest : null;
      items.push({
        key: "backup",
        label: "Backup",
        value: newest ? `${formatAge(ageMs)} ago` : "none",
        tone: !newest || ageMs > 14 * 864e5 ? "bad" : ageMs > 7 * 864e5 ? "warn" : "ok",
        note: `${backups.length} backup${backups.length === 1 ? "" : "s"} stored`,
      });
    }

    if (network && ("host_internet" in network || "supervisor_internet" in network)) {
      const up = network.host_internet !== false && network.supervisor_internet !== false;
      items.push({ key: "internet", label: "Internet", value: up ? "connected" : "no connectivity", tone: up ? "ok" : "bad", note: "" });
    }

    // The one number worth surfacing about the boundary: how much of this
    // instance is reachable from outside, and through what.
    const routes = this._routes || [];
    if (routes.length) {
      const via = [...new Set(routes.map((r) => r.viaSlug).filter(Boolean))];
      items.push({
        key: "exposed",
        label: "Exposed",
        value: `${routes.length} hostname${routes.length === 1 ? "" : "s"}`,
        tone: "info",
        note: `${routes.map((r) => r.hostname).join(", ")} - via ${via.join(", ")}`,
      });
    }

    const open = this._issues.filter((i) => !i.ignored);
    if (open.length) {
      items.push({
        key: "repairs",
        label: "Repairs",
        value: `${open.length} open`,
        tone: open.some((i) => i.severity === "critical" || i.is_fixable === false) ? "bad" : "warn",
        note: open.slice(0, 6).map((i) => i.domain).join(", "),
      });
    }
    return items;
  }

  // Both halves of "what needs updating": HA's own update entities (Core, OS,
  // HACS, firmware...) and the Supervisor add-on list, which reports add-on
  // updates through its own flag rather than an entity.
  _pendingUpdates() {
    // An add-on update reaches this card twice: as an `update.*` entity the
    // Supervisor integration creates, named "<Add-on> Update", and as the
    // `update_available` flag on the add-on itself, named "<Add-on>". A set
    // of the raw names doesn't collapse those - the two spellings differ by
    // that one word - which is how a single Zigbee2MQTT update counted as
    // two. Dedupe on the name with a trailing "update" and all punctuation
    // stripped, so both spellings land on the same key.
    const seen = new Map();
    const add = (name) => {
      const display = String(name ?? "").replace(/\s*\bupdates?\b\s*$/i, "").trim() || String(name ?? "");
      const key = display.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key && !seen.has(key)) seen.set(key, display);
    };

    // Add-ons first: the Supervisor's own name for an add-on is the better
    // display name, and the first spelling seen is the one kept.
    for (const addon of this._addons) {
      if (addon.update_available) add(addon.name || addon.slug);
    }
    for (const [entityId, st] of Object.entries(this._hass?.states || {})) {
      if (!entityId.startsWith("update.") || st.state !== "on") continue;
      add(st.attributes?.friendly_name || entityId.slice("update.".length));
    }
    return [...seen.values()];
  }

  _renderStatusBar() {
    const el = this.querySelector(".smc-status");
    if (!el) return;
    const items = this._statusItems();
    this._statusByKey = new Map(items.map((i) => [i.key, i]));
    el.innerHTML = items
      .map(
        (i) => `<span class="smc-pill ${i.tone}" data-status="${escapeHtml(i.key)}" title="${escapeHtml(i.note || "")}">
          <span class="smc-pill-label">${escapeHtml(i.label)}</span><span class="smc-pill-value">${escapeHtml(i.value)}</span>
        </span>`
      )
      .join("");
  }

  // The evidence panel. Everything the map claims is inferred from something,
  // and when an inference is wrong or missing the useful question is "what
  // did you actually see?" - so this answers it directly, per add-on, rather
  // than leaving the reasoning implicit in a diagram. It is also the fastest
  // way to find out that a fact simply isn't in any API: an add-on with no
  // ports, no matched options and no log evidence has nothing to draw from.
  _renderDebug() {
    const el = this.querySelector(".smc-debug-body");
    if (!el) return;

    const esc = escapeHtml;
    const none = (text) => `<span class="smc-none">${esc(text)}</span>`;
    const table = (rows) =>
      rows.length
        ? `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>`
        : none("nothing found");

    const byId = new Map(this._derived.nodes.map((n) => [n.id, n]));
    const edgesFor = (id) =>
      this._derived.edges
        .filter(([from, to]) => from === id || to === id)
        .map(([from, to, opts]) => `${esc(byId.get(from)?.label || from)} → ${esc(byId.get(to)?.label || to)} <code>${esc(opts?.label || "")}</code>`);

    const addonRows = this._addons.map((addon) => {
      const info = this._addonInfoCache.get(addon.slug);
      const node = this._derived.nodes.find((n) => n.slug === addon.slug);
      const ports = Object.keys(info?.network || {});
      const roles = node?.roles || [];
      const facts = [
        `state <code>${esc(addon.state || "?")}</code>`,
        ports.length ? `ports <code>${esc(ports.join(", "))}</code>` : "no published ports",
        roles.length ? `roles <code>${esc(roles.join(", "))}</code>` : null,
        `tier <code>${esc(node?.tier || "not placed")}</code>`,
        // The category is a claim about what an add-on is, so it says on
        // whose evidence it was made rather than leaving it to be trusted.
        node?.category
          ? `kind <code>${esc(SERVICE_CATEGORIES[node.category] || node.category)}</code> - ${esc(node.categoryWhy || "")}`
          : null,
        info ? `options <code>${esc(Object.keys(info.options || {}).join(", ") || "none")}</code>` : "options not read yet",
        info?.map ? `folders <code>${esc((Array.isArray(info.map) ? info.map : Object.keys(info.map)).join(", "))}</code>` : null,
        this._logErrors.has(addon.slug)
          ? `<strong>log could not be read</strong>: ${esc(this._logErrors.get(addon.slug))}`
          : this._logSizes.has(addon.slug)
            ? `log read (${esc(String(this._logSizes.get(addon.slug)))} bytes)`
            : "log not read",
      ].filter(Boolean);
      const links = node ? edgesFor(node.id) : [];
      return [
        addon.name || addon.slug,
        `${facts.join(" · ")}${links.length ? `<br>${links.join("<br>")}` : `<br>${none("no derived links")}`}`,
      ];
    });

    // The whole chain, step by step: which logs were read, what came out of
    // them, and for each rule exactly why it did or didn't land on an add-on.
    const routeRows = (this._routes || []).map((r) => {
      const t = r.trace || {};
      const landed = byId.get(r.targetId)?.label;
      return [
        r.hostname,
        [
          `${esc(r.service)} → <strong>${esc(landed || "not matched")}</strong>`,
          `host <code>${esc(t.host || "?")}</code>, port <code>${esc(String(t.port ?? "none"))}</code>` +
            (t.local === undefined ? "" : `, ${t.local ? "on this machine" : "<strong>not this machine</strong>"}`),
          `${landed ? "matched" : "not matched"}: ${esc(t.reason || "no reason recorded")}`,
          `from ${esc(r.source)}, via ${esc(r.viaSlug || "?")}`,
          !landed && t.candidates?.length ? `ports seen: <code>${esc(t.candidates.join(" · "))}</code>` : "",
        ]
          .filter(Boolean)
          .join("<br>"),
      ];
    });

    const scan = this._routeScan || {};
    const scanRows = [
      ["Logs read", (scan.scanned || []).length ? esc((scan.scanned || []).join("; ")) : none("none")],
      scan.fallback ? ["Fallback", "no add-on's options named a tunnel, so every running add-on's log was read"] : null,
      ["Skipped", (scan.considered || []).length ? esc((scan.considered || []).join("; ")) : none("none")],
      ["Treated as local", esc([...this._localHosts()].join(", "))],
    ].filter(Boolean);

    const hardwareRows = this._derived.nodes
      .filter((n) => n.kind === "hardware")
      .map((n) => [
        n.label,
        `paths <code>${esc((n.paths || []).join(", ") || "none")}</code> · labels <code>${esc((n.labels || []).join(", ") || "none")}</code><br>` +
          ((n.usedBy || []).length
            ? n.usedBy.map((u) => `${esc(u.name)} <code>${esc(u.option)}</code>${u.via ? ` (via ${esc(u.via)})` : ""}`).join("<br>")
            : none("no add-on's options reference it")),
      ]);

    const dialled = (this._logServices || []).map((d) => [
      this._addons.find((a) => a.slug === d.fromSlug)?.name || d.fromSlug,
      `${esc(d.service)} → ${esc(this._resolveService(d.service, this._derived.nodes.filter((n) => n.kind === "addon"))?.id || "unresolved")}`,
    ]);

    el.innerHTML = `
      <h4>Add-ons (${this._addons.length})</h4>${table(addonRows)}
      <h4>Discovered hardware (${hardwareRows.length})</h4>${table(hardwareRows)}
      <h4>Route discovery</h4>${table(scanRows)}
      <h4>External routes (${routeRows.length})</h4>${table(routeRows)}
      <h4>Services named in logs (${dialled.length})</h4>${
        this._config.scan_service_logs ? table(dialled) : none("log scanning is off - enable \"Scan logs for service links\" to fill this in")
      }
      <h4>Fetches that failed</h4>${table(Object.entries(this._loadErrors).map(([k, v]) => [k, esc(v)]))}`;
  }

  _renderLegend() {
    const el = this.querySelector(".smc-legend");
    if (!el) return;
    const swatches = [
      ["Running / loaded", COLORS.started],
      ["Stopped / disabled", COLORS.stopped],
      ["Error", COLORS.error],
      ["Hardware", COLORS.hardware],
      ...TIER_ORDER.filter((t) => this._config.tiers.includes(t)).map((t) => [TIER_META[t], TIER_COLORS[t]]),
    ];
    el.innerHTML = swatches
      .map(([label, color]) => `<span><i style="background:${color}"></i>${escapeHtml(label)}</span>`)
      .join("");
  }

  _renderErrors() {
    const el = this.querySelector(".smc-errors");
    const failed = Object.entries(this._loadErrors).filter(([, v]) => v);

    // On a Container or Core install every Supervisor endpoint fails at once,
    // and eight near-identical "not found" messages in a red bar reads like
    // the card is broken when it isn't - most of it works fine without the
    // Supervisor. Say the one true thing instead, and keep listing anything
    // else individually, since those are real faults worth the detail.
    const supervisor = failed.filter(([k]) => SUPERVISOR_KEYS.has(k));
    const others = failed.filter(([k]) => !SUPERVISOR_KEYS.has(k));
    const msgs = others.map(([k, v]) => `${k}: ${escapeHtml(v)}`);
    if (supervisor.length >= 3) {
      msgs.unshift(
        `Supervisor API unavailable (${supervisor.length} endpoints) - the status bar, host stats, discovered hardware and add-on data need a Home Assistant OS or Supervised install. Everything else on this card works without it.`
      );
    } else {
      msgs.unshift(...supervisor.map(([k, v]) => `${k}: ${escapeHtml(v)}`));
    }

    if (!msgs.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = (msgs.length === 1 ? "" : "Some data failed to load - ") + msgs.join(" · ");
  }

  _findAddon(slug) {
    return this._addons.find((a) => a.slug === slug);
  }

  _findEntry(domain) {
    return this._entries.find((e) => e.domain === domain);
  }

  _deviceCountForDomain(domain) {
    const entry = this._findEntry(domain);
    if (!entry) return null;
    return this._devices.filter((d) => (d.config_entries || []).includes(entry.entry_id)).length;
  }

  // --- derived model ------------------------------------------------------

  // The effective node list: the curated layout plus whatever hardware was
  // discovered, with the non-hardware tiers pushed down far enough to clear
  // however many hardware rows this instance actually needs. Nothing else in
  // the card reads the raw lists directly, so a discovered device is a
  // first-class node everywhere - edges, highlights, detail, the lot.
  // The layout geometry this card's config asks for. Cached against the
  // column count so a render doesn't rebuild it for every node.
  _geo() {
    const columns = this._config?.columns || LAYOUT_DEFAULT_COLUMNS;
    if (this._geoCache?.asked !== columns) this._geoCache = { asked: columns, geo: layoutGeometry(columns) };
    return this._geoCache.geo;
  }

  _layout() {
    const shown = new Set(this._config.tiers);
    return this._derived.nodes.filter((n) => shown.has(n.tier));
  }

  _edges() {
    const shown = new Set(this._layout().map((n) => n.id));
    return this._derived.edges.filter(([from, to]) => shown.has(from) && shown.has(to));
  }

  _node(id) {
    return this._derived.nodes.find((n) => n.id === id);
  }

  // --- the derivation -----------------------------------------------------
  //
  // Everything on the map above the auto-grids is built here, from the
  // instance's own data. Nothing is hand-placed and nothing is named in
  // advance: an add-on's tier comes from the ports it publishes, its edges
  // from the hostnames in its own options, and its public URL from whichever
  // add-on is serving it a tunnel. Run in order, because each step reads the
  // one before it.
  _derive() {
    const addons = this._deriveAddonNodes();
    const hardware = this._deriveHardware(addons);
    const routes = this._deriveRoutes(addons);
    // A public URL belongs on whatever the tunnel actually points at.
    for (const route of routes) {
      const target = addons.find((n) => n.id === route.targetId);
      if (target && !target.exposedUrl) {
        target.exposedUrl = `https://${route.hostname}`;
        target.hostname = route.hostname;
        target.badge = route.hostname; // the subdomain, on the node itself
        target.notes.push(`Reachable at ${route.hostname} through ${route.viaSlug}`);
      }
    }
    const internet = this._deriveInternet(addons, routes);
    const nodes = [
      this._hostNode(routes),
      ...hardware.nodes,
      ...addons,
      ...this._deriveNetworkIntegrations(),
      ...internet.nodes,
    ];
    const edges = [...hardware.edges, ...this._deriveServiceEdges(nodes, routes), ...internet.edges];
    this._routes = routes;
    this._derived = { nodes: this._autoLayout(nodes, edges), edges };
  }

  // The boundary, drawn. "Which of these is a way in from outside?" was
  // answerable only by reading tier labels and edge text; with the outside
  // world as a node, every entry point is one hop from it and the shape of
  // the map answers the question. An entry point is anything that terminates
  // traffic from outside: an add-on publishing hostnames through a tunnel,
  // or one running a VPN (both established from evidence, not from names).
  _deriveInternet(addonNodes, routes) {
    const byId = new Map(addonNodes.map((n) => [n.id, n]));
    const entries = new Map();

    for (const route of routes) {
      if (!route.viaId || !byId.has(route.viaId)) continue;
      const entry = entries.get(route.viaId) || { node: byId.get(route.viaId), hostnames: [], vpn: false };
      if (!entry.hostnames.includes(route.hostname)) entry.hostnames.push(route.hostname);
      entries.set(route.viaId, entry);
    }
    for (const node of addonNodes) {
      const isVpn = (node.roles || []).some((role) => /VPN|Tailscale|WireGuard|OpenVPN/i.test(role));
      const isTunnel = this._tunnelSlugs?.has(node.slug);
      if (!isVpn && !isTunnel) continue;
      const entry = entries.get(node.id) || { node, hostnames: [], vpn: false };
      entry.vpn = isVpn;
      entry.tunnel = isTunnel;
      entries.set(node.id, entry);
    }
    if (!entries.size) return { nodes: [], edges: [] };

    const total = [...entries.values()].reduce((sum, e) => sum + e.hostnames.length, 0);
    const internet = {
      id: "internet",
      kind: "internet",
      tier: "remote",
      label: "Internet",
      icon: "cloud-outline",
      r: 44,
      badge: "OUTSIDE",
      notes: [
        `${entries.size} way${entries.size === 1 ? "" : "s"} in from outside`,
        total ? `${total} public hostname${total === 1 ? "" : "s"}` : null,
      ].filter(Boolean),
    };

    const edges = [...entries.values()].map(({ node, hostnames, vpn }) => [
      "internet",
      node.id,
      {
        label: hostnames.length
          ? `${hostnames.length} hostname${hostnames.length === 1 ? "" : "s"}`
          : vpn
            ? "VPN"
            : "tunnel",
      },
    ]);
    return { nodes: [internet], edges };
  }

  _hostNode(routes) {
    const external = routes.find((r) => r.targetId === "host");
    return {
      id: "host",
      kind: "host",
      tier: "hardware",
      label: this._system.host?.hostname || "Home Assistant",
      icon: "chip",
      r: 62,
      exposedUrl: external ? `https://${external.hostname}` : null,
      hostname: external?.hostname || null,
      badge: external?.hostname || null,
      // Home Assistant is reachable on the LAN like anything else, and was
      // the one node that only ever showed its public name. Without an
      // address there is no address to show: a bare ":8123" is not one, and
      // that is what a Core install with no Supervisor was left reading.
      lan: this._primaryAddress() ? `${this._primaryAddress()}:${Number(this._system.core?.port) || 8123}` : null,
      notes: [
        this._system.core?.version ? `Home Assistant Core ${this._system.core.version}` : null,
        this._system.os?.board ? `on ${this._system.os.board}` : null,
      ].filter(Boolean),
    };
  }

  // One node per add-on, tiered by the ports it publishes. An add-on with no
  // recognised port is a service, which is the honest default - it's running
  // and we can't say more than that.
  _deriveAddonNodes() {
    return this._addons.map((addon) => {
      const info = this._addonInfoCache.get(addon.slug);
      const ports = [...hostPortsFor(info), ...Object.keys(info?.network || {}).map((p) => parseInt(p, 10))];
      const roles = PORT_ROLES.filter((r) => ports.includes(r.port));
      if (!roles.length && servesSmb(info)) roles.push({ role: "SMB file server", port: 445 });
      const tier = roles.find((r) => r.tier)?.tier || "services";
      // The lowest port an add-on answers on is the one a person would type.
      // Failing that, a recognised protocol implies its own port: a
      // host-networked Samba publishes nothing visible, but SMB is 445
      // wherever it runs, and an address is more use than a blank line.
      const lanPort = [...hostPortsFor(info)].sort((a, b) => a - b)[0] || roles.find((r) => r.port)?.port;
      const address = this._primaryAddress();
      const kind = tier === "services" ? categoriseService(info, ports) : null;
      return {
        category: kind?.category,
        categoryWhy: kind?.why,
        lan: lanPort ? `${address ? `${address}:` : ":"}${lanPort}` : null,
        id: `addon_${slugify(addon.slug)}`,
        kind: "addon",
        slug: addon.slug,
        tier,
        label: addon.name || addon.slug,
        icon: iconForAddon(addon, roles, tier),
        r: 34,
        roles: roles.map((r) => r.role),
        notes: roles.length ? [`Publishes ${roles.map((r) => r.role).join(", ")}`] : [],
      };
    });
  }

  // A router or access point is an integration that reports where devices are
  // on the network - HA marks those device_tracker entities with
  // source_type "router". That is the one signal for "network infrastructure"
  // that doesn't require knowing the integration by name.
  _deriveNetworkIntegrations() {
    const byEntry = new Map();
    for (const reg of this._entityRegistry) {
      if (!reg.entity_id?.startsWith("device_tracker.") || !reg.config_entry_id) continue;
      if (this._hass?.states?.[reg.entity_id]?.attributes?.source_type !== "router") continue;
      byEntry.set(reg.config_entry_id, (byEntry.get(reg.config_entry_id) || 0) + 1);
    }
    return [...byEntry.entries()].map(([entryId, tracked]) => {
      const entry = this._entries.find((e) => e.entry_id === entryId);
      return {
        id: `entry_${slugify(entryId)}`,
        kind: "integration",
        domain: entry?.domain,
        entryId,
        tier: "network",
        label: entry?.title || entry?.domain || entryId,
        icon: "router-wireless",
        r: 34,
        notes: [`Reports ${tracked} device${tracked === 1 ? "" : "s"} as present on the network`],
      };
    });
  }

  // External hostnames, read from the add-on that publishes them. A tunnel
  // add-on's options carry its ingress rules - hostname plus the service URL
  // behind it - which is both more reliable and cheaper than parsing logs.
  // Anything configured remotely (rules living in the Cloudflare dashboard
  // rather than locally) only shows up in the log, so that's the fallback.
  _deriveRoutes(addonNodes) {
    const routes = [];
    for (const node of addonNodes) {
      const info = this._addonInfoCache.get(node.slug);
      if (!info || info._error) continue;
      for (const raw of collectRoutes(info.options)) {
        const trace = {};
        const target = this._resolveService(raw.service, addonNodes, trace);
        routes.push({ ...raw, viaId: node.id, viaSlug: node.slug, targetId: target?.id ?? null, trace });
      }
    }
    for (const raw of this._logRoutes || []) {
      const trace = {};
      const target = this._resolveService(raw.service, addonNodes, trace);
      const via = addonNodes.find((n) => n.slug === raw.viaSlug);
      routes.push({ ...raw, viaId: via?.id ?? null, targetId: target?.id ?? null, trace });
    }
    // An add-on that publishes hostnames for other things is a way in, not a
    // service - that's what makes it "remote access" without knowing its name.
    // Its own hostnames go on it, so "what is exposed, and through what" is
    // answerable from the map even when a rule can't be attributed to the
    // add-on behind it.
    for (const node of addonNodes) {
      const mine = routes.filter((r) => r.viaId === node.id);
      // Being a way in and having readable rules are different facts, and
      // tying the first to the second put a tunnel whose rules could not be
      // parsed in with the ordinary services. The evidence for "way in" is
      // its own: tunnel-shaped options, or a log that says so.
      const isWayIn = mine.length > 0 || this._tunnelSlugs?.has(node.slug);
      if (!isWayIn) continue;
      node.tier = "remote";
      if (mine.length) {
        node.routes = mine;
        node.notes.push(...mine.map((r) => `${r.hostname} → ${r.service}`));
      } else {
        node.notes.push("Identified as a way in from outside, but none of its routes could be read");
      }
    }
    return routes;
  }

  // "http://addon_x_pingvin:3000" -> that add-on's node. A rule pointing at
  // the machine itself is resolved by port instead, since that's the only
  // thing distinguishing one local service from another.
  // `trace`, when passed, is filled in with every step of the decision. The
  // evidence panel prints it verbatim: when a hostname doesn't land on the
  // add-on serving it, the useful question is which link broke, and guessing
  // at that from the outside is exactly what wasted the most time here.
  _resolveService(service, addonNodes, trace = {}) {
    trace.service = service;
    if (!service) return (trace.reason = "no service in the rule"), null;
    const match = String(service).match(/^(?:[a-z0-9+.-]+:\/\/)?([^/:]+)(?::(\d+))?/i);
    if (!match) return (trace.reason = "could not parse a host out of the rule"), null;
    const [, host, portText] = match;
    const port = portText ? parseInt(portText, 10) : null;
    trace.host = host;
    trace.port = port;

    const byName = addonNodes.find((n) => addonIdentifiers(n.slug).some((id) => id.toLowerCase() === host.toLowerCase()));
    if (byName) return (trace.reason = `host is the add-on's own name`), byName;

    // A rule can also point straight at an add-on's own container address.
    const byIp = addonNodes.find((n) => this._addonInfoCache.get(n.slug)?.ip_address === host);
    if (byIp) return (trace.reason = `host is the add-on's container address`), byIp;

    const local = this._localHosts().has(host.toLowerCase()) || isPrivateAddress(host);
    trace.local = local;
    if (!local) return (trace.reason = `${host} is not this machine, so the rule points somewhere else`), null;
    if (!port) return (trace.reason = "rule has no port to match on"), null;

    const candidates = addonNodes
      .map((n) => ({ node: n, ports: [...hostPortsFor(this._addonInfoCache.get(n.slug))] }))
      .filter((c) => c.ports.length);
    trace.candidates = candidates.map((c) => `${c.node.label}: ${c.ports.join(", ")}`);

    const byPort = candidates.find((c) => c.ports.includes(port));
    if (byPort) return (trace.reason = `port ${port} is published by this add-on`), byPort.node;

    // Only Home Assistant's own port is Home Assistant. Treating every
    // unresolved local rule as the host was worse than leaving it unresolved:
    // it quietly attributed someone else's subdomain to Home Assistant and
    // left the add-on actually serving it with no hostname at all.
    const corePort = Number(this._system.core?.port) || 8123;
    if (port === corePort) return (trace.reason = `port ${port} is Home Assistant's own`), { id: "host" };
    trace.reason = `no add-on reports port ${port}`;
    return null;
  }

  // Positions, computed rather than authored. Tiers stack down the page in
  // the order they're drawn in; within a tier, a node is placed near the
  // average position of whatever it connects to in the tier above, which is
  // the standard barycentre trick for keeping edges from crossing. Ties keep
  // the input order, so the map doesn't reshuffle between refreshes.
  // Which labelled box each node belongs in, and the order those boxes are
  // stacked. Normally one box per tier; the services tier is split into its
  // categories when doing so tells the reader something - which is not
  // always. Four boxes holding one card each is worse than one holding four,
  // so the split has to earn itself: enough services to be hard to scan, and
  // at least two categories with real membership. Otherwise the tier is left
  // whole, exactly as before.
  _groupsFor(nodes) {
    const services = nodes.filter((n) => n.tier === "services");
    const counts = new Map();
    for (const n of services) counts.set(n.category, (counts.get(n.category) || 0) + 1);
    // "Other services" is the bucket for add-ons whose manifest says nothing
    // useful, so a split into one real category plus that one has told the
    // reader almost nothing. At least two categories that mean something
    // have to be populated before the extra boxes are worth their space.
    const informative = CATEGORY_ORDER.filter((c) => c !== "other" && (counts.get(c) || 0) >= 2);
    const worthwhile =
      this._config.group_services !== false && services.length >= GROUP_SERVICES_MIN && informative.length >= 2;

    for (const n of nodes) n.group = worthwhile && n.tier === "services" ? `services:${n.category || "other"}` : n.tier;

    const order = [];
    for (const tier of TIER_ORDER) {
      if (tier !== "services" || !worthwhile) {
        order.push(tier);
        continue;
      }
      for (const cat of CATEGORY_ORDER) if (counts.get(cat)) order.push(`services:${cat}`);
    }
    return order;
  }

  _autoLayout(nodes, edges) {
    const geo = this._geo();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const neighbours = new Map();
    for (const [from, to] of edges) {
      if (!byId.has(from) || !byId.has(to)) continue;
      (neighbours.get(from) || neighbours.set(from, []).get(from)).push(to);
      (neighbours.get(to) || neighbours.set(to, []).get(to)).push(from);
    }

    const hardware = nodes.filter((n) => n.tier === "hardware" && n.kind !== "host");
    const host = nodes.find((n) => n.kind === "host");
    if (host) {
      host.x = geo.hwColX(geo.hostCol);
      host.y = 150;
    }
    // _deriveHardware already gave the discovered devices their slots.
    let y = 150 + geo.hwRowCount(hardware.length) * HW_ROW_H;

    const placedX = new Map(host ? [[host.id, host.x]] : []);
    for (const n of hardware) placedX.set(n.id, n.x);

    for (const group of this._groupsFor(nodes)) {
      if (group === "hardware") continue;
      const inTier = nodes.filter((n) => n.group === group);
      if (!inTier.length) continue;

      const barycentre = (n) => {
        const xs = (neighbours.get(n.id) || []).map((id) => placedX.get(id)).filter((x) => x !== undefined);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY;
      };
      const ordered = inTier
        .map((n, i) => ({ n, i, b: barycentre(n) }))
        .sort((a, b) => a.b - b.b || a.i - b.i)
        .map((entry) => entry.n);

      // As many per row as the config asks for, or as many as there are.
      // "Cards per row" should mean cards per row.
      const perRow = Math.min(geo.cols, ordered.length);
      const rows = Math.ceil(ordered.length / perRow);
      y += LAYOUT_TIER_GAP;
      // A fixed column step, with the whole block centred - rather than
      // stretching each row to the full width, which spaced a row of three
      // like a row of ten and left the columns unaligned between rows.
      const left = (geo.width - (perRow - 1) * LAYOUT_COL_STEP) / 2;
      ordered.forEach((n, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        n.x = left + col * LAYOUT_COL_STEP;
        n.y = y + row * LAYOUT_ROW_H;
        placedX.set(n.id, n.x);
      });
      y += (rows - 1) * LAYOUT_ROW_H + LAYOUT_ROW_H;
    }

    // The bottom edge of the last tier box, so anything stacking below it
    // can use the same gap the tiers use between themselves.
    this._layoutBottom = y - LAYOUT_ROW_H + CARD_H / 2 + 16;
    return nodes;
  }

  // The address this instance answers on, used to show an add-on's LAN
  // endpoint next to its public one. The primary interface if one is marked,
  // otherwise the first that has an address at all.
  _primaryAddress() {
    const interfaces = this._system.network?.interfaces || [];
    const chosen = interfaces.find((i) => i.primary && i.ipv4?.address?.length) || interfaces.find((i) => i.ipv4?.address?.length);
    return chosen ? String(chosen.ipv4.address[0]).split("/")[0] : null;
  }

  // "localhost" and friends, plus this machine's own LAN addresses - a
  // remotely-managed tunnel points its rules at the host's IP rather than at
  // a container name, so without these every one of its routes resolves to
  // nothing.
  _localHosts() {
    const hosts = new Set(LOCAL_HOSTS);
    for (const iface of this._system.network?.interfaces || []) {
      for (const cidr of iface.ipv4?.address || []) hosts.add(String(cidr).split("/")[0].toLowerCase());
      for (const cidr of iface.ipv6?.address || []) hosts.add(String(cidr).split("/")[0].toLowerCase());
    }
    if (this._system.host?.hostname) hosts.add(String(this._system.host.hostname).toLowerCase());
    return hosts;
  }

  // Add-ons name each other in their own options - an MQTT client points at
  // `mqtt://core-mosquitto:1883`, a proxy at `http://addon_x:80`. Matching
  // every add-on's identifiers against every other add-on's options turns
  // that into edges, with the option that matched as the label.
  _deriveServiceEdges(nodes, routes) {
    const edges = [];
    const addonNodes = nodes.filter((n) => n.kind === "addon");

    for (const consumer of addonNodes) {
      const info = this._addonInfoCache.get(consumer.slug);
      if (!info || info._error) continue;
      for (const provider of addonNodes) {
        if (provider.id === consumer.id) continue;
        const hit = findDeviceInOptions(info.options, { paths: addonIdentifiers(provider.slug), labels: [] });
        if (hit) edges.push([consumer.id, provider.id, { label: hit.option, dashed: true }]);
      }
    }

    // A tunnel's ingress rule is an edge from the way in to what it reaches.
    // Deliberately unlabelled: the target node already wears the hostname, and
    // printing it again along the edge just crowds the map with the same
    // string twice - which reads as two different facts.
    for (const route of routes) {
      if (!route.viaId || !route.targetId || route.viaId === route.targetId) continue;
      edges.push([route.viaId, route.targetId, { dashed: true }]);
    }

    // An add-on that named another add-on's address in its log depends on
    // it, whether or not that dependency is written anywhere in its options.
    for (const dialled of this._logServices || []) {
      const from = addonNodes.find((n) => n.slug === dialled.fromSlug);
      const to = this._resolveService(dialled.service, addonNodes);
      if (!from || !to || to.id === from.id || to.id === "host") continue;
      if (edges.some(([a, b]) => a === from.id && b === to.id)) continue;
      edges.push([from.id, to.id, { dashed: true, label: `:${dialled.port} (log)` }]);
    }

    // An integration and the add-on serving its protocol.
    for (const node of nodes.filter((n) => n.kind === "integration")) {
      const port = DOMAIN_SERVICE_PORTS[node.domain];
      if (!port) continue;
      for (const provider of addonNodes) {
        const info = this._addonInfoCache.get(provider.slug);
        if (Object.keys(info?.network || {}).some((p) => parseInt(p, 10) === port)) {
          edges.push([node.id, provider.id, { label: node.domain }]);
        }
      }
    }
    return edges;
  }

  // Builds the hardware tier from Supervisor's /hardware/info: every drive,
  // and every serial device that has a stable by-id path (which is what a
  // Zigbee/Z-Wave dongle looks like - the rest of `devices` is thousands of
  // sysfs entries nobody wants on a map). Ownership edges are then derived by
  // looking for those exact paths in each add-on's own options, so "which
  // add-on owns this dongle" is read off the configuration rather than
  // asserted by hand.
  _deriveHardware(addonNodes = []) {
    const geo = this._geo();
    if (!this._config.discover_hardware || !this._hardware) return { nodes: [], edges: [] };
    const devices = Array.isArray(this._hardware.devices) ? this._hardware.devices : [];
    const drives = Array.isArray(this._hardware.drives) ? this._hardware.drives : [];

    const serial = devices
      .filter((d) => d.subsystem === "tty" && d.by_id)
      .map((d) => ({
        id: `hw_tty_${slugify(d.by_id)}`,
        label: prettySerialName(d),
        icon: "usb-port",
        labels: [],
        paths: [d.by_id, d.dev_path].filter(Boolean),
        detail: { Kind: "Serial / USB device", Path: d.dev_path, "By-id": d.by_id, Subsystem: d.subsystem },
      }));

    const disks = drives.map((d) => {
      const mounts = (d.filesystems || []).flatMap((fs) => fs.mount_points || []);
      // Labels shorter than three characters are dropped: they match too
      // much to be evidence of anything.
      const labels = (d.filesystems || []).map((fs) => fs.name).filter((n) => n && n.length >= 3);
      return {
        id: `hw_drive_${slugify(d.id || d.serial || d.model || "drive")}`,
        label: [d.vendor, d.model].filter(Boolean).join(" ") || d.id || "Drive",
        icon: "harddisk",
        labels,
        paths: [...mounts, ...(d.filesystems || []).map((fs) => fs.device).filter(Boolean)],
        detail: {
          Kind: "Drive",
          Model: [d.vendor, d.model].filter(Boolean).join(" "),
          Size: formatBytes(d.size),
          Bus: d.connection_bus,
          Removable: d.removable ? "yes" : "no",
          "Mounted at": mounts.join(", ") || "not mounted",
          Label: labels.join(", "),
          Serial: d.serial,
        },
      };
    });

    const found = [...disks, ...serial];
    // Host first in the row, then the discovered devices around it.
    const nodes = found.map((h, i) => {
      const { row, col } = geo.hwSlot(i);
      return { ...h, kind: "hardware", tier: "hardware", derived: true, r: 32, x: geo.hwColX(col), y: 150 + row * HW_ROW_H };
    });

    // Every discovered device is physically attached to the host, so that
    // edge is always true; the interesting one is which add-on claims it.
    const edges = nodes.map((n) => ["host", n.id, { label: n.icon === "harddisk" ? "disk" : "USB" }]);

    const claims = [];
    for (const n of nodes) {
      for (const [slug, info] of this._addonInfoCache) {
        if (!info || info._error) continue;
        const hit = findDeviceInOptions(info.options, n);
        if (hit) claims.push({ node: n, slug, info, ...hit });
      }
    }

    // Several add-ons referencing one disk is usually not several add-ons
    // touching the hardware: it's one of them mounting the disk and serving
    // it, and the rest reaching it over that share. Where a claimant is an
    // SMB server (by its own published ports, not its name), the others are
    // drawn downstream of *it* rather than hanging off the drive - which is
    // what the dependency actually is, and what breaks if that add-on stops.
    const nodeFor = (slug) => addonNodes.find((h) => h.slug === slug);
    const shares = [];
    for (const n of nodes) {
      const forNode = claims.filter((c) => c.node === n);
      const servers = forNode.filter((c) => servesSmb(c.info));

      // The share itself is a node. Saying "Samba serves NAS1" and "Immich
      // reads NAS1" as two labels on two edges leaves the reader to join
      // them up; drawing the share makes the chain - disk, then the add-on
      // exporting it, then the share, then everything mounting it - the
      // shape of the picture rather than something to infer from text.
      for (const server of servers) {
        const shareNode = {
          id: `share_${slugify(server.slug)}_${slugify(server.matched)}`,
          kind: "share",
          tier: "services",
          category: "netsvc",
          categoryWhy: "an SMB share is reached over the network by whatever mounts it",
          label: `${server.matched} (SMB)`,
          icon: "folder-network",
          r: 26,
          share: server.matched,
          servedBy: server.slug,
          lan: `\\\\${this._primaryAddress() || "host"}\\${server.matched}`,
          notes: [`SMB share exported by ${server.info.name || server.slug} from ${n.label}`],
        };
        shares.push(shareNode);
        const serverNode = nodeFor(server.slug);
        if (serverNode) edges.push([serverNode.id, shareNode.id, { label: "exports" }]);
      }

      for (const claim of forNode) {
        const isServer = servers.includes(claim);
        const server = isServer ? null : servers.find((sv) => sv.slug !== claim.slug);
        (n.usedBy = n.usedBy || []).push({
          slug: claim.slug,
          name: claim.info.name || claim.slug,
          option: claim.option,
          share: server ? server.matched : null,
          via: server ? server.info.name || server.slug : null,
        });

        const target = nodeFor(claim.slug);
        if (!target) continue;
        const shareNode = server ? shares.find((sh) => sh.servedBy === server.slug && sh.share === server.matched) : null;
        // A consumer hangs off the share, not the disk: the share is what
        // breaks when the exporting add-on stops.
        if (shareNode) edges.push([shareNode.id, target.id, { dashed: true, label: `mounts (${claim.option})` }]);
        else edges.push([n.id, target.id, { label: `${isServer ? "serves" : "owns"} (${claim.option})` }]);
      }
    }

    return { nodes: [...nodes, ...shares], edges };
  }

  // Resolves an entity registry entry to node key(s) once per
  // platform+entry combination - called for every entity in the registry, so
  // the memo is what keeps the problem join from being O(entities x entries).
  _targetKeys(reg) {
    const memoKey = `${reg.platform}|${reg.config_entry_id || ""}`;
    if (!this._targetMemo) this._targetMemo = new Map();
    if (this._targetMemo.has(memoKey)) return this._targetMemo.get(memoKey);
    const keys = this._mapTargetForRegistryEntry(reg)?.keys || [];
    this._targetMemo.set(memoKey, keys);
    return keys;
  }

  // The join that turns the map from a diagram into a monitor: an add-on can
  // be "started" and an integration "loaded" while every entity they serve is
  // dead, and only this catches that.
  _buildProblemIndex() {
    this._targetMemo = new Map();
    this._problems = new Map();
    if (!this._config.highlight_problems) return;

    const bump = (key, field, by = 1) => {
      const rec = this._problems.get(key) || { unavailable: 0, entities: 0, issues: [], health: null };
      rec[field] += by;
      this._problems.set(key, rec);
    };

    for (const reg of this._entityRegistry) {
      if (reg.disabled_by) continue;
      const st = this._hass?.states?.[reg.entity_id];
      const dead = !st || st.state === "unavailable" || st.state === "unknown";
      for (const key of this._targetKeys(reg)) {
        bump(key, "entities");
        if (dead) bump(key, "unavailable");
      }
    }

    // A repair issue is raised against a domain, so it lands on whichever
    // node that domain resolves to - the same resolution the entity finder
    // uses, so an issue and an entity for one integration agree on a node.
    for (const issue of this._issues) {
      if (issue.ignored) continue;
      for (const key of this._keysForDomain(issue.domain)) {
        const rec = this._problems.get(key) || { unavailable: 0, entities: 0, issues: [], health: null };
        rec.issues.push(issue);
        this._problems.set(key, rec);
      }
    }

    for (const [domain, info] of Object.entries(this._systemHealth || {})) {
      for (const key of this._keysForDomain(domain)) {
        const rec = this._problems.get(key) || { unavailable: 0, entities: 0, issues: [], health: null };
        rec.health = info?.info ?? info;
        this._problems.set(key, rec);
      }
    }
  }

  _keysForDomain(domain) {
    if (!domain) return [];
    return this._targetKeys({ platform: domain, config_entry_id: null });
  }

  // Device / entity / area counts per node, so an integration tile reads
  // "12 devices - 84 entities - 4 areas" instead of nothing.
  _buildCounts() {
    this._counts = new Map();
    if (!this._config.show_counts) return;

    const areaById = new Map(this._areas.map((a) => [a.area_id, a]));
    const deviceById = new Map(this._devices.map((d) => [d.id, d]));
    const rec = (key) => {
      let r = this._counts.get(key);
      // areas is a count per area, not a set, so "which area is this
      // integration mostly in" has a real answer for the grouped layout.
      if (!r) this._counts.set(key, (r = { devices: new Set(), entities: 0, areas: new Map() }));
      return r;
    };

    for (const reg of this._entityRegistry) {
      if (reg.disabled_by) continue;
      const device = reg.device_id ? deviceById.get(reg.device_id) : null;
      const areaId = reg.area_id || device?.area_id || null;
      for (const key of this._targetKeys(reg)) {
        const r = rec(key);
        r.entities++;
        if (reg.device_id) r.devices.add(reg.device_id);
        if (areaId && areaById.has(areaId)) r.areas.set(areaId, (r.areas.get(areaId) || 0) + 1);
      }
    }
  }

  // Config overrides win; otherwise fall back to the System Monitor entity
  // names this instance actually has (see the HOST_STATS comment).
  _hostStats() {
    const overrides = {
      cpu: this._config.cpu_entity,
      ram: this._config.ram_entity,
      disk: this._config.disk_entity,
    };
    const stats = HOST_STATS.map((s) => (overrides[s.key] ? { ...s, entity: overrides[s.key] } : s));
    if (this._config.temperature_entity) {
      stats.push({ key: "temp", label: "Temperature", entity: this._config.temperature_entity, suffix: "°" });
    }
    return stats;
  }

  // Resolves a hub node's live status + short sub-label in one place, so
  // both the graph and the hide-inactive filter agree on what "inactive"
  // means for that node.
  _nodeState(n) {
    let status = "unknown";
    let sub = "";
    if (n.kind === "host") status = "host";
    else if (n.kind === "hardware") status = "hardware";
    else if (n.kind === "internet") {
      status = "internet";
    } else if (n.kind === "share") {
      // A share is only up while the add-on exporting it is, so it takes
      // that add-on's state rather than looking permanently unknown.
      status = addonStatus(this._findAddon(n.servedBy));
      sub = `served by ${this._findAddon(n.servedBy)?.name || n.servedBy}`;
    }
    else if (n.kind === "addon") {
      const addon = this._findAddon(n.slug);
      status = addonStatus(addon);
      if (addon?.update_available) sub = "update available";
    } else if (n.kind === "integration") {
      const entry = this._findEntry(n.domain);
      status = entryStatus(entry);
    }
    if (n.deviceCountDomain) {
      const count = this._deviceCountForDomain(n.deviceCountDomain);
      if (count !== null) sub = `${count} device${count === 1 ? "" : "s"}`;
    }

    // Counts replace the hand-set device count wherever the registries can
    // actually answer for this node, which is most of them.
    const counts = this._counts.get(`node:${n.id}`);
    if (counts && (counts.devices.size || counts.entities)) {
      sub = [counts.devices.size ? `${counts.devices.size} dev` : "", counts.entities ? `${counts.entities} ent` : ""]
        .filter(Boolean)
        .join(" · ");
    }
    if (n.usedBy?.length) {
      // Only who actually mounts the device, and at most two of them: a disk
      // republished over SMB can have half the add-on list downstream of it,
      // and the full list under a 32px circle is a wall of overlapping text.
      // The rest is in the detail panel.
      const direct = n.usedBy.filter((u) => !u.via);
      const names = (direct.length ? direct : n.usedBy).map((u) => u.name);
      const shown = names.slice(0, 2).join(", ");
      sub = `used by ${shown}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
    }

    // Where a thing is reachable is the question the map exists to answer, so
    // both answers get a line of their own: the LAN address someone would
    // type, and the hostname it answers to from outside. Neither replaces the
    // other - "on the LAN only" and "also public" are different facts.
    const subs = [];
    const problem = this._problemFor(`node:${n.id}`);
    if (problem) subs.push(problem.label);
    if (n.lan) subs.push(n.lan);
    if (n.hostname) subs.push(n.hostname);
    if (n.routes?.length) {
      const unresolved = n.routes.filter((r) => !r.targetId).length;
      subs.push(`${n.routes.length} hostname${n.routes.length === 1 ? "" : "s"}${unresolved ? ` · ${unresolved} unmatched` : ""}`);
    }
    if (!subs.length && sub) subs.push(sub);

    return { status, sub: subs[0] || "", subs: subs.slice(0, 3), problem };
  }

  // Reduces the problem index for one node key to the single worst thing
  // worth putting on a 30px circle, or null when there's nothing to say.
  _problemFor(key) {
    if (!this._config.highlight_problems) return null;
    const rec = this._problems.get(key);
    if (!rec) return null;
    if (rec.unavailable > 0) {
      return {
        severity: "bad",
        label: `${rec.unavailable}/${rec.entities} unavailable`,
        badge: String(rec.unavailable),
        reason: `${rec.unavailable} of ${rec.entities} entities are unavailable or unknown`,
      };
    }
    if (rec.issues?.length) {
      return {
        severity: "warn",
        label: `${rec.issues.length} repair issue${rec.issues.length === 1 ? "" : "s"}`,
        badge: "!",
        reason: rec.issues.map((i) => i.issue_id || i.translation_key || "issue").join(", "),
      };
    }
    return null;
  }

  // --- graph rendering ----------------------------------------------------

  _renderGraph() {
    this._nodePositions = new Map();
    const layout = this._layout();
    const hidden = new Set();
    if (this._hideInactive) {
      for (const n of layout) {
        if (n.kind === "host" || n.kind === "hardware") continue;
        if (isInactiveStatus(this._nodeState(n).status)) hidden.add(n.id);
      }
    }
    const visible = layout.filter((n) => !hidden.has(n.id));
    // Two independent reasons to single nodes out - the entity finder's
    // answer, and the node the user selected. Either dims the rest.
    const lit = this._litSet();
    const focusId = this._focusNodeId();
    const dimming = !!lit?.size;

    // Tier bounding boxes - computed from the actual visible node positions
    // + radii each render, so they stay correct without manual upkeep.
    // A card carries its own text, so the tier box only has to contain the
    // cards themselves plus a margin - no more guessing at how many label
    // lines might hang below a circle.
    const boxes = {};
    for (const n of visible) {
      const key = n.group || n.tier;
      const b = boxes[key] || (boxes[key] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const { w, h } = cardSize(n);
      b.minX = Math.min(b.minX, n.x - w / 2 - 16);
      b.maxX = Math.max(b.maxX, n.x + w / 2 + 16);
      b.minY = Math.min(b.minY, n.y - h / 2 - 16);
      b.maxY = Math.max(b.maxY, n.y + h / 2 + 16);
    }

    const drawnGroups = this._groupsFor(layout).filter((g) => boxes[g]);
    const boxesSvg = drawnGroups
      .map((g) => {
        const b = boxes[g];
        const color = groupColor(g);
        return `<rect class="smc-tier-box" x="${b.minX}" y="${b.minY}" width="${b.maxX - b.minX}" height="${b.maxY - b.minY}" rx="14" style="fill:${color};fill-opacity:0.1;stroke:${color};stroke-opacity:0.55;" />`;
      })
      .join("");
    const tierLabelsSvg = drawnGroups
      .map((g) => `<text class="smc-tier-label" x="${boxes[g].minX + 4}" y="${boxes[g].minY - 10}" style="fill:${groupColor(g)}">${escapeHtml(groupLabel(g))}</text>`)
      .join("");

    const byId = new Map(layout.map((n) => [n.id, n]));
    const edgeLabels = [];
    const edgesSvg = this._edges()
      .filter(([fromId, toId]) => !hidden.has(fromId) && !hidden.has(toId))
      .map(([fromId, toId, opts]) => {
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (!from || !to) return "";
        // An edge is *hot* when it is one of the selected node's own
        // connections - drawn brightly, since it is the answer to the
        // question. The finder instead lights edges whose two ends are both
        // in its result, which is a different claim: not "these are joined"
        // but "both of these serve the entity".
        const hot = !!focusId && (fromId === focusId || toId === focusId);
        const edgeHi = hot || !!(this._highlight?.has(`node:${fromId}`) && this._highlight?.has(`node:${toId}`));
        const cls =
          "smc-edge" +
          (opts?.dashed ? " dashed" : "") +
          (hot ? " smc-edge-hot" : "") +
          (dimming && !edgeHi ? " smc-dim" : "");
        const line = `<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
        if (opts?.label)
          edgeLabels.push({ text: opts.label, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 6, hot, dim: dimming && !edgeHi });
        return line;
      })
      .join("");

    // The tier outlines are obstacles too. Labels were avoiding nodes but not
    // the boxes, so one landing on a box's top edge had that border drawn
    // straight through it - which reads as struck-through text, not as a
    // label crossing a line.
    const boxEdges = drawnGroups.flatMap((g) => {
      const b = boxes[g];
      // 12px bold uppercase, averaged - it only has to be close enough to
      // keep an edge label from being written across the box's own name.
      const labelW = groupLabel(g).length * 7.4;
      return [
        { x0: b.minX, x1: b.maxX, y0: b.minY - 2, y1: b.minY + 2 },
        { x0: b.minX, x1: b.maxX, y0: b.maxY - 2, y1: b.maxY + 2 },
        { x0: b.minX, x1: b.minX + labelW, y0: b.minY - 22, y1: b.minY - 4 },
      ];
    });
    const labelsSvg = this._placeEdgeLabels(edgeLabels, visible, boxEdges)
      .map(
        (l) =>
          `<text class="smc-edge-label${l.hot ? " smc-edge-label-hot" : ""}${l.dim ? " smc-dim" : ""}" x="${l.x}" y="${l.y}">${escapeHtml(l.text)}</text>`
      )
      .join("");

    const nodesSvg = visible
      .map((n) => {
        const { subs, status, problem } = this._nodeState(n);
        const color = colorFor(status);
        const { w, h } = cardSize(n);
        const x0 = n.x - w / 2;
        const y0 = n.y - h / 2;
        this._nodePositions.set(`node:${n.id}`, { x: n.x, y: n.y, w, h, r: Math.max(w, h) / 2 });
        const isHi = !!lit?.has(`node:${n.id}`);
        const cls =
          "smc-node smc-card-node" +
          (n.kind === "internet" ? " smc-internet" : "") +
          (problem ? " smc-problem" : "") +
          (dimming ? (isHi ? " smc-hi" : " smc-dim") : "");

        // The add-on's own icon where it ships one; otherwise the icon
        // derived from what the add-on does, on a tile of the status colour
        // so it stays visible against the card.
        const ownIcon = n.slug ? this._addonIcons.get(n.slug) : null;
        const iconPath = n.icon ? ICON_PATHS[n.icon] : null;
        const size = n.kind === "host" ? 42 : 36;
        const ix = n.x - size / 2;
        // Cards are a fixed size so the grid stays even, but their contents
        // vary from one line to four. Measure the block first and centre it,
        // rather than pinning it to the top and leaving a dead half below.
        const nameLines = wrapLabel(n.label, n.kind === "host" ? 20 : 17);
        const subLines = subs.filter((line) => line !== n.hostname);
        const contentH =
          size + 18 + nameLines.length * 15 + 2 + subLines.length * 14 + (n.hostname ? 16 : -11);
        const iy = y0 + Math.max(12, (h - contentH) / 2);
        const iconSvg = ownIcon
          ? `<image href="${escapeHtml(ownIcon)}" x="${ix}" y="${iy}" width="${size}" height="${size}" clip-path="url(#smc-icon-clip)" preserveAspectRatio="xMidYMid slice" pointer-events="none" />`
          : `<rect x="${ix}" y="${iy}" width="${size}" height="${size}" rx="9" fill="${color}" />` +
            (iconPath
              ? `<g transform="translate(${ix + size * 0.16},${iy + size * 0.16}) scale(${(size * 0.68) / 24})" pointer-events="none"><path d="${iconPath}" fill="white" /></g>`
              : "");

        // Content is laid out with a cursor rather than fixed offsets, so a
        // two-line name pushes what follows down instead of overlapping it.
        let cursor = iy + size + 18;
        const parts = [];
        for (const line of nameLines) {
          parts.push(`<text class="smc-card-name" x="${n.x}" y="${cursor}">${escapeHtml(line)}</text>`);
          cursor += 15;
        }
        cursor += 2;
        for (const line of subLines) {
          const tone = problem && line === problem.label ? " smc-card-bad" : "";
          parts.push(`<text class="smc-card-sub${tone}" x="${n.x}" y="${cursor}">${escapeHtml(truncate(line, 22))}</text>`);
          cursor += 14;
        }
        if (n.hostname) {
          const pw = w - 16;
          parts.push(
            `<rect class="smc-host-pill" x="${n.x - pw / 2}" y="${cursor - 2}" width="${pw}" height="18" rx="9" />` +
              `<text class="smc-host-pill-text" x="${n.x}" y="${cursor + 11}">${escapeHtml(truncate(n.hostname, 24))}</text>`
          );
          cursor += 22;
        }

        const aria = [n.label, ...subs].join(", ");
        return `
          <g class="${cls}" data-node="${n.id}" tabindex="0" role="button" aria-label="${escapeHtml(aria)}"><title>${escapeHtml([n.label, ...subs].join(" · "))}</title>
            <rect class="smc-card" x="${x0}" y="${y0}" width="${w}" height="${h}" rx="12" />
            <path class="smc-card-stripe" d="M${x0 + 12},${y0} H${x0 + w - 12} A12,12 0 0 1 ${x0 + w},${y0 + 12} V${y0 + 5} H${x0} V${y0 + 12} A12,12 0 0 1 ${x0 + 12},${y0} Z" fill="${color}" />
            ${iconSvg}
            ${parts.join("")}
            ${problem ? `<circle cx="${x0 + w - 12}" cy="${y0 + 12}" r="9" fill="var(--error-color, #db4437)" stroke="var(--card-background-color, #1c1c1c)" stroke-width="2" /><text class="smc-problem-badge" x="${x0 + w - 12}" y="${y0 + 16}" style="fill:#fff">${escapeHtml(problem.badge)}</text>` : ""}
          </g>`;
      })
      .join("");

    // Everything not already pinned above, auto-laid-out in grids below the
    // curated layout - this is what guarantees nothing is ever "missing"
    // from the map. Leftover add-ons first, then *every* config entry, so
    // each integration has a real node the entity finder can point at
    // instead of reporting it as unmodeled.
    const pinnedSlugs = new Set(this._derived.nodes.filter((n) => n.kind === "addon").map((n) => n.slug));
    let otherAddons = this._addons.filter((a) => !pinnedSlugs.has(a.slug));
    if (this._hideInactive) otherAddons = otherAddons.filter((a) => !isInactiveStatus(addonStatus(a)));
    const addonItems = [...otherAddons]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((a) => ({ kind: "addon", key: a.slug, label: a.name, color: colorFor(addonStatus(a)) }));

    const pinnedDomains = new Set(this._derived.nodes.filter((n) => n.kind === "integration").map((n) => n.domain));
    let otherEntries = this._entries.filter((e) => !pinnedDomains.has(e.domain));
    if (this._hideInactive) otherEntries = otherEntries.filter((e) => !isInactiveStatus(entryStatus(e)));
    otherEntries = [...otherEntries].sort((a, b) => (a.domain || "").localeCompare(b.domain || ""));
    // The domain alone is the more identifying label on a small circle, so
    // that's the default; two entries of the same domain (two MQTT brokers,
    // two cameras) would draw as identical circles though, so those - and
    // only those - get their title appended to tell them apart.
    // One circle per integration, not per config entry. An integration that
    // makes an entry per device or per helper - a local Tuya bridge, utility
    // meters, switch-as-x - drew a row of identical circles that said nothing
    // the single node doesn't. The entries themselves stay in the list below
    // and in this node's detail panel, so nothing becomes unreachable.
    const byDomain = new Map();
    for (const e of otherEntries) {
      const group = byDomain.get(e.domain) || { entries: [], domain: e.domain };
      group.entries.push(e);
      byDomain.set(e.domain, group);
    }
    const entryItems = [...byDomain.values()].map((group) => ({
      kind: "domain",
      key: group.domain,
      label: group.entries.length > 1 ? `${group.domain} (${group.entries.length})` : group.domain,
      // The worst state among them: one dead entry out of five is a fact the
      // merged node must not swallow.
      color: colorFor(worstStatus(group.entries.map(entryStatus))),
    }));

    // Each section is stacked a fixed gap below the previous one's real
    // bottom edge - the same gap that separates the tiers above - rather
    // than by summing paddings, which is how a dead band of 150 empty units
    // opened up between the last tier and the first grid.
    const gridTop = (this._layoutBottom || GRID_START_Y) + TIER_BOX_GAP;
    const grids = [];
    let cursor = gridTop;
    let lastBottom = this._layoutBottom || GRID_START_Y;
    const addGrid = (items, geom, color, label, dataAttr) => {
      const section = this._gridSection({ items, boxTop: cursor, geom, color, label, dataAttr, dimming, lit });
      if (!section.svg) return;
      lastBottom = section.bottom;
      cursor = section.bottom + TIER_BOX_GAP;
      grids.push(section.svg);
    };

    if (this._config.show_addon_grid) {
      addGrid(addonItems, OTHER_GRID, OTHER_GRID_COLOR, "Other add-ons & tools", "data-node-addon");
    }
    if (this._config.show_integration_grid) {
      if (this._config.group_by_area) {
        // One labelled grid per area, so the map answers "what serves the
        // kitchen" as directly as it answers "what serves MQTT". An
        // integration is filed under the area holding most of its devices,
        // never in two places at once.
        for (const [areaName, items] of this._groupByArea(entryItems)) {
          addGrid(items, ENTRY_GRID, ENTRY_GRID_COLOR, `Integrations - ${areaName}`, "data-node-domain");
        }
      } else {
        addGrid(entryItems, ENTRY_GRID, ENTRY_GRID_COLOR, "Integrations", "data-node-domain");
      }
    }
    const gridsSvg = grids.join("");
    const totalHeight = lastBottom + GRID_PAD;

    const natural = { x: 0, y: 0, w: this._geo().width, h: totalHeight };
    this._naturalViewBox = natural;
    // Re-fit whenever the map's own size changes, unless the user has moved
    // the view themselves. The first render happens before any data arrives,
    // so the map it fits is a fraction of the final one - and the view was
    // only ever set once, leaving everything that loaded afterwards below
    // the bottom edge with the sides empty. That is what "the map is tiny
    // and cut off" was.
    const grew = !this._viewBox || this._fittedTo !== `${natural.w}x${natural.h}`;
    if (grew && !this._viewMoved) {
      this._viewBox = this._fitViewBox(natural);
      this._fittedTo = `${natural.w}x${natural.h}`;
    } else if (!this._viewBox) {
      this._viewBox = this._fitViewBox(natural);
    }

    this.querySelector(".smc-graph").innerHTML = `
      <svg viewBox="${this._viewBox.x} ${this._viewBox.y} ${this._viewBox.w} ${this._viewBox.h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="smc-node-clip" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
          <clipPath id="smc-icon-clip" clipPathUnits="objectBoundingBox">
            <rect x="0" y="0" width="1" height="1" rx="0.24" ry="0.24" />
          </clipPath>
        </defs>
        ${boxesSvg}
        ${tierLabelsSvg}
        ${edgesSvg}
        ${labelsSvg}
        ${nodesSvg}
        ${gridsSvg}
      </svg>`;
  }

  // Files each integration under the area that holds most of its devices,
  // with everything unplaced last. Returns [areaName, items] pairs in a
  // stable order so the map doesn't reshuffle between refreshes.
  _groupByArea(items) {
    const areaName = new Map(this._areas.map((a) => [a.area_id, a.name || a.area_id]));
    const groups = new Map();
    for (const item of items) {
      const counts = this._counts.get(`${item.kind}:${item.key}`);
      const best = counts?.areas?.size
        ? [...counts.areas.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]
        : null;
      const name = best ? areaName.get(best) || best : "No area";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
    return [...groups.entries()].sort(([a], [b]) =>
      a === "No area" ? 1 : b === "No area" ? -1 : a.localeCompare(b)
    );
  }

  // Edge labels start at their edge's midpoint and are nudged vertically
  // until they stop overlapping each other or a node. Several edges
  // converging on one node otherwise stack their labels in the same few
  // pixels: around the host, "serves (moredisks)", "admin access" and "NAS1
  // (SMB loop)" all landed on top of each other and on the host's own name.
  // Greedy and deterministic - good enough for a few dozen labels, and it
  // never reorders them, so the map doesn't reshuffle between renders.
  _placeEdgeLabels(labels, nodes, extraObstacles = []) {
    const LINE_H = 13;
    const CHAR_W = 5.2; // 10px font, averaged - only needs to be close
    // Boxes that merely touch look like one long label ("admin access serves
    // (moredisks)"), so each claims a little more room than it draws.
    const PAD_X = 7;
    // Seed with the nodes themselves so a label is never written across a
    // circle or the name underneath it.
    // Cards carry their own text, so their own box is the whole obstacle.
    const taken = nodes
      .map((n) => {
        const { w, h } = cardSize(n);
        return { x0: n.x - w / 2, x1: n.x + w / 2, y0: n.y - h / 2, y1: n.y + h / 2 };
      })
      .concat(extraObstacles);
    // How much of `box` is buried under things already placed. Zero means a
    // free slot; otherwise it ranks the candidates so a crowded label can
    // still take the least-bad position rather than staying where it was.
    const buried = (box) =>
      taken.reduce((sum, t) => {
        const w = Math.min(box.x1, t.x1) - Math.max(box.x0, t.x0);
        const h = Math.min(box.y1, t.y1) - Math.max(box.y0, t.y0);
        return sum + (w > 0 && h > 0 ? w * h : 0);
      }, 0);

    for (const label of labels) {
      const halfW = (label.text.length * CHAR_W) / 2 + PAD_X;
      let best = null;
      for (let attempt = 0; attempt < 16; attempt++) {
        // Alternate above and below the midpoint, further out each pair, so
        // a label ends up as close to its own edge as it can get.
        const step = Math.ceil(attempt / 2) * LINE_H * (attempt % 2 ? 1 : -1);
        const y = label.y + step;
        const box = { x0: label.x - halfW, x1: label.x + halfW, y0: y - LINE_H / 2, y1: y + LINE_H / 2 };
        const cost = buried(box);
        if (!best || cost < best.cost) best = { y, box, cost };
        if (cost === 0) break;
      }
      label.y = best.y;
      taken.push(best.box);
    }
    return labels;
  }

  // One auto-laid-out grid section: a bounding box, a label, and a circle
  // per item. Shared by the leftover-add-ons and the integrations grids so
  // both get identical highlight/dim behaviour and neither can drift.
  // Returns its own rendered height so the next section can stack under it.
  // One labelled box of chips: a rounded pill per item, sized to its own
  // label. These were fixed-radius circles with the text written inside and
  // truncated to fit, which meant "systemmonitor" spilled over its own edge
  // and "utility_meter (3)" was cut to "utility_meter ...". A chip that grows
  // to its text has neither problem, and the varying widths make the grid
  // easier to scan than a wall of identical discs.
  //
  // Returns the bottom edge of its box so the caller can stack the next one
  // a fixed gap below, rather than reasoning about padding.
  _gridSection({ items, boxTop, geom, color, label, dataAttr, dimming, lit }) {
    if (!items.length) return { svg: "", bottom: boxTop };
    const { marginX, rowH } = geom;
    const width = this._geo().width;
    const right = width - marginX;

    // Flow left to right, wrapping at the canvas edge.
    const placed = [];
    let x = marginX;
    let y = boxTop + GRID_PAD + CHIP_H / 2;
    for (const item of items) {
      const w = chipWidth(item.label);
      if (x > marginX && x + w > right) {
        x = marginX;
        y += rowH;
      }
      placed.push({ item, x, y, w });
      x += w + CHIP_GAP;
    }

    const maxX = Math.min(right, Math.max(...placed.map((c) => c.x + c.w)));
    const minY = boxTop;
    const maxY = Math.max(...placed.map((c) => c.y)) + CHIP_H / 2 + GRID_PAD;

    const boxSvg =
      `<rect class="smc-tier-box" x="${marginX - GRID_PAD}" y="${minY}" width="${maxX - marginX + 2 * GRID_PAD}" height="${maxY - minY}" rx="14" style="fill:${color};fill-opacity:0.08;stroke:${color};stroke-opacity:0.5;" />` +
      `<text class="smc-tier-label" x="${marginX - GRID_PAD + 4}" y="${minY - 8}" style="fill:${color}">${escapeHtml(label)}</text>`;

    const nodesSvg = placed
      .map(({ item, x: cx, y: cy, w }) => {
        const key = `${item.kind}:${item.key}`;
        // Recorded by centre, like every other node, so panning to a
        // highlight and the "is it drawn" check need no special case.
        this._nodePositions.set(key, { x: cx + w / 2, y: cy, w, h: CHIP_H, r: CHIP_H / 2 });
        const isHi = !!lit?.has(key);
        const problem = this._problemFor(key);
        const cls =
          "smc-node smc-chip-node" + (problem ? " smc-problem" : "") + (dimming ? (isHi ? " smc-hi" : " smc-dim") : "");
        return `
          <g class="${cls}" ${dataAttr}="${escapeHtml(item.key)}" tabindex="0" role="button" aria-label="${escapeHtml(item.label + (problem ? `, ${problem.reason}` : ""))}"><title>${escapeHtml(item.label + (problem ? ` - ${problem.reason}` : ""))}</title>
            <rect class="smc-chip-bg" x="${cx}" y="${cy - CHIP_H / 2}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" />
            <circle class="smc-chip-dot" cx="${cx + 13}" cy="${cy}" r="5" fill="${item.color}" />
            <text class="smc-chip-text" x="${cx + 24}" y="${cy + 4}">${escapeHtml(item.label)}</text>
          </g>`;
      })
      .join("");

    return { svg: boxSvg + nodesSvg, bottom: maxY };
  }

  _renderChipList(kind) {
    // Integrations are drawn as graph nodes too (the auto-grid), but this
    // list stays: it's the only place their full `domain: title` text is
    // readable, where a 22px circle can only fit a truncated domain. Both
    // views highlight together, so a finder result is legible either way.
    const wrap = this.querySelector(`[data-list="${kind}"]`);
    const countEl = this.querySelector(`[data-count="${kind}"]`);
    if (!wrap || !countEl) return; // list switched off in the config
    const all = [...this._entries].sort((a, b) => (a.domain || "").localeCompare(b.domain || ""));
    const shown = this._hideInactive ? all.filter((e) => !isInactiveStatus(entryStatus(e))) : all;
    countEl.textContent = shown.length === all.length ? `(${all.length})` : `(${shown.length} of ${all.length})`;
    const lit = this._litSet();
    const dimming = !!lit?.size;
    wrap.innerHTML = shown
      .map((e) => {
        const status = entryStatus(e);
        const label = e.title ? `${e.domain}: ${e.title}` : e.domain;
        const isHi = !!lit?.has(`entry:${e.entry_id}`);
        const cls = "smc-chip" + (dimming ? (isHi ? " smc-hi" : " smc-dim") : "");
        return `<span class="${cls}" data-chip="${escapeHtml(e.entry_id)}" data-chip-kind="entry" tabindex="0" role="button">
          <span class="smc-dot" style="background:${colorFor(status)}"></span>${escapeHtml(label)}
        </span>`;
      })
      .join("");

    // Scroll the highlighted chip into the middle of its own scroll box.
    // Deliberately not scrollIntoView(): that walks every scrollable
    // ancestor and would yank the whole dashboard around. Both elements
    // share an offsetParent, so the offsetTop difference is the offset
    // within this list.
    const hiChip = wrap.querySelector(".smc-chip.smc-hi");
    if (hiChip) {
      wrap.scrollTop = Math.max(0, hiChip.offsetTop - wrap.offsetTop - wrap.clientHeight / 2 + hiChip.offsetHeight / 2);
    }
  }

  // Runs on every hass update (i.e. very often), so it only rewrites the
  // stat strip - never the graph. Stats with no live state are skipped
  // rather than shown as a permanent "unavailable"; see HOST_STATS.
  _renderHostStats() {
    const el = this.querySelector(".smc-stats");
    if (!el || !this._hass) return;
    const tiles = this._hostStats()
      .map((stat) => {
        const st = stat.entity ? this._hass.states[stat.entity] : null;
        if (!st || st.state === "unavailable" || st.state === "unknown") return "";
        const unit = stat.suffix ?? st.attributes?.unit_of_measurement ?? "";
        const points = this._config.show_sparklines ? this._history[stat.key] : null;
        const spark = points
          ? `<svg viewBox="0 0 100 22" preserveAspectRatio="none"><path d="${sparklinePath(points, 100, 22)}" /></svg>`
          : "";
        return `<div class="smc-stat">
          <div class="smc-stat-label">${escapeHtml(stat.label)}</div>
          <div class="smc-stat-value">${escapeHtml(st.state)}${escapeHtml(unit)}</div>
          ${spark}
        </div>`;
      })
      .filter(Boolean);
    el.hidden = !tiles.length;
    el.innerHTML = tiles.join("");
  }

  // --- detail panel -------------------------------------------------------

  async _openDetail(kind, key) {
    this._detailKey = `${kind}:${key}`;
    // Selecting a node also focuses it on the map: what a node connects to
    // is the question the diagram exists to answer, and reading it off a
    // thicket of identical grey lines is exactly the part that doesn't work.
    const focus = `${kind}:${key}`;
    if (focus !== this._focus) {
      this._focus = focus;
      this._renderHighlightables();
    }
    // Opening a panel is the one moment its add-on's info and stats are
    // worth re-reading, so drop the cached copies for whichever add-on this
    // is - see the note in _refreshData about why they otherwise persist.
    const slug = kind === "addon" ? key : this._node(key)?.slug;
    if (slug) {
      this._addonInfoCache.delete(slug);
      this._addonStatsCache.delete(slug);
    }
    await this._renderDetail();
  }

  _closeDetail() {
    this._detailKey = null;
    this.querySelector(".smc-detail").hidden = true;
    this._clearFocus();
  }

  _clearFocus() {
    if (!this._focus) return;
    this._focus = null;
    this._renderHighlightables();
  }

  // The node under focus and everything one hop from it. Neighbours stay lit
  // rather than dimmed: "connected to what" is unanswerable if the far end
  // of every highlighted edge is greyed out.
  // What is currently singled out, whichever way it got that way. The
  // finder's answer wins when both are live: it is the more specific claim.
  _litSet() {
    return this._highlight?.size ? this._highlight : this._focusSet();
  }

  // The selected node, but only while it is the thing being shown. When the
  // finder is answering, its result owns the map - lighting the selection's
  // edges on top of it would put two unrelated claims on screen at once.
  _focusNodeId() {
    if (this._highlight?.size) return null;
    return this._focus?.startsWith("node:") ? this._focus.slice(5) : null;
  }

  _focusSet() {
    if (!this._focus) return null;
    const keys = new Set([this._focus]);
    // A config entry is not drawn on the map any more - its integration is.
    // Selecting one from the list below would otherwise dim the whole map
    // and light nothing, since the key it focuses matches no drawn node.
    if (this._focus.startsWith("entry:")) {
      const entry = this._entries.find((e) => e.entry_id === this._focus.slice(6));
      if (entry) keys.add(`domain:${entry.domain}`);
    }
    const id = this._focus.startsWith("node:") ? this._focus.slice(5) : null;
    if (id) {
      for (const [from, to] of this._edges()) {
        if (from === id) keys.add(`node:${to}`);
        else if (to === id) keys.add(`node:${from}`);
      }
    }
    return keys;
  }

  async _fetchAddonInfo(slug) {
    if (this._addonInfoCache.has(slug)) return this._addonInfoCache.get(slug);
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: "supervisor/api",
        endpoint: `/addons/${slug}/info`,
        method: "get",
      });
      const info = res?.data ?? res;
      this._addonInfoCache.set(slug, info);
      return info;
    } catch (e) {
      return { _error: describeError(e) };
    }
  }

  async _fetchAddonStats(slug) {
    if (this._addonStatsCache.has(slug)) return this._addonStatsCache.get(slug);
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: "supervisor/api",
        endpoint: `/addons/${slug}/stats`,
        method: "get",
      });
      const stats = res?.data ?? res;
      this._addonStatsCache.set(slug, stats);
      return stats;
    } catch (e) {
      return { _error: describeError(e) };
    }
  }

  // Never cached: a log tail that doesn't change when you reopen it is
  // worse than no log at all. Trimmed to the last lines - the endpoint can
  // return a lot, and this is a glance, not a log viewer.
  // `lines` trims the tail for *display* only. Pass 0 to get the whole log:
  // the facts worth deriving are logged once at startup - a tunnel's ingress
  // rules, the services an add-on connects to - so a tail loses them on
  // anything that has been running a while and chattering since. Reading
  // routes out of the last 400 lines is exactly why the public URLs
  // disappeared after the map became derived.
  // Add-on logs come back as plain text, and the WebSocket `supervisor/api`
  // proxy only speaks JSON - so every log read through it failed, and had
  // been failing all along. Fetched over REST instead, with the URL signed
  // first exactly as the icons are, which is the route Home Assistant's own
  // frontend takes for the same endpoint.
  //
  // Failure returns null and is recorded. The old code returned the error
  // message *as the log*, so a failed read looked like a successful one of
  // about sixty bytes: the evidence panel reported "log read (60 bytes)",
  // the route parser found no rules in it, and the actual fault - that no
  // log had ever been read - was invisible.
  async _fetchAddonLog(slug, lines = 25) {
    const endpoint = `/api/hassio/addons/${slug}/logs`;
    let text = null;
    try {
      const signed = await this._hass.connection.sendMessagePromise({
        type: "auth/sign_path",
        path: endpoint,
        expires: 60,
      });
      if (!signed?.path) throw new Error("the log URL could not be signed");
      const res = await fetch(signed.path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
      this._logErrors.delete(slug);
    } catch (e) {
      // Older cores, or a setup where signing is unavailable: the WebSocket
      // proxy still works for the add-ons whose logs it can represent.
      try {
        const res = await this._hass.connection.sendMessagePromise({
          type: "supervisor/api",
          endpoint: `/addons/${slug}/logs`,
          method: "get",
        });
        text = typeof res === "string" ? res : res?.data ?? null;
        this._logErrors.delete(slug);
      } catch (inner) {
        this._logErrors.set(slug, describeError(e));
        return null;
      }
    }
    if (typeof text !== "string" || !text.trim()) {
      this._logErrors.set(slug, "the log was empty");
      return null;
    }
    const trimmed = text.trim();
    return lines > 0 ? trimmed.split("\n").slice(-lines).join("\n") : trimmed;
  }

  // rows: array of [label, value] or [label, htmlValue, true] where the
  // third element means "value is already-safe HTML, don't escape it" -
  // used only for the exposedUrl link below, never for API-sourced text.
  _addonInfoRows(info, n) {
    if (info._error) return [["Error", info._error]];
    const rows = [
      ["State", info.state],
      ["Version", info.version],
      ["Update available", info.update_available ? "yes" : "no"],
      ["Host network", info.host_network ? "yes (shares host IP)" : `no (${info.ip_address || "bridge"})`],
      ["Internal port", formatNetwork(info.network)],
      ["Description", info.description],
    ];
    if (n?.exposedUrl) {
      rows.push(["Public URL", `<a href="${escapeHtml(n.exposedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.exposedUrl)}</a>`, true]);
    }
    return rows;
  }

  async _renderDetail() {
    const el = this.querySelector(".smc-detail");
    if (!this._detailKey) {
      el.hidden = true;
      return;
    }
    const [kind, key] = this._detailKey.split(/:(.+)/);
    let title = "";
    let role = "";
    let rows = [];
    let sections = "";

    if (kind === "node") {
      const n = this._node(key);
      if (!n) return this._closeDetail();
      title = n.label;
      role = (n.notes || []).join(". ");
      if (n.kind === "host") {
        // Skip rather than show "unavailable" for any stat whose entity
        // has no live state right now (e.g. disabled by the integration) -
        // see the comment on HOST_STATS above for why that's expected for
        // some System Monitor resources on this instance.
        rows = this._hostStats()
          .map((s) => {
            const st = s.entity ? this._hass.states[s.entity] : null;
            return st ? [s.label, `${st.state}${s.suffix ?? ""}`] : null;
          })
          .filter(Boolean);
        if (n.exposedUrl) {
          rows.push(["Public URL", `<a href="${escapeHtml(n.exposedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.exposedUrl)}</a>`, true]);
        }
        rows.push(["Hostname", this._system.host?.hostname]);
        rows.push(["Board", this._system.os?.board]);
        rows.push(["Machine", this._system.core?.machine || this._system.core?.arch]);
        rows.push(["Kernel", this._system.host?.kernel]);
        rows.push(["Operating system", this._system.host?.operating_system]);
      } else if (n.kind === "hardware") {
        // Discovered, so the detail is the device's own data rather than a
        // hand-written description - plus whichever add-on's options were
        // found pointing at it, which is what drew its ownership edge.
        rows = Object.entries(n.detail || {}).map(([k, v]) => [k, v]);
        const direct = (n.usedBy || []).filter((u) => !u.via);
        const downstream = (n.usedBy || []).filter((u) => u.via);
        rows.push([
          "Claimed by",
          direct.length ? direct.map((u) => `${u.name} (${u.option})`).join(", ") : "no add-on's options reference this device",
        ]);
        if (downstream.length) {
          rows.push([
            "Reached over SMB",
            downstream.map((u) => `${u.name} (via ${u.via}'s ${u.share} share)`).join(", "),
          ]);
        }
      } else if (n.kind === "addon") {
        const info = await this._fetchAddonInfo(n.slug);
        rows = this._addonInfoRows(info, n);
        if (n.routes?.length) {
          sections += `<div class="smc-detail-section"><h4>Published hostnames (${n.routes.length})</h4><dl>${n.routes
            .map(
              (r) =>
                `<dt><a href="https://${escapeHtml(r.hostname)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.hostname)}</a></dt>` +
                `<dd>${escapeHtml(r.service)} → ${escapeHtml(
                  this._derived.nodes.find((x) => x.id === r.targetId)?.label || "not matched to an add-on"
                )}</dd>`
            )
            .join("")}</dl></div>`;
        }
        sections += await this._addonExtras(n.slug);
      } else if (n.kind === "integration") {
        const entry = this._findEntry(n.domain);
        if (!entry) rows = [["Status", "not configured"]];
        else
          rows = [
            ["Title", entry.title],
            ["State", entry.state],
            ["Source", entry.source],
            ["Disabled by", entry.disabled_by || "-"],
          ];
      }
    } else if (kind === "addon") {
      const addon = this._findAddon(key);
      title = addon?.name || key;
      const hub = this._derived.nodes.find((n) => n.kind === "addon" && n.slug === key);
      if (hub) role = (hub.notes || []).join(". ");
      const info = await this._fetchAddonInfo(key);
      rows = this._addonInfoRows(info, hub);
      sections += await this._addonExtras(key);
    } else if (kind === "status") {
      const item = this._statusByKey?.get(key);
      if (!item) return this._closeDetail();
      title = item.label;
      rows = [["Value", item.value]];
      if (item.note) rows.push(["Detail", item.note]);
      if (key === "updates") rows = this._pendingUpdates().map((u, i) => [i === 0 ? "Pending" : "", u]);
      if (key === "repairs") {
        rows = this._issues
          .filter((i) => !i.ignored)
          .map((i) => [i.domain, [i.issue_id, i.severity, i.is_fixable ? "fixable" : ""].filter(Boolean).join(" - ")]);
      }
      if (key === "backup") {
        rows = (this._system.backups || [])
          .slice()
          .sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0))
          .slice(0, 8)
          .map((b) => [b.name || b.slug, `${new Date(parseDate(b.date)).toLocaleString()} - ${formatBytes((b.size || 0) * 1024 * 1024) || ""}`]);
      }
      if (key === "exposed") {
        rows = (this._routes || []).map((r) => [
          r.hostname,
          `→ ${escapeHtml(this._derived.nodes.find((n) => n.id === r.targetId)?.label || "unresolved")} (${escapeHtml(r.service)})`,
        ]);
      }
      if (key === "internet") {
        rows = (this._system.network?.interfaces || []).map((i) => [
          i.interface,
          [i.type, i.connected ? "connected" : "down", i.primary ? "primary" : "", (i.ipv4?.address || []).join(", ")].filter(Boolean).join(" - "),
        ]);
      }
    } else if (kind === "entry") {
      const entry = this._entries.find((e) => e.entry_id === key);
      if (!entry) return this._closeDetail();
      title = entry.title || entry.domain;
      const hub = this._derived.nodes.find((n) => n.kind === "integration" && n.domain === entry.domain);
      if (hub) role = (hub.notes || []).join(". ");
      rows = [
        ["Domain", entry.domain],
        ["State", entry.state],
        ["Source", entry.source],
        ["Disabled by", entry.disabled_by || "-"],
      ];
    } else if (kind === "domain") {
      // One integration, however many config entries it made. This panel is
      // where those entries stay visible - merging them on the map is only
      // defensible if the individual ones are still one click away.
      const entries = this._entries.filter((e) => e.domain === key);
      if (!entries.length) return this._closeDetail();
      const hub = this._derived.nodes.find((n) => n.kind === "integration" && n.domain === key);
      title = entries.length > 1 ? `${key} (${entries.length} entries)` : entries[0].title || key;
      if (hub) role = (hub.notes || []).join(". ");
      rows = [["Domain", key], ["Entries", String(entries.length)]];
      if (entries.length > 1) {
        sections += `<div class="smc-detail-section"><h4>Config entries</h4><dl>${entries
          .map(
            (e) =>
              `<dt>${escapeHtml(e.title || e.entry_id)}</dt><dd>${escapeHtml(
                [entryStatus(e), e.source, e.disabled_by ? `disabled by ${e.disabled_by}` : ""].filter(Boolean).join(" - ")
              )}</dd>`
          )
          .join("")}</dl></div>`;
      } else {
        rows.push(["State", entries[0].state], ["Source", entries[0].source]);
      }
    }

    // Which box this node ended up in and on what evidence. Appended after
    // the branches rather than inside them: several of them replace `rows`
    // wholesale, so anything pushed earlier is thrown away. A claim about
    // what an add-on *is* should be answerable by clicking it, not only from
    // the evidence panel at the foot of the card.
    const shown = kind === "node" ? this._node(key) : null;
    if (shown?.category)
      rows.push([
        "Kind",
        `${SERVICE_CATEGORIES[shown.category] || shown.category}${shown.categoryWhy ? ` - ${shown.categoryWhy}` : ""}`,
      ]);

    // Problem / health / area detail applies to whichever node this is, so
    // it's appended once here rather than in each branch above.
    sections += this._contextSections(this._detailKey);

    el.hidden = false;
    el.innerHTML = `
      <span class="smc-detail-close">&#10005;</span>
      <strong>${escapeHtml(title)}</strong>
      ${role ? `<p class="smc-role">${escapeHtml(role)}</p>` : ""}
      <dl>
        ${rows
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v, raw]) => `<dt>${escapeHtml(k)}</dt><dd>${raw ? v : escapeHtml(v)}</dd>`)
          .join("")}
      </dl>
      ${sections}`;
  }

  // Live resource use and (optionally) a log tail for one add-on. Both are
  // fetched on open rather than on load - /stats is per-container and a card
  // that polled it for thirty add-ons would be its own performance problem.
  async _addonExtras(slug) {
    let html = "";
    if (this._config.show_addon_stats) {
      const stats = await this._fetchAddonStats(slug);
      if (stats && !stats._error) {
        const rows = [
          ["CPU", stats.cpu_percent != null ? `${Number(stats.cpu_percent).toFixed(1)}%` : null],
          ["Memory", stats.memory_percent != null ? `${Number(stats.memory_percent).toFixed(1)}% (${formatBytes(stats.memory_usage)} of ${formatBytes(stats.memory_limit)})` : null],
          ["Network", `${formatBytes(stats.network_rx)} in / ${formatBytes(stats.network_tx)} out`],
          ["Disk", `${formatBytes(stats.blk_read)} read / ${formatBytes(stats.blk_write)} written`],
        ].filter(([, v]) => v);
        if (rows.length) {
          html += `<div class="smc-detail-section"><h4>Resource use</h4><dl>${rows
            .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
            .join("")}</dl></div>`;
        }
      }
    }
    if (this._config.show_addon_logs) {
      const log = await this._fetchAddonLog(slug);
      if (log) html += `<div class="smc-detail-section"><h4>Recent log</h4><pre class="smc-log">${escapeHtml(log)}</pre></div>`;
    }
    return html;
  }

  // Anything the joins know about this node that its own API doesn't:
  // unavailable entities, open repair issues, System Health's own report,
  // and which areas its devices live in.
  _contextSections(detailKey) {
    let html = "";
    const rec = this._problems.get(detailKey);
    const counts = this._counts.get(detailKey);

    if (rec?.unavailable) {
      const dead = this._entityRegistry
        .filter((reg) => {
          if (reg.disabled_by || !this._targetKeys(reg).includes(detailKey)) return false;
          const st = this._hass?.states?.[reg.entity_id];
          return !st || st.state === "unavailable" || st.state === "unknown";
        })
        .slice(0, 15)
        .map((reg) => reg.entity_id);
      html += `<div class="smc-detail-section"><h4>Unavailable entities (${rec.unavailable} of ${rec.entities})</h4><dl>${dead
        .map((id) => `<dt></dt><dd>${escapeHtml(id)}</dd>`)
        .join("")}</dl></div>`;
    }
    if (rec?.issues?.length) {
      html += `<div class="smc-detail-section"><h4>Repair issues</h4><dl>${rec.issues
        .map((i) => `<dt>${escapeHtml(i.severity || "issue")}</dt><dd>${escapeHtml(i.issue_id || i.translation_key || "")}</dd>`)
        .join("")}</dl></div>`;
    }
    if (rec?.health && typeof rec.health === "object") {
      const rows = Object.entries(rec.health)
        .map(([k, v]) => [k.replace(/_/g, " "), typeof v === "object" ? v?.value ?? v?.type ?? JSON.stringify(v) : v])
        .filter(([, v]) => v !== undefined && v !== null && v !== "");
      if (rows.length) {
        html += `<div class="smc-detail-section"><h4>System health</h4><dl>${rows
          .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
          .join("")}</dl></div>`;
      }
    }
    if (counts?.areas?.size) {
      const names = [...counts.areas.keys()].map((id) => this._areas.find((a) => a.area_id === id)?.name || id);
      html += `<div class="smc-detail-section"><h4>Areas</h4><dl><dt>${counts.devices.size} devices in</dt><dd>${escapeHtml(names.join(", "))}</dd></dl></div>`;
    }
    return html;
  }
}

// The visual editor. Deliberately a thin wrapper over <ha-form>: HA already
// owns the selectors, the theming and the entity pickers, so the whole editor
// is a schema (EDITOR_SCHEMA) plus the two callbacks ha-form needs. Nothing
// here duplicates the card's own defaulting - the form emits only the keys
// the user actually touched, and setConfig fills the rest in.
class SystemMapCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: { type: "custom:system-map-card", ...ev.detail.value } },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
  }
}

customElements.define("system-map-card", SystemMapCard);
customElements.define("system-map-card-editor", SystemMapCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "system-map-card",
  name: "System Map",
  description:
    "Live topology and health map: discovered hardware, the add-ons that own it, network and remote-access entry points, every integration, and an entity finder that says which node serves what.",
  preview: true,
  documentationURL: "https://github.com/nict41/HACS-system-map",
});
