// Lovelace custom card: full topology map of this Home Assistant server -
// physical hardware at top, which add-on owns each piece of hardware and
// why, LAN-wide network infrastructure, remote-access entry/exit points in
// their own (colour-coded) section, confirmed externally-exposed services
// with both their internal port and public URL, every remaining add-on in
// an auto-generated grid (so nothing is ever missing), and an entity finder
// that highlights which node(s) serve a given entity - including tracing
// through "helper" entities like switch_as_x back to their real source.
// See the "HA server architecture" conversation this was built from for the
// full reasoning; short version below.
//
// Data sources (all live, no backend add-on required):
//   - WS `supervisor/api` {endpoint:"/addons", method:"get"} -> add-on list
//   - WS `supervisor/api` {endpoint:"/addons/<slug>/info", ...} -> full
//     per-add-on detail (state, version, network/ports), fetched lazily
//     only when a node/chip is clicked
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
// What this card deliberately does NOT try to compute live: the *edges*,
// *role* text, and *entity->node* mapping (HUB_EDGES / ROLES /
// PLATFORM_TO_NODES below) - all hand-written from reading add-on options,
// automation YAML, live add-on logs, external DNS/HTTPS probes, and the
// household's own account of their physical wiring. Two flagged
// uncertainties baked into the text rather than silently asserted:
//   - AdGuard: HA's own host network config and Supervisor's DNS fallback
//     are both explicitly set to 1.1.1.1/8.8.8.8, not AdGuard's address -
//     checked directly via `ha network info` / `ha dns info`, not assumed.
//   - Huawei-as-primary-uplink: stated by the household, not independently
//     verifiable from HA's data.
// Cloudflare Tunnel routes ARE independently confirmed (2026-09-02): grepped
// the add-on's own logs for ingress-rule origins, then probed DNS + HTTPS
// directly against each hostname - 4 routes confirmed this way:
// nicholastoo.com -> WordPress, ha. -> Home Assistant, share. -> Pingvin
// Share, nas. -> Immich (each response body checked, not just DNS/HTTP 200,
// to rule out a wildcard-DNS false positive).
//
// The entity finder is necessarily approximate: HA's entity registry records
// which *integration* (platform) created an entity, not which add-on. For
// platforms with an unambiguous single add-on (mqtt -> Zigbee2MQTT +
// Mosquitto, huawei_lte -> the Huawei node, etc.) that's a reliable
// mapping - see PLATFORM_TO_NODES. Helper integrations that wrap another
// entity (switch_as_x is the confirmed case here - its config entry stores
// `options.entity_id` pointing at the wrapped entity) are resolved through
// to that source entity first, generically, by following `options.entity_id`
// on the entity's owning config entry - not hardcoded to switch_as_x by
// name, so it should also work for any other integration following the same
// convention. Anything that doesn't resolve to a known platform reports
// "not modeled on this map" rather than guessing.
//
// Install: Settings -> Dashboards -> (three dots) -> Resources -> Add
// resource, URL `/local/system-map-card.js` (bump `?v=` on the URL after
// each edit - browsers cache JS modules aggressively). Then add a card with
// `type: custom:system-map-card`. To make it fill an entire dashboard, put
// it as the only card on a view with View type "Panel".

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

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
const HUB_LAYOUT = [
  // hardware
  { id: "usb_dongle", label: "USB: Sonoff Dongle", x: 280, y: 150, r: 36, kind: "hardware", tier: "hardware", icon: "usb-port" },
  { id: "host", label: "HA Server (N100)", x: 620, y: 150, r: 62, kind: "host", tier: "hardware", icon: "chip", exposedUrl: "https://ha.nicholastoo.com" },
  { id: "usb_hdd", label: "USB: External HDD", x: 960, y: 150, r: 36, kind: "hardware", tier: "hardware", icon: "harddisk" },

  // services using that hardware
  { id: "zigbee2mqtt", label: "Zigbee2MQTT", x: 280, y: 330, r: 46, kind: "addon", slug: "45df7312_zigbee2mqtt", deviceCountDomain: "mqtt", tier: "services", icon: "zigbee" },
  { id: "claude_code", label: "Claude Code", x: 620, y: 330, r: 42, kind: "addon", slug: "7b7df7b9_claudecode", tier: "services", icon: "robot" },
  { id: "samba", label: "Samba NAS-β", x: 960, y: 330, r: 46, kind: "addon", slug: "c9a35110_sambanas", tier: "services", icon: "folder-network" },
  { id: "zha", label: "ZHA", x: 120, y: 420, r: 24, kind: "integration", domain: "zha", deviceCountDomain: "zha", tier: "services", icon: "close-network-outline" },
  { id: "nas1_watcher", label: "NAS1 Watcher", x: 1150, y: 320, r: 26, kind: "addon", slug: "beb500c8_nas1_usb_watcher", tier: "services", icon: "pulse" },
  { id: "immich", label: "Immich", x: 900, y: 480, r: 40, kind: "addon", slug: "3b88f413_immich", tier: "services", icon: "image-multiple", exposedUrl: "https://nas.nicholastoo.com" },
  { id: "immich_ml", label: "Immich ML", x: 900, y: 585, r: 24, kind: "addon", slug: "beb500c8_immich_ml", tier: "services", icon: "brain" },
  { id: "kiwix", label: "Kiwix", x: 1060, y: 480, r: 36, kind: "addon", slug: "beb500c8_kiwix", tier: "services", icon: "book-open-page-variant" },

  // LAN-wide network infrastructure
  { id: "adguard", label: "AdGuard Home", x: 260, y: 740, r: 44, kind: "addon", slug: "a0d7b954_adguard", tier: "network", icon: "shield-check" },
  { id: "mosquitto", label: "Mosquitto (MQTT)", x: 460, y: 740, r: 44, kind: "addon", slug: "core_mosquitto", tier: "network", icon: "access-point-network" },
  { id: "asusrouter", label: "ASUS Router", x: 660, y: 740, r: 44, kind: "integration", domain: "asusrouter", tier: "network", icon: "router-wireless" },
  { id: "huawei", label: "Huawei LTE", x: 860, y: 740, r: 44, kind: "integration", domain: "huawei_lte", badge: "Internet source", tier: "network", icon: "antenna" },

  // remote access: entry & exit points, + what's exposed through them
  { id: "tailscale", label: "Tailscale", x: 380, y: 910, r: 44, kind: "addon", slug: "a0d7b954_tailscale", badge: "Remote entry", tier: "remote", icon: "vpn" },
  { id: "cloudflared", label: "Cloudflared", x: 700, y: 910, r: 44, kind: "addon", slug: "9074a9fa_cloudflared", badge: "Remote entry", tier: "remote", icon: "cloud-outline" },
  { id: "wordpress", label: "WordPress", x: 520, y: 1050, r: 34, kind: "addon", slug: "beb500c8_wordpress", tier: "remote", icon: "wordpress", exposedUrl: "https://nicholastoo.com" },
  { id: "pingvin", label: "Pingvin Share", x: 660, y: 1050, r: 34, kind: "addon", slug: "beb500c8_pingvin_share", tier: "remote", icon: "share-variant", exposedUrl: "https://share.nicholastoo.com" },
  // Note: Immich (nas.nicholastoo.com) is also exposed via Cloudflared, but
  // it already exists as a node in the "services" tier above - see
  // HUB_EDGES for the cloudflared->immich edge - so no second node here.
];

const TIER_ORDER = ["hardware", "services", "network", "remote"];
const TIER_META = {
  hardware: "Physical hardware",
  services: "Services using that hardware",
  network: "Network infrastructure (LAN)",
  remote: "Remote access / entry & exit points",
};
// Distinct hues per tier so the bounding boxes read as different sections
// at a glance, not just "same grey box repeated four times".
const TIER_COLORS = {
  hardware: "#42a5f5", // blue
  services: "#ab47bc", // purple
  network: "#26a69a", // teal
  remote: "#ffa726", // orange
};
const OTHER_GRID_COLOR = "#78909c"; // neutral - not a real "tier", just leftovers

// [from, to, {label?, dashed?}] - drawn under the node circles so trimming
// the line to the circle edge isn't needed, the circle just covers the end.
const HUB_EDGES = [
  ["host", "usb_dongle", { label: "USB" }],
  ["host", "usb_hdd", { label: "USB" }],
  ["usb_dongle", "zigbee2mqtt", { label: "owns" }],
  ["usb_hdd", "samba", { label: "owns" }],
  ["samba", "host", { dashed: true, label: "NAS1 (SMB loop)" }],
  ["zigbee2mqtt", "mosquitto", { label: "MQTT" }],
  ["zigbee2mqtt", "zha", { dashed: true, label: "ignored" }],
  ["usb_hdd", "immich", { dashed: true, label: "external library" }],
  ["immich", "immich_ml", { label: "ML sidecar" }],
  ["usb_hdd", "kiwix", { dashed: true, label: "reads NAS1" }],
  ["usb_hdd", "nas1_watcher", { label: "watches link" }],
  ["host", "claude_code", { label: "admin access" }],
  ["asusrouter", "adguard", { label: "DNS" }],
  ["asusrouter", "huawei", { dashed: true, label: "WAN uplink" }],
  ["cloudflared", "wordpress", { label: "nicholastoo.com" }],
  ["cloudflared", "pingvin", { label: "share.nicholastoo.com" }],
  ["cloudflared", "host", { dashed: true, label: "ha.nicholastoo.com" }],
  ["cloudflared", "immich", { dashed: true, label: "nas.nicholastoo.com" }],
];

// One-sentence-or-two "why" per hub node, shown at the top of its
// click-detail panel. Hand-written and hand-verified, same reasoning as
// HUB_EDGES above - including two flagged uncertainties, see file header.
const ROLES = {
  host: "The physical server itself - an Intel N100 mini-PC running Home Assistant OS. Every add-on and integration on this map runs on it as a Docker container.",
  usb_dongle: "Physically plugged into the host over USB. A Zigbee radio coordinator, owned exclusively by Zigbee2MQTT below - not by ZHA (see that node).",
  usb_hdd: "Physically plugged into the host over USB (LITEON, ~1.9TB, known flaky link). Owned exclusively by Samba NAS-β below, which shares it out on the LAN.",
  zigbee2mqtt: "Owns the Sonoff USB dongle and runs the Zigbee coordinator network, bridging Zigbee end devices (lights, sensors, blinds, plugs, etc.) to Home Assistant over MQTT.",
  claude_code: "Runs Claude (this AI assistant) inside Home Assistant. Has full read/write access to the /homeassistant config directory and the same Supervisor admin API this card itself uses - effectively admin-level access to everything on this map.",
  samba: "Owns the external USB HDD and shares it on the LAN as an SMB/CIFS share ('NAS1'). Home Assistant itself also mounts that same share back over the network - a loop - for other add-ons to read.",
  zha: "A dismissed Zigbee integration discovery for the same dongle - never actually set up, owns 0 devices. Not a real path; Zigbee2MQTT above is what actually runs the mesh.",
  nas1_watcher: "Polls the external HDD's raw USB port every 5s and publishes a binary_sensor over MQTT when the physical USB link itself drops or recovers - lower-level than the Samba share; it watches the electrical connection, not the network mount.",
  immich: "Self-hosted photo/video library. Primary storage is internal, plus the external USB HDD (NAS1) is connected in as an External Library inside Immich's own settings. Also exposed to the internet via Cloudflare Tunnel.",
  immich_ml: "GPU-accelerated (Intel iGPU, OpenVINO) machine-learning sidecar for Immich - offloads face detection and smart search from Immich's main process.",
  kiwix: "Offline Wikipedia/ZIM archive server - reads its article archives straight off the external USB HDD (NAS1).",
  adguard: "Serves DNS for the LAN - the ASUS router hands this add-on's IP out via DHCP to every device on the network, and it blocks ads/trackers via its own blocklist subscriptions. Flagged: HA's own network config and Supervisor's DNS fallback are both explicitly set to 1.1.1.1/8.8.8.8, not this add-on's address - so unlike other LAN devices, the HA server itself doesn't appear to route its own DNS through AdGuard. Worth checking if that's intentional.",
  mosquitto: "The MQTT message broker - the hub Zigbee2MQTT and Home Assistant Core both publish/subscribe through for every Zigbee device's state.",
  asusrouter: "Main LAN gateway and DHCP server (192.168.8.1) - hands out AdGuard as the DNS server to every device on the network.",
  huawei: "The primary internet connection into this whole network (4G/5G uplink) - per the household's own wiring, the ASUS router's WAN side plugs into this rather than a fixed line. Also used for SMS. Flagged: HA's data can't independently confirm physical WAN cabling, so this is stated, not measured.",
  tailscale: "A remote entry point into this network: a VPN mesh (tailnet), configured as a subnet router + exit node + app connector, so it extends this entire LAN to your authorized Tailscale devices anywhere, and can route their internet traffic back out through this connection too.",
  cloudflared: "A remote entry point into this network: Cloudflare Tunnel, exposing selected internal services to the public internet as subdomains under nicholastoo.com, with no ports opened on the router. Confirmed live routes (checked via add-on logs + DNS/HTTPS probe, response body verified for each): nicholastoo.com → WordPress, ha.nicholastoo.com → Home Assistant itself, share.nicholastoo.com → Pingvin Share, nas.nicholastoo.com → Immich.",
  wordpress: "Public site, exposed to the internet via Cloudflare Tunnel. Bundles its own internal database, separate from the standalone (stopped) MariaDB add-on.",
  pingvin: "Self-hosted WeTransfer-style file sharing, exposed to the internet via Cloudflare Tunnel.",
};

// Checked each of these against live state (not just registry presence -
// an entity can be registered but have no current state, e.g. if it's
// disabled). On this instance the System Monitor integration only has
// disk/config, memory, and processor resources actually enabled - load
// average and last-boot sensors exist in the registry but are
// disabled_by:"integration" with no live state, so they're left out here
// rather than shown as a permanent "unavailable". Disk usage's *live*
// entity_id also turned out to be unprefixed (`sensor.disk_use_percent_
// config`, not `sensor.system_monitor_disk_use_percent`) - same naming
// quirk as processor_use below.
const HOST_STATS = [
  { key: "cpu", label: "CPU", entity: "sensor.processor_use", suffix: "%" },
  { key: "ram", label: "RAM", entity: "sensor.system_monitor_memory_use_percent", suffix: "%" },
  { key: "disk", label: "Disk (/config)", entity: "sensor.disk_use_percent_config", suffix: "%" },
];

// Entity registry `platform` -> hub node id(s). Deliberately small and
// explicit - see file header on why this can't be inferred generically.
const PLATFORM_TO_NODES = {
  mqtt: ["zigbee2mqtt", "mosquitto"],
  zha: ["zha"],
  huawei_lte: ["huawei"],
  asusrouter: ["asusrouter"],
  systemmonitor: ["host"],
  hassio: ["host"],
};

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

// Grid layout for every add-on NOT already pinned in HUB_LAYOUT above -
// this is what keeps the map from ever "missing" something again as
// add-ons come and go, without hand-placing coordinates for each one.
const OTHER_GRID = { cols: 8, spacingX: 140, spacingY: 108, r: 30, marginX: 90, topPad: 55, bottomPad: 40 };

class SystemMapCard extends HTMLElement {
  setConfig(config) {
    this._config = { title: "System Map", ...config };
    this._built = false;
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
    this._viewBox = null; // current pan/zoom state, {x,y,w,h} in SVG user units
    this._naturalViewBox = null; // full-fit viewBox, recomputed each render
    this._highlight = null; // Set of node ids highlighted by the entity finder, or null
    try {
      this._hideInactive = localStorage.getItem("smc-hide-inactive") === "1";
    } catch (_) {
      this._hideInactive = false;
    }
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
    this.innerHTML = `
      <ha-card>
        <div class="smc-header">
          <span class="smc-title">${escapeHtml(this._config.title)}</span>
          <label class="smc-filter">
            <input type="checkbox" class="smc-hide-inactive" />
            Hide inactive
          </label>
          <button class="smc-refresh" title="Refresh">&#8635;</button>
        </div>
        <div class="smc-errors" hidden></div>
        <div class="smc-graph-wrap">
          <div class="smc-loading">Loading system map…</div>
          <div class="smc-graph"></div>
          <div class="smc-zoom-controls">
            <button class="smc-zoom-in" title="Zoom in">+</button>
            <button class="smc-zoom-out" title="Zoom out">&minus;</button>
            <button class="smc-zoom-reset" title="Reset view">&#10021;</button>
          </div>
        </div>
        <div class="smc-detail" hidden></div>
        <div class="smc-finder">
          <h3>Find an entity <span class="smc-hint">- highlights which node(s) serve it</span></h3>
          <div class="smc-entity-search">
            <input type="text" class="smc-entity-input" placeholder="e.g. switch.3d_printer_power" autocomplete="off" />
            <button class="smc-entity-clear" title="Clear" hidden>&#10005;</button>
          </div>
          <div class="smc-entity-suggestions" hidden></div>
          <div class="smc-entity-result"></div>
        </div>
        <div class="smc-lists">
          <div class="smc-col">
            <h3>Integrations <span class="smc-count" data-count="integrations"></span></h3>
            <div class="smc-chips" data-list="integrations"></div>
          </div>
        </div>
      </ha-card>
      <style>
        :host { display: block; height: 100%; }
        ha-card { padding: 12px 16px 16px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
        .smc-header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; flex: 0 0 auto; }
        .smc-title { font-size: 1.2em; font-weight: 500; color: var(--primary-text-color); flex: 1; }
        .smc-filter { display: flex; align-items: center; gap: 4px; font-size: 0.85em; color: var(--secondary-text-color); cursor: pointer; user-select: none; }
        .smc-refresh { background: none; border: none; font-size: 1.3em; cursor: pointer; color: var(--secondary-text-color); line-height: 1; padding: 4px 8px; }
        .smc-refresh:hover { color: var(--primary-text-color); }
        .smc-errors { background: var(--error-color, #db4437); color: white; border-radius: 6px; padding: 6px 10px; font-size: 0.85em; margin-bottom: 8px; flex: 0 0 auto; }
        .smc-graph-wrap { position: relative; flex: 1 1 auto; min-height: 380px; overflow: hidden; touch-action: none; border-radius: 8px; background: var(--secondary-background-color, #f7f7f7); }
        .smc-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--secondary-text-color); font-size: 0.95em; z-index: 1; background: var(--secondary-background-color, #f7f7f7); }
        .smc-loading[hidden] { display: none; }
        .smc-graph { position: absolute; inset: 0; }
        .smc-graph svg { width: 100%; height: 100%; display: block; cursor: grab; }
        .smc-zoom-controls { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column; gap: 4px; z-index: 2; }
        .smc-zoom-controls button { width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color); cursor: pointer; font-size: 1em; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .smc-zoom-controls button:hover { background: var(--secondary-background-color, #eee); }
        .smc-tier-box { stroke-width: 2; }
        .smc-tier-label { font-size: 12px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
        .smc-badge { fill: #ffca28; font-size: 10px; font-weight: 700; text-anchor: middle; letter-spacing: 0.3px; text-transform: uppercase; }
        .smc-node circle { stroke: var(--card-background-color, #fff); stroke-width: 3; cursor: pointer; transition: opacity 0.15s ease; }
        .smc-node text { fill: var(--primary-text-color); font-size: 12px; font-weight: 500; text-anchor: middle; pointer-events: none; }
        .smc-node .smc-sub { fill: var(--secondary-text-color); font-size: 10px; font-weight: 400; }
        .smc-node.smc-node-small text { font-size: 9px; fill: white; }
        .smc-node.smc-dim { opacity: 0.2; }
        .smc-node.smc-hi circle { stroke: #ffca28; stroke-width: 5; }
        .smc-edge { stroke: var(--divider-color, #999); stroke-width: 2; fill: none; transition: opacity 0.15s ease; }
        .smc-edge.dashed { stroke-dasharray: 5 4; opacity: 0.6; }
        .smc-edge.smc-dim { opacity: 0.08; }
        .smc-edge-label { fill: var(--secondary-text-color); font-size: 10px; text-anchor: middle; }
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
        .smc-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
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

    // Escape closes whichever overlay is open - cheap, low-risk addition.
    window.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      if (this._detailKey) this._closeDetail();
      if (this._highlight) this._clearHighlight();
    });

    // Event delegation for clicks - listeners attached once here rather
    // than re-bound on every render.
    this.addEventListener("click", (ev) => {
      if (ev.target.closest(".smc-filter, .smc-zoom-controls, .smc-finder")) return;
      const node = ev.target.closest("[data-node]");
      if (node) return this._openDetail("node", node.getAttribute("data-node"));
      const addonNode = ev.target.closest("[data-node-addon]");
      if (addonNode) return this._openDetail("addon", addonNode.getAttribute("data-node-addon"));
      const chip = ev.target.closest("[data-chip]");
      if (chip) return this._openDetail(chip.getAttribute("data-chip-kind"), chip.getAttribute("data-chip"));
      const close = ev.target.closest(".smc-detail-close");
      if (close) return this._closeDetail();
    });
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

    let pointerState = null;
    const DRAG_THRESHOLD = 4;

    wrap.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".smc-zoom-controls")) return;
      const svg = this.querySelector(".smc-graph svg");
      if (!svg || !this._viewBox) return;
      pointerState = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        vbX: this._viewBox.x,
        vbY: this._viewBox.y,
        rectW: svg.clientWidth || 1,
        rectH: svg.clientHeight || 1,
        dragging: false,
      };
    });
    wrap.addEventListener("pointermove", (ev) => {
      if (!pointerState || !this._viewBox) return;
      const dx = ev.clientX - pointerState.startX;
      const dy = ev.clientY - pointerState.startY;
      if (!pointerState.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        pointerState.dragging = true;
        wrap.setPointerCapture(pointerState.pointerId);
        const svg = this.querySelector(".smc-graph svg");
        if (svg) svg.style.cursor = "grabbing";
      }
      const vb = this._viewBox;
      const scaleX = vb.w / pointerState.rectW;
      const scaleY = vb.h / pointerState.rectH;
      vb.x = pointerState.vbX - dx * scaleX;
      vb.y = pointerState.vbY - dy * scaleY;
      this._applyViewBox();
    });
    const endDrag = () => {
      if (pointerState?.dragging) {
        try {
          wrap.releasePointerCapture(pointerState.pointerId);
        } catch (_) {}
      }
      pointerState = null;
      const svg = this.querySelector(".smc-graph svg");
      if (svg) svg.style.cursor = "grab";
    };
    wrap.addEventListener("pointerup", endDrag);
    wrap.addEventListener("pointercancel", endDrag);

    this.querySelector(".smc-zoom-in").addEventListener("click", () => this._zoomBy(0.8));
    this.querySelector(".smc-zoom-out").addEventListener("click", () => this._zoomBy(1.25));
    this.querySelector(".smc-zoom-reset").addEventListener("click", () => this._resetView());
  }

  _zoomBy(factor, cx, cy) {
    if (!this._viewBox || !this._naturalViewBox) return;
    const vb = this._viewBox;
    const nat = this._naturalViewBox;
    const aspect = nat.w / nat.h;
    const minW = nat.w * 0.12;
    const maxW = nat.w;
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

  _resetView() {
    if (!this._naturalViewBox) return;
    this._viewBox = { ...this._naturalViewBox };
    this._applyViewBox();
  }

  _applyViewBox() {
    const svg = this.querySelector(".smc-graph svg");
    if (svg && this._viewBox) {
      const vb = this._viewBox;
      svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }
  }

  // --- entity finder ------------------------------------------------------

  _buildEntityFinder() {
    const input = this.querySelector(".smc-entity-input");
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
    // Click-away closes the suggestions dropdown.
    document.addEventListener("click", (ev) => {
      if (!this.contains(ev.target)) return;
      if (ev.target.closest(".smc-entity-search, .smc-entity-suggestions")) return;
      suggestionsEl.hidden = true;
    });
  }

  // Fetched lazily (only when the entity finder is actually used) rather
  // than on card load - see file header for why this used to make the
  // whole card look stuck on "Loading".
  async _ensureEntityRegistry() {
    if (this._entityRegistry.length) return;
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

    const nodeIds = PLATFORM_TO_NODES[last.reg.platform] || [];
    if (!nodeIds.length) {
      resultEl.textContent = `${chainDesc} is served by the "${last.reg.platform}" integration, which isn't modeled as a node on this map.`;
      this._clearHighlight(false);
      return;
    }

    this._highlight = new Set(nodeIds);
    const names = nodeIds.map((id) => HUB_LAYOUT.find((n) => n.id === id)?.label || id).join(", ");
    resultEl.textContent = `${chainDesc} → highlighted: ${names}`;
    this._renderGraph();
  }

  _clearHighlight(clearResultText = true) {
    this._highlight = null;
    if (clearResultText) this.querySelector(".smc-entity-result").textContent = "";
    this._renderGraph();
  }

  // --- data -------------------------------------------------------------

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

    await Promise.all([addonsP, entriesP, devicesP]);
    this._addonInfoCache.clear();
    this._lastRefreshed = new Date();

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
  }

  _renderAll() {
    this._renderErrors();
    this._renderGraph();
    this._renderChipList("integrations");
    this._renderHostStats();
    this._renderDetail().catch((e) => console.error("system-map-card: detail render failed", e));
    const btn = this.querySelector(".smc-refresh");
    if (btn && this._lastRefreshed) btn.title = `Refresh (last updated ${this._lastRefreshed.toLocaleTimeString()})`;
  }

  _renderErrors() {
    const el = this.querySelector(".smc-errors");
    const msgs = Object.entries(this._loadErrors)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${escapeHtml(v)}`);
    if (!msgs.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = "Some data failed to load - " + msgs.join(" · ");
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

  // Resolves a hub node's live status + short sub-label in one place, so
  // both the graph and the hide-inactive filter agree on what "inactive"
  // means for that node.
  _nodeState(n) {
    let status = "unknown";
    let sub = "";
    if (n.kind === "host") status = "host";
    else if (n.kind === "hardware") status = "hardware";
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
    return { status, sub };
  }

  // --- graph rendering ----------------------------------------------------

  _renderGraph() {
    const hidden = new Set();
    if (this._hideInactive) {
      for (const n of HUB_LAYOUT) {
        if (n.kind === "host" || n.kind === "hardware") continue;
        if (isInactiveStatus(this._nodeState(n).status)) hidden.add(n.id);
      }
    }
    const visible = HUB_LAYOUT.filter((n) => !hidden.has(n.id));
    const dimming = !!(this._highlight && this._highlight.size);

    // Tier bounding boxes - computed from the actual visible node positions
    // + radii each render, so they stay correct without manual upkeep.
    const boxes = {};
    for (const n of visible) {
      const b = boxes[n.tier] || (boxes[n.tier] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const topPad = n.badge ? n.r + 30 : n.r + 16;
      const bottomPad = n.r + 40; // label + sub-label now render below the circle, not inside it
      b.minX = Math.min(b.minX, n.x - n.r - 16);
      b.maxX = Math.max(b.maxX, n.x + n.r + 16);
      b.minY = Math.min(b.minY, n.y - topPad);
      b.maxY = Math.max(b.maxY, n.y + bottomPad);
    }

    const boxesSvg = TIER_ORDER.filter((t) => boxes[t])
      .map((t) => {
        const b = boxes[t];
        const color = TIER_COLORS[t];
        return `<rect class="smc-tier-box" x="${b.minX}" y="${b.minY}" width="${b.maxX - b.minX}" height="${b.maxY - b.minY}" rx="14" style="fill:${color};fill-opacity:0.1;stroke:${color};stroke-opacity:0.55;" />`;
      })
      .join("");
    const tierLabelsSvg = TIER_ORDER.filter((t) => boxes[t])
      .map((t) => `<text class="smc-tier-label" x="${boxes[t].minX + 4}" y="${boxes[t].minY - 10}" style="fill:${TIER_COLORS[t]}">${escapeHtml(TIER_META[t])}</text>`)
      .join("");

    const edgesSvg = HUB_EDGES.filter(([fromId, toId]) => !hidden.has(fromId) && !hidden.has(toId))
      .map(([fromId, toId, opts]) => {
        const from = HUB_LAYOUT.find((n) => n.id === fromId);
        const to = HUB_LAYOUT.find((n) => n.id === toId);
        if (!from || !to) return "";
        const edgeHi = this._highlight && this._highlight.has(fromId) && this._highlight.has(toId);
        const cls = "smc-edge" + (opts?.dashed ? " dashed" : "") + (dimming && !edgeHi ? " smc-dim" : "");
        const line = `<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
        const label = opts?.label
          ? `<text class="smc-edge-label" x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 - 6}">${escapeHtml(opts.label)}</text>`
          : "";
        return line + label;
      })
      .join("");

    const nodesSvg = visible
      .map((n) => {
        const { status, sub } = this._nodeState(n);
        const color = colorFor(status);
        const isHi = this._highlight && this._highlight.has(n.id);
        const cls = "smc-node" + (dimming ? (isHi ? " smc-hi" : " smc-dim") : "");
        const iconPath = n.icon ? ICON_PATHS[n.icon] : null;
        const iconSize = n.r * 1.15;
        const iconSvg = iconPath
          ? `<g transform="translate(${n.x - iconSize / 2},${n.y - iconSize / 2}) scale(${iconSize / 24})" pointer-events="none"><path d="${iconPath}" fill="white" /></g>`
          : "";
        return `
          <g class="${cls}" data-node="${n.id}">
            <circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${color}" />
            ${iconSvg}
            ${n.badge ? `<text class="smc-badge" x="${n.x}" y="${n.y - n.r - 10}">${escapeHtml(n.badge)}</text>` : ""}
            <text x="${n.x}" y="${n.y + n.r + 16}">${escapeHtml(n.label)}</text>
            ${sub ? `<text class="smc-sub" x="${n.x}" y="${n.y + n.r + 30}">${escapeHtml(sub)}</text>` : ""}
          </g>`;
      })
      .join("");

    // Everything not already pinned above, auto-laid-out in a grid - this
    // is what guarantees nothing is ever "missing" from the map again.
    const pinnedSlugs = new Set(HUB_LAYOUT.filter((n) => n.kind === "addon").map((n) => n.slug));
    let otherAddons = this._addons.filter((a) => !pinnedSlugs.has(a.slug));
    if (this._hideInactive) otherAddons = otherAddons.filter((a) => !isInactiveStatus(addonStatus(a)));
    otherAddons = [...otherAddons].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const gridStartY = 1180;
    const { cols, spacingX, spacingY, r, marginX, topPad, bottomPad } = OTHER_GRID;
    const rows = Math.ceil(otherAddons.length / cols);
    const gridPositions = otherAddons.map((a, i) => ({
      addon: a,
      x: marginX + (i % cols) * spacingX,
      y: gridStartY + topPad + Math.floor(i / cols) * spacingY,
    }));
    const gridBoxSvg = gridPositions.length
      ? (() => {
          const minX = Math.min(...gridPositions.map((p) => p.x)) - r - 16;
          const maxX = Math.max(...gridPositions.map((p) => p.x)) + r + 16;
          const minY = gridStartY + topPad - r - 16;
          const maxY = Math.max(...gridPositions.map((p) => p.y)) + r + 16;
          return (
            `<rect class="smc-tier-box" x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="14" style="fill:${OTHER_GRID_COLOR};fill-opacity:0.08;stroke:${OTHER_GRID_COLOR};stroke-opacity:0.5;" />` +
            `<text class="smc-tier-label" x="${minX + 4}" y="${minY - 10}" style="fill:${OTHER_GRID_COLOR}">Other add-ons &amp; tools</text>`
          );
        })()
      : "";
    const gridSvg = gridPositions
      .map(
        ({ addon, x, y }) => `
          <g class="smc-node smc-node-small${dimming ? " smc-dim" : ""}" data-node-addon="${escapeHtml(addon.slug)}">
            <circle cx="${x}" cy="${y}" r="${r}" fill="${colorFor(addonStatus(addon))}" />
            <text x="${x}" y="${y + 3}">${escapeHtml(truncate(addon.name, 15))}</text>
          </g>`
      )
      .join("");
    const totalHeight = gridPositions.length ? gridStartY + topPad + rows * spacingY + bottomPad : gridStartY - 40;

    const natural = { x: 0, y: 0, w: 1220, h: totalHeight };
    this._naturalViewBox = natural;
    if (!this._viewBox) this._viewBox = { ...natural };

    this.querySelector(".smc-graph").innerHTML = `
      <svg viewBox="${this._viewBox.x} ${this._viewBox.y} ${this._viewBox.w} ${this._viewBox.h}" xmlns="http://www.w3.org/2000/svg">
        ${boxesSvg}
        ${gridBoxSvg}
        ${tierLabelsSvg}
        ${edgesSvg}
        ${nodesSvg}
        ${gridSvg}
      </svg>`;
  }

  _renderChipList(kind) {
    // Add-ons now live entirely in the graph above (curated nodes + the
    // auto-grid), so only Integrations - too numerous (~80) to usefully
    // render as graph nodes - keep the scrollable chip-list treatment.
    const wrap = this.querySelector(`[data-list="${kind}"]`);
    const countEl = this.querySelector(`[data-count="${kind}"]`);
    const all = [...this._entries].sort((a, b) => (a.domain || "").localeCompare(b.domain || ""));
    const shown = this._hideInactive ? all.filter((e) => !isInactiveStatus(entryStatus(e))) : all;
    countEl.textContent = shown.length === all.length ? `(${all.length})` : `(${shown.length} of ${all.length})`;
    wrap.innerHTML = shown
      .map((e) => {
        const status = entryStatus(e);
        const label = e.title ? `${e.domain}: ${e.title}` : e.domain;
        return `<span class="smc-chip" data-chip="${escapeHtml(e.entry_id)}" data-chip-kind="entry">
          <span class="smc-dot" style="background:${colorFor(status)}"></span>${escapeHtml(label)}
        </span>`;
      })
      .join("");
  }

  _renderHostStats() {
    if (!this._hass) return;
    // Only touches the host node's own text + the detail panel if it's the
    // one currently open - deliberately not a full _renderGraph() call,
    // since this runs on every hass update (i.e. very often).
    const host = HUB_LAYOUT.find((n) => n.id === "host");
    const cpu = this._hass.states["sensor.processor_use"];
    const sub = cpu ? `CPU ${cpu.state}%` : "";
    const subEl = this.querySelector('.smc-node[data-node="host"] .smc-sub');
    if (subEl) subEl.textContent = sub;
    else {
      const g = this.querySelector('.smc-node[data-node="host"]');
      if (g && sub) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("class", "smc-sub");
        t.setAttribute("x", host.x);
        t.setAttribute("y", host.y + 12);
        t.textContent = sub;
        g.appendChild(t);
      }
    }
  }

  // --- detail panel -------------------------------------------------------

  async _openDetail(kind, key) {
    this._detailKey = `${kind}:${key}`;
    await this._renderDetail();
  }

  _closeDetail() {
    this._detailKey = null;
    this.querySelector(".smc-detail").hidden = true;
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
      rows.push(["Exposed via Cloudflare", `<a href="${escapeHtml(n.exposedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.exposedUrl)}</a>`, true]);
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

    if (kind === "node") {
      const n = HUB_LAYOUT.find((h) => h.id === key);
      if (!n) return this._closeDetail();
      title = n.label;
      role = ROLES[n.id] || "";
      if (n.kind === "host") {
        // Skip rather than show "unavailable" for any stat whose entity
        // has no live state right now (e.g. disabled by the integration) -
        // see the comment on HOST_STATS above for why that's expected for
        // some System Monitor resources on this instance.
        rows = HOST_STATS.map((s) => {
          const st = this._hass.states[s.entity];
          return st ? [s.label, `${st.state}${s.suffix}`] : null;
        }).filter(Boolean);
        if (n.exposedUrl) {
          rows.push(["Exposed via Cloudflare", `<a href="${escapeHtml(n.exposedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.exposedUrl)}</a>`, true]);
        }
      } else if (n.kind === "hardware") {
        rows = []; // role text above is the whole story - no live API for raw USB info
      } else if (n.kind === "addon") {
        const info = await this._fetchAddonInfo(n.slug);
        rows = this._addonInfoRows(info, n);
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
      const hub = HUB_LAYOUT.find((n) => n.kind === "addon" && n.slug === key);
      if (hub) role = ROLES[hub.id] || "";
      const info = await this._fetchAddonInfo(key);
      rows = this._addonInfoRows(info, hub);
    } else if (kind === "entry") {
      const entry = this._entries.find((e) => e.entry_id === key);
      if (!entry) return this._closeDetail();
      title = entry.title || entry.domain;
      const hub = HUB_LAYOUT.find((n) => n.kind === "integration" && n.domain === entry.domain);
      if (hub) role = ROLES[hub.id] || "";
      rows = [
        ["Domain", entry.domain],
        ["State", entry.state],
        ["Source", entry.source],
        ["Disabled by", entry.disabled_by || "-"],
      ];
    }

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
      </dl>`;
  }
}

customElements.define("system-map-card", SystemMapCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "system-map-card",
  name: "System Map",
  description: "Full topology map with entity finder: hardware, the add-ons using it, network/remote-access entry points, and every other add-on.",
});
