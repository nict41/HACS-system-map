// Headless tests for system-map-card.js.
//
//   node test/system-map-card.test.mjs      (run from the repo root)
//
// The card is a custom element with no build step, so there's no module to
// import - the file is evaluated in a vm context against a DOM stubbed down
// to the handful of calls the card actually makes. That's enough to exercise
// everything worth testing: config defaulting, hardware discovery and its
// derived ownership edges, the problem/count joins, the status bar's
// thresholds, and that every optional section can be switched off without
// taking the card down. Rendering is asserted against the emitted markup
// rather than a real layout, since there is no layout engine here.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync("system-map-card.js", "utf8") +
  "\nglobalThis.__SMC = SystemMapCard;\nglobalThis.__EDITOR = SystemMapCardEditor;\n";

const makeEl = () => ({
  innerHTML: "", textContent: "", hidden: false, scrollTop: 0,
  offsetTop: 0, clientHeight: 100, offsetHeight: 20,
  querySelector: () => null, querySelectorAll: () => [],
  setAttribute() {}, appendChild() {},
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
  fire(type, detail) { (this._listeners[type] || []).forEach((fn) => fn({ detail, stopPropagation() {} })); },
});

const ctx = {
  console, setTimeout, clearTimeout, Blob: class {}, XMLSerializer: class {},
  HTMLElement: class { querySelector() { return null; } addEventListener() {} appendChild() {} },
  customElements: { define: () => {} },
  window: { customCards: [], addEventListener: () => {} },
  document: { addEventListener: () => {}, createElement: () => makeEl(), createElementNS: () => makeEl() },
  localStorage: { getItem: () => null, setItem: () => {} },
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { __SMC: SystemMapCard, __EDITOR: SystemMapCardEditor } = ctx;

let all = true;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  all &&= ok;
};

// --- fixture ---------------------------------------------------------------
const DRIVE = {
  id: "drive_liteon", vendor: "LITEON", model: "EP2", serial: "S1", size: 1900000000000,
  connection_bus: "usb", removable: true,
  filesystems: [{ device: "/dev/sda1", name: "NAS1", size: 1e12, system: false, mount_points: ["/media/NAS1"] }],
};
const DONGLE = {
  name: "ttyUSB0", subsystem: "tty", dev_path: "/dev/ttyUSB0",
  by_id: "/dev/serial/by-id/usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_abc-if00-port0",
};

function newCard(config = {}, opts = {}) {
  const card = new SystemMapCard();
  const els = new Map([
    [".smc-graph", makeEl()], [".smc-status", makeEl()], [".smc-stats", makeEl()],
    [".smc-legend", makeEl()], [".smc-errors", makeEl()], [".smc-detail", makeEl()],
    ['[data-list="integrations"]', makeEl()], ['[data-count="integrations"]', makeEl()],
    [".smc-entity-result", makeEl()],
  ]);
  for (const sel of opts.missing || []) els.delete(sel);
  card.querySelector = (sel) => els.get(sel) || null;
  card._els = els;
  card.setConfig({ type: "custom:system-map-card", ...config });

  card._addons = [
    { slug: "core_mosquitto", name: "Mosquitto broker", state: "started" },
    { slug: "45df7312_zigbee2mqtt", name: "Zigbee2MQTT", state: "started", update_available: true },
    { slug: "core_samba", name: "Samba share", state: "started" },
    { slug: "a_spare", name: "Some Other Add-on", state: "stopped" },
  ];
  card._entries = [
    { entry_id: "e_mjpeg", domain: "mjpeg", title: "3D Print Cam", state: "loaded", source: "user" },
    { entry_id: "e_mqtt", domain: "mqtt", title: "Mosquitto", state: "loaded", source: "user" },
    { entry_id: "e_hue", domain: "hue", title: "Hue Bridge", state: "loaded", source: "user" },
    { entry_id: "e_off", domain: "spotify", title: "Spotify", state: "not_loaded", disabled_by: "user", source: "user" },
  ];
  card._devices = [{ id: "d1", config_entries: ["e_hue"], area_id: "lounge" }];
  card._areas = [{ area_id: "lounge", name: "Lounge" }];
  card._entityRegistry = [
    { entity_id: "light.hue_1", platform: "hue", config_entry_id: "e_hue", device_id: "d1", area_id: null },
    { entity_id: "light.hue_2", platform: "hue", config_entry_id: "e_hue", device_id: "d1", area_id: null },
    { entity_id: "camera.print", platform: "mjpeg", config_entry_id: "e_mjpeg" },
    { entity_id: "sensor.z2m_1", platform: "mqtt", config_entry_id: "e_mqtt" },
    { entity_id: "sensor.z2m_dead", platform: "mqtt", config_entry_id: "e_mqtt" },
  ];
  card._entityRegistryByEntityId = new Map(card._entityRegistry.map((e) => [e.entity_id, e]));
  card._hass = {
    states: {
      "light.hue_1": { state: "on" }, "light.hue_2": { state: "on" },
      "camera.print": { state: "idle" },
      "sensor.z2m_1": { state: "21" }, "sensor.z2m_dead": { state: "unavailable" },
      "sensor.processor_use": { state: "17", attributes: {} },
      "update.core": { state: "on", attributes: { friendly_name: "Home Assistant Core" } },
      "update.quiet": { state: "off", attributes: {} },
    },
  };
  card._hardware = { devices: [DONGLE, ...(opts.extraDevices || [])], drives: [DRIVE] };
  // Samba addresses the disk by its filesystem *label* (moredisks: [NAS1]),
  // not by a path, and publishes it over SMB - so it is the mounter, and the
  // add-ons that also reference NAS1 are reaching it through that share.
  card._addonInfoCache = new Map([
    ["45df7312_zigbee2mqtt", { name: "Zigbee2MQTT", options: { serial: { port: DONGLE.by_id }, mqtt: { server: "mqtt://core-mosquitto" } } }],
    ["c9a35110_sambanas", { name: "Samba NAS", network: { "445/tcp": 445, "139/tcp": 139 }, options: { workgroup: "WORKGROUP", moredisks: ["NAS1"] } }],
    ["3b88f413_immich", { name: "Immich", network: { "3001/tcp": 8080 }, options: { external_library: "/media/NAS1/photos" } }],
    ["beb500c8_kiwix", { name: "Kiwix", options: { zim_dir: "NAS1" } }],
    ...(opts.addonInfo || []),
  ]);
  card._system = {
    host: { hostname: "homeassistant", disk_total: 100, disk_free: 4.2, kernel: "6.6", boot_timestamp: (Date.now() - 3 * 864e5) * 1000 },
    core: { version: "2026.8.1", version_latest: "2026.9.0", update_available: true, arch: "amd64" },
    os: { version: "13.1", board: "generic-x86-64", update_available: false },
    supervisor: { version: "2026.08.0", channel: "stable" },
    network: { host_internet: true, supervisor_internet: true, interfaces: [{ interface: "enp1s0", type: "ethernet", connected: true, primary: true, ipv4: { address: ["192.168.8.50/24"] } }] },
    backups: [{ slug: "b1", name: "Nightly", date: new Date(Date.now() - 20 * 864e5).toISOString(), size: 512 }],
  };
  card._issues = [{ domain: "hue", issue_id: "bridge_firmware", severity: "warning", is_fixable: true }];
  card._systemHealth = { mqtt: { info: { broker: "core-mosquitto", connected: true } } };
  card._deriveHardware();
  card._buildProblemIndex();
  card._buildCounts();
  return card;
}

// --- config ----------------------------------------------------------------
const c = newCard();
T("defaults fill in unset options", [c._config.title, c._config.refresh_interval, c._config.show_status_bar], ["System Map", 60, true]);
T("an empty tiers list falls back to all four", newCard({ tiers: [] })._config.tiers, ["hardware", "services", "network", "remote"]);
T("null options fall back rather than disabling", newCard({ show_legend: null })._config.show_legend, true);
T("getStubConfig is the bare type", SystemMapCard.getStubConfig(), { type: "custom:system-map-card" });

// --- hardware discovery ----------------------------------------------------
T("a drive and a serial dongle become nodes", c._derived.nodes.map((n) => n.label), ["LITEON EP2", "ITead Sonoff Zigbee 3.0"]);
T("a drive carries its filesystem labels", c._derived.nodes[0].labels, ["NAS1"]);
T("no discovered node lands on top of the host",
  c._derived.nodes.some((n) => Math.abs(n.x - 610) < 60 && n.y === 150), false);
T("ownership is derived from the add-on's own nested options",
  c._derived.edges.filter((e) => e[0].startsWith("hw_tty")).map((e) => [e[1], e[2].label]),
  [["zigbee2mqtt", "owns (serial.port)"]]);
T("every discovered device hangs off the host",
  c._derived.edges.filter((e) => e[0] === "host").length, 2);
// --- the Samba republish chain --------------------------------------------
const drive = () => c._derived.nodes.find((n) => n.id.startsWith("hw_drive"));
const edgeLabels = (from, to) =>
  c._derived.edges.filter((e) => (!from || e[0] === from) && (!to || e[1] === to)).map((e) => e[2].label);

T("a disk referenced by filesystem label, not path, is still matched",
  drive().usedBy.find((u) => u.slug === "c9a35110_sambanas")?.option, "moredisks");
T("the SMB server owns the drive",
  edgeLabels(drive().id, "samba"), ["serves (moredisks)"]);
T("consumers hang off the share, not the hardware",
  [edgeLabels(drive().id, "immich"), edgeLabels("samba", "immich")], [[], ["SMB: NAS1"]]);
T("a consumer referencing the bare label resolves the same way",
  edgeLabels("samba", "kiwix"), ["SMB: NAS1"]);
T("the drive detail separates who mounts it from who reaches it over SMB",
  drive().usedBy.map((u) => [u.name, u.via, u.share]),
  [["Samba NAS", null, null], ["Immich", "Samba NAS", "NAS1"], ["Kiwix", "Samba NAS", "NAS1"]]);
T("a serial device with one claimant is still a direct owns edge",
  edgeLabels(c._derived.nodes.find((n) => n.id.startsWith("hw_tty")).id, "zigbee2mqtt"), ["owns (serial.port)"]);

// Without an SMB server in the picture, every claimant goes back to hanging
// off the drive directly - the old behaviour, unchanged.
T("no SMB server means direct edges for everyone",
  (() => {
    const plain = newCard();
    plain._addonInfoCache.set("c9a35110_sambanas", { name: "Samba NAS", options: { moredisks: ["NAS1"] } });
    plain._deriveHardware();
    const d = plain._derived.nodes.find((n) => n.id.startsWith("hw_drive"));
    return plain._derived.edges.filter((e) => e[0] === d.id).map((e) => e[2].label).sort();
  })(),
  ["owns (external_library)", "owns (moredisks)", "owns (zim_dir)"]);

// The length filter is applied where labels are built, not in the matcher,
// so assert it there: a two-character volume name matches too much to be
// evidence and never becomes a label at all.
T("a filesystem label under three characters is discarded",
  (() => {
    const short = newCard();
    short._hardware = { devices: [], drives: [{ ...DRIVE, filesystems: [{ device: "/dev/sda1", name: "OK", mount_points: [] }] }] };
    short._deriveHardware();
    return short._derived.nodes[0].labels;
  })(), []);
T("a label must be the value or a path's last segment, not a substring",
  [
    ctx.matchDeviceValue("NAS1", { labels: ["NAS1"], paths: [] }),
    ctx.matchDeviceValue("/media/NAS1/photos", { labels: ["NAS1"], paths: ["/media/NAS1"] }),
    ctx.matchDeviceValue("my NAS1 backup notes", { labels: ["NAS1"], paths: [] }),
  ],
  ["NAS1", "/media/NAS1", null]);
T("servesSmb reads published ports, not the add-on name",
  [ctx.servesSmb({ network: { "445/tcp": 445 } }), ctx.servesSmb({ name: "samba", network: { "80/tcp": 80 } }), ctx.servesSmb(null)],
  [true, false, false]);

// A drive plus eight dongles needs a second hardware row, and everything
// below the hardware tier has to move down to make space for it.
const many = newCard({}, { extraDevices: Array.from({ length: 8 }, (_, i) => ({ ...DONGLE, by_id: `${DONGLE.by_id}_${i}` })) });
T("hardware wraps to a second row", new Set(many._derived.nodes.map((n) => n.y)).size, 2);
T("the tiers below are pushed down by exactly one row",
  many._layout().find((n) => n.id === "zha").y - c._layout().find((n) => n.id === "zha").y, 130);
T("the hardware tier itself does not move",
  many._layout().find((n) => n.id === "host").y, 150);
T("discovery off means no hardware nodes and no offset",
  (() => { const off = newCard({ discover_hardware: false }); return [off._derived.nodes.length, off._layout().find((n) => n.id === "zha").y]; })(),
  [0, c._layout().find((n) => n.id === "zha").y]);

// --- problem join ----------------------------------------------------------
T("a dead mqtt entity flags the add-on nodes that serve it",
  c._problemFor("node:zigbee2mqtt"), { severity: "bad", label: "1/2 unavailable", badge: "1", reason: "1 of 2 entities are unavailable or unknown" });
T("an open repair issue flags its integration",
  c._problemFor("entry:e_hue")?.label, "1 repair issue");
T("a healthy integration is not flagged", c._problemFor("entry:e_mjpeg"), null);
T("problem highlighting can be turned off", newCard({ highlight_problems: false })._problemFor("node:zigbee2mqtt"), null);
T("system health lands on the node its domain resolves to",
  c._problems.get("node:mosquitto")?.health, { broker: "core-mosquitto", connected: true });

// --- counts ----------------------------------------------------------------
T("entity and device counts per node",
  (() => { const r = c._counts.get("entry:e_hue"); return [r.entities, r.devices.size, [...r.areas]]; })(), [2, 1, [["lounge", 2]]]);
T("the grouped layout files an integration under its busiest area",
  (() => {
    const two = newCard({ group_by_area: true });
    two._areas.push({ area_id: "hall", name: "Hall" });
    two._devices.push({ id: "d2", config_entries: ["e_hue"], area_id: "hall" });
    two._entityRegistry.push({ entity_id: "light.hue_3", platform: "hue", config_entry_id: "e_hue", device_id: "d2" });
    two._buildCounts();
    return two._groupByArea([{ kind: "entry", key: "e_hue", label: "hue" }]).map(([n]) => n);
  })(), ["Lounge"]);
T("counts reach the node sub-label", c._nodeState(c._layout().find((n) => n.id === "mosquitto")).sub, "1/2 unavailable");

// --- status bar ------------------------------------------------------------
const status = Object.fromEntries(c._statusItems().map((i) => [i.key, i]));
T("a core update shows as a warning", [status.core.value, status.core.tone], ["2026.8.1", "warn"]);
T("a nearly-full disk reads bad", [status.disk.value, status.disk.tone], ["4.2 GB free", "bad"]);
T("a three-day uptime", status.uptime.value, "3 days");
T("pending updates count both entities and add-ons",
  [status.updates.value, status.updates.tone], ["2 pending", "warn"]);
T("a 20-day-old backup reads bad", status.backup.tone, "bad");
T("connectivity is read from both Supervisor flags", status.internet.value, "connected");
T("open repairs surface in the bar", status.repairs.value, "1 open");

// --- rendering -------------------------------------------------------------
c._renderGraph();
const svg = c._els.get(".smc-graph").innerHTML;
T("discovered hardware is drawn", svg.includes('data-node="hw_drive_drive_liteon"'), true);
T("a flagged node gets the problem class", svg.includes("smc-problem"), true);
T("every config entry still gets a node", c._entries.every((e) => c._nodePositions.has(`entry:${e.entry_id}`)), true);
c._renderStatusBar();
T("the status bar renders one pill per status item",
  (c._els.get(".smc-status").innerHTML.match(/data-status=/g) || []).length, c._statusItems().length);
c._renderLegend();
T("the legend renders swatches", c._els.get(".smc-legend").innerHTML.includes("Running / loaded"), true);
c._history = { cpu: [10, 20, 15, 30] };
c._renderHostStats();
T("a host stat tile renders with its sparkline",
  [c._els.get(".smc-stats").innerHTML.includes("17%"), c._els.get(".smc-stats").innerHTML.includes("<path")], [true, true]);

// --- area grouping ---------------------------------------------------------
const grouped = newCard({ group_by_area: true });
grouped._renderGraph();
T("grouping by area splits the integrations grid",
  grouped._groupByArea([{ kind: "entry", key: "e_hue", label: "hue" }, { kind: "entry", key: "e_mjpeg", label: "mjpeg" }]).map(([n, i]) => [n, i.length]),
  [["Lounge", 1], ["No area", 1]]);

// --- sections switched off -------------------------------------------------
const bare = newCard(
  { show_status_bar: false, show_host_stats: false, show_legend: false, show_entity_finder: false, show_integration_list: false, show_addon_grid: false, show_integration_grid: false },
  { missing: [".smc-status", ".smc-stats", ".smc-legend", '[data-list="integrations"]', '[data-count="integrations"]', ".smc-entity-result"] }
);
let bareOk = true;
try {
  bare._renderStatusBar(); bare._renderLegend(); bare._renderHostStats();
  bare._renderChipList("integrations"); bare._renderGraph(); bare._clearHighlight(); bare._buildEntityFinder();
} catch (e) { bareOk = e; }
T("every section can be switched off without a crash", bareOk, true);
T("with both grids off only the curated layout is drawn",
  [...bare._nodePositions.keys()].every((k) => k.startsWith("node:")), true);

// --- markup ----------------------------------------------------------------
// _build() nests conditional template literals inside one big template, which
// is exactly the kind of thing that parses fine and emits nonsense, so assert
// on the markup itself.
const built = (config) => {
  const card = new SystemMapCard();
  let html = "";
  Object.defineProperty(card, "innerHTML", { set: (v) => (html = v), get: () => html });
  card.querySelector = () => makeEl();
  card.setConfig({ type: "custom:system-map-card", ...config });
  card._build();
  return html;
};
// Only the markup, never the stylesheet - every class name appears in the
// CSS whether or not its section was rendered.
const markup = (config) => built(config).split("<style>")[0];
const SECTIONS = ["smc-status", "smc-stats", "smc-legend", "smc-finder", 'data-list="integrations"'];
const ALWAYS = ["smc-graph", "smc-detail", "smc-export", "smc-header"];

const fullHtml = markup({ graph_height: 640 });
T("every section is present by default", SECTIONS.filter((cls) => !fullHtml.includes(cls)), []);
T("graph height is applied", fullHtml.includes("height:640px"), true);
T("no stray template markers leak into the markup",
  /\$\{|undefined|\[object/.test(fullHtml), false);
T("tags balance", (fullHtml.match(/<div/g) || []).length, (fullHtml.match(/<\/div>/g) || []).length);

const bareHtml = markup({ show_status_bar: false, show_host_stats: false, show_legend: false, show_entity_finder: false, show_integration_list: false });
T("switched-off sections are absent from the markup", SECTIONS.filter((cls) => bareHtml.includes(cls)), []);
T("the graph, detail panel and controls survive everything being switched off",
  ALWAYS.filter((cls) => !bareHtml.includes(cls)), []);
T("tags still balance with sections off", (bareHtml.match(/<div/g) || []).length, (bareHtml.match(/<\/div>/g) || []).length);

// --- tier filter -----------------------------------------------------------
T("tiers can be limited", newCard({ tiers: ["hardware"] })._layout().every((n) => n.tier === "hardware"), true);

// --- formatters ------------------------------------------------------------
T("formatBytes", [ctx.formatBytes(0), ctx.formatBytes(1536), ctx.formatBytes(5 * 1024 ** 3), ctx.formatBytes("x")],
  ["0 B", "1.5 KB", "5.0 GB", null]);
T("formatAge", [ctx.formatAge(30e3), ctx.formatAge(90 * 60e3), ctx.formatAge(5 * 864e5)], ["just now", "1 hour", "5 days"]);
T("sparklinePath maps a flat series to a flat line",
  ctx.sparklinePath([5, 5, 5], 10, 4), "M0.0,4.0 L5.0,4.0 L10.0,4.0");
T("findDeviceInOptions ignores an unrelated option",
  ctx.findDeviceInOptions({ mqtt: { server: "mqtt://core" } }, { paths: ["/dev/ttyUSB0"], labels: [] }), null);
T("findDeviceInOptions reports the option key and what it matched",
  ctx.findDeviceInOptions({ serial: { port: "/dev/ttyUSB0" } }, { paths: ["/dev/ttyUSB0"], labels: [] }),
  { option: "serial.port", matched: "/dev/ttyUSB0" });

// --- error reporting -------------------------------------------------------
// A Container or Core install has no Supervisor, so every one of those
// endpoints fails at once. Eight near-identical messages in a red bar reads
// like the card is broken when most of it works fine.
const errorsFor = (loadErrors) => {
  const card = newCard();
  const el = makeEl();
  card.querySelector = (sel) => (sel === ".smc-errors" ? el : makeEl());
  card._loadErrors = loadErrors;
  card._renderErrors();
  return el.hidden ? null : el.innerHTML;
};
T("no errors hides the strip", errorsFor({}), null);
T("a whole missing Supervisor is reported as one fact",
  errorsFor({ addons: "not found", host: "not found", core: "not found", os: "not found", supervisor: "not found", network: "not found", backups: "not found", hardware: "not found" }),
  "Supervisor API unavailable (8 endpoints) - the status bar, host stats, discovered hardware and add-on data need a Home Assistant OS or Supervised install. Everything else on this card works without it.");
T("one or two Supervisor failures are still reported individually",
  errorsFor({ backups: "timeout" }), "backups: timeout");
T("non-Supervisor failures keep their detail alongside",
  errorsFor({ addons: "x", host: "x", core: "x", entries: "websocket closed" }).includes("entries: websocket closed"), true);

// --- config changes apply live ---------------------------------------------
// Regression: every option inside a *named* ha-form expandable was written to
// config.<section>.<option>, which setConfig never reads - the form worked
// and the card never changed. ha-form only merges a section's values into the
// parent when the item has no name (or flatten: true).
T("no expandable section nests its values under a name",
  (ctx.EDITOR_SCHEMA || [])
    .filter((f) => f.type === "expandable")
    .filter((f) => f.name || f.flatten !== true)
    .map((f) => f.title || f.name),
  []);
T("every expandable still has a header title",
  (ctx.EDITOR_SCHEMA || []).filter((f) => f.type === "expandable" && !f.title).length, 0);

T("a changed option re-renders from data in hand, without refetching",
  (() => {
    const live = newCard();
    live._loaded = true;
    let refetched = false;
    live._refreshData = () => { refetched = true; };
    live._build = function () { this._builtWith = this._config.show_legend; };
    live.setConfig({ type: "custom:system-map-card", show_legend: false });
    return [live._config.show_legend, live._built, live._builtWith, refetched];
  })(),
  [false, true, false, false]);

T("turning on a join whose data was never fetched does refetch once",
  (() => {
    const off = newCard({ discover_hardware: false });
    off._loaded = true;
    off._hardware = null;
    let refetches = 0;
    off._refreshData = () => { refetches += 1; };
    off._build = () => {};
    off.setConfig({ type: "custom:system-map-card", discover_hardware: true });
    off.setConfig({ type: "custom:system-map-card", discover_hardware: true, title: "typing" });
    off._loadErrors.hardware = "no supervisor"; // a failed fetch must not retry forever
    off.setConfig({ type: "custom:system-map-card", discover_hardware: true, title: "typing more" });
    return refetches;
  })(), 2);

T("a config change keeps the fetched data",
  (() => {
    const live = newCard();
    live._loaded = true;
    live._build = () => {};
    const before = live._addons.length;
    live.setConfig({ type: "custom:system-map-card", title: "Renamed" });
    return [before, live._addons.length, live._entries.length];
  })(), [4, 4, 4]);

// --- editor ----------------------------------------------------------------
const editor = new SystemMapCardEditor();
let emitted = null;
editor.appendChild = () => {};
editor.dispatchEvent = (ev) => (emitted = ev.detail?.config ?? ev.detail);
ctx.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
editor.setConfig({ type: "custom:system-map-card", title: "Mine" });
T("the editor seeds ha-form with the merged config", [editor._form.data.title, editor._form.data.graph_height], ["Mine", 480]);
T("the editor schema and the defaults share every key",
  (() => {
    const names = [];
    const walk = (schema) => schema.forEach((f) => (f.schema ? walk(f.schema) : names.push(f.name)));
    walk(ctx.EDITOR_SCHEMA || []);
    return names.filter((n) => !(n in ctx.DEFAULTS));
  })(), []);
T("every schema field has a human label",
  (() => {
    const missing = [];
    const walk = (schema) => schema.forEach((f) => { if (f.name && !ctx.EDITOR_LABELS[f.name]) missing.push(f.name); if (f.schema) walk(f.schema); });
    walk(ctx.EDITOR_SCHEMA || []);
    return missing;
  })(), []);
editor._form.fire("value-changed", { value: { title: "Renamed", show_legend: false } });
T("a form change emits config-changed carrying the card type and the new values",
  emitted, { type: "custom:system-map-card", title: "Renamed", show_legend: false });

process.exit(all ? 0 : 1);
