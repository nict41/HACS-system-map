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
  "\nglobalThis.__SMC = SystemMapCard;\nglobalThis.__EDITOR = SystemMapCardEditor;\n" +
  "globalThis.__EXPORT = { chipWidth, layoutGeometry, worstStatus, SVG_PAINT_PROPS, categoriseService, mappedFolders, inBatches, ADDON_FETCH_BATCH, dataCache };\n";

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
  // isConnected is a real DOM property the card checks before doing
  // background work; on a bare stub it is undefined, which would silently
  // skip every background loader under test.
  // Listeners are kept rather than dropped so a test can fire the card's own
  // delegated click handler, which is where node selection lives.
  HTMLElement: class {
    get isConnected() { return true; }
    querySelector() { return null; }
    appendChild() {}
    addEventListener(type, fn) { (this._listeners ||= {})[type] = [...((this._listeners || {})[type] || []), fn]; }
  },
  customElements: { define: () => {} },
  window: {
    customCards: [],
    _added: 0,
    _removed: 0,
    addEventListener() { this._added++; },
    removeEventListener() { this._removed++; },
  },
  document: {
    _added: 0,
    _removed: 0,
    addEventListener() { this._added++; },
    removeEventListener() { this._removed++; },
    createElement: () => makeEl(),
    createElementNS: () => makeEl(),
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { __SMC: SystemMapCard, __EDITOR: SystemMapCardEditor, __EXPORT } = ctx;

let all = true;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  all &&= ok;
};

// --- fixture ---------------------------------------------------------------
const DRIVE = {
  id: "drive_media", vendor: "Generic", model: "USB 3.0 Disk", serial: "S1", size: 1900000000000,
  connection_bus: "usb", removable: true,
  filesystems: [{ device: "/dev/sda1", name: "MEDIA", size: 1e12, system: false, mount_points: ["/media/MEDIA"] }],
};
const DONGLE = {
  name: "ttyUSB0", subsystem: "tty", dev_path: "/dev/ttyUSB0",
  by_id: "/dev/serial/by-id/usb-Zigbee_Coordinator_USB_Dongle_0001-if00-port0",
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
    { slug: "a0d7b954_zigbee2mqtt", name: "Zigbee2MQTT", state: "started", update_available: true },
    { slug: "d1c2b3a4_samba_nas", name: "Samba NAS", state: "started" },
    { slug: "d1c2b3a4_photoprism", name: "PhotoPrism", state: "started" },
    { slug: "d1c2b3a4_jellyfin", name: "Jellyfin", state: "started" },
    { slug: "a0d7b954_adguard", name: "AdGuard Home", state: "started" },
    { slug: "d1c2b3a4_cloudflared", name: "Cloudflared", state: "started" },
    { slug: "a_spare", name: "Some Other Add-on", state: "stopped" },
  ];
  card._entries = [
    { entry_id: "e_mjpeg", domain: "mjpeg", title: "Garage Cam", state: "loaded", source: "user" },
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
  // Samba addresses the disk by its filesystem *label* (moredisks: [MEDIA]),
  // not by a path, and publishes it over SMB - so it is the mounter, and the
  // add-ons that also reference MEDIA are reaching it through that share.
  card._addonInfoCache = new Map([
    ["core_mosquitto", { name: "Mosquitto broker", network: { "1883/tcp": 1883 }, options: {} }],
    ["a0d7b954_zigbee2mqtt", { name: "Zigbee2MQTT", network: { "8099/tcp": 8099 }, options: { serial: { port: DONGLE.by_id }, mqtt: { server: "mqtt://core-mosquitto:1883" } } }],
    ["d1c2b3a4_samba_nas", { name: "Samba NAS", network: { "445/tcp": 445, "139/tcp": 139 }, options: { workgroup: "WORKGROUP", moredisks: ["MEDIA"] } }],
    ["d1c2b3a4_photoprism", { name: "PhotoPrism", network: { "3001/tcp": 8080 }, options: { external_library: "/media/MEDIA/photos" } }],
    ["d1c2b3a4_jellyfin", { name: "Jellyfin", options: { zim_dir: "MEDIA" } }],
    ["a0d7b954_adguard", { name: "AdGuard Home", network: { "53/tcp": 53, "3000/tcp": 3000 }, options: {} }],
    ["d1c2b3a4_cloudflared", { name: "Cloudflared", network: {}, options: { tunnel_token: "ey...", external_hostname: "" } }],
    ["a_spare", { name: "Some Other Add-on", options: {} }],
    ...(opts.addonInfo || []),
  ]);
  card._system = {
    host: { hostname: "homeassistant", disk_total: 100, disk_free: 4.2, kernel: "6.6", boot_timestamp: (Date.now() - 3 * 864e5) * 1000 },
    core: { version: "2026.8.1", version_latest: "2026.9.0", update_available: true, arch: "amd64" },
    os: { version: "13.1", board: "generic-x86-64", update_available: false },
    supervisor: { version: "2026.08.0", channel: "stable" },
    network: { host_internet: true, supervisor_internet: true, interfaces: [{ interface: "enp1s0", type: "ethernet", connected: true, primary: true, ipv4: { address: ["192.168.1.50/24"] } }] },
    backups: [{ slug: "b1", name: "Nightly", date: new Date(Date.now() - 20 * 864e5).toISOString(), size: 512 }],
  };
  card._issues = [{ domain: "hue", issue_id: "bridge_firmware", severity: "warning", is_fixable: true }];
  card._systemHealth = { mqtt: { info: { broker: "core-mosquitto", connected: true } } };
  card._logRoutes = opts.logRoutes ?? [
    { hostname: "ha.example.com", service: "http://192.168.1.50:8123", source: "log", viaSlug: "d1c2b3a4_cloudflared" },
    { hostname: "nas.example.com", service: "http://192.168.1.50:8080", source: "log", viaSlug: "d1c2b3a4_cloudflared" },
  ];
  card._derive();
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
const addonId = (slug) => `addon_${slug.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
const hw = (card = c) => card._derived.nodes.filter((n) => n.kind === "hardware");
T("a drive and a serial dongle become nodes", hw().map((n) => n.label), ["Generic USB 3.0 Disk", "Zigbee Coordinator USB Dongle"]);
T("a drive carries its filesystem labels", hw()[0].labels, ["MEDIA"]);
T("no discovered device lands on top of the host",
  hw().some((n) => Math.abs(n.x - 610) < 60 && n.y === 150), false);
T("ownership is derived from the add-on's own nested options",
  c._derived.edges.filter((e) => e[0].startsWith("hw_tty")).map((e) => [e[1], e[2].label]),
  [[addonId("a0d7b954_zigbee2mqtt"), "owns (serial.port)"]]);
T("every discovered device hangs off the host",
  c._derived.edges.filter((e) => e[0] === "host").length, 2);
// --- the Samba republish chain --------------------------------------------
const drive = () => c._derived.nodes.find((n) => n.id.startsWith("hw_drive"));
const edgeLabels = (from, to) =>
  c._derived.edges.filter((e) => (!from || e[0] === from) && (!to || e[1] === to)).map((e) => e[2].label);

T("a disk referenced by filesystem label, not path, is still matched",
  drive().usedBy.find((u) => u.slug === "d1c2b3a4_samba_nas")?.option, "moredisks");
T("the SMB server owns the drive",
  edgeLabels(drive().id, addonId("d1c2b3a4_samba_nas")), ["serves (moredisks)"]);
// The share is a node of its own, so the chain reads disk -> exporter ->
// share -> consumers rather than being implied by two edge labels.
const shareNode = () => c._derived.nodes.find((n) => n.kind === "share");
T("the exported share becomes a node",
  [shareNode()?.label, shareNode()?.tier, shareNode()?.servedBy],
  ["MEDIA (SMB)", "services", "d1c2b3a4_samba_nas"]);
T("the exporting add-on is edged to the share it exports",
  edgeLabels(addonId("d1c2b3a4_samba_nas"), shareNode().id), ["exports"]);
T("consumers hang off the share, not the hardware",
  [edgeLabels(drive().id, addonId("d1c2b3a4_photoprism")), edgeLabels(shareNode().id, addonId("d1c2b3a4_photoprism"))],
  [[], ["mounts (external_library)"]]);
T("a consumer referencing the bare label resolves the same way",
  edgeLabels(shareNode().id, addonId("d1c2b3a4_jellyfin")), ["mounts (zim_dir)"]);
T("a share takes the state of the add-on exporting it",
  (() => {
    const state = (addonState) => {
      const card = newCard();
      card._addons.find((a) => a.slug === "d1c2b3a4_samba_nas").state = addonState;
      card._derive();
      return card._nodeState(card._derived.nodes.find((n) => n.kind === "share")).status;
    };
    return [state("started"), state("stopped")];
  })(), ["started", "stopped"]);
T("only one share node per exported share",
  c._derived.nodes.filter((n) => n.kind === "share").length, 1);
T("the drive detail separates who mounts it from who reaches it over SMB",
  drive().usedBy.map((u) => [u.name, u.via, u.share]),
  [["Samba NAS", null, null], ["PhotoPrism", "Samba NAS", "MEDIA"], ["Jellyfin", "Samba NAS", "MEDIA"]]);
T("a serial device with one claimant is still a direct owns edge",
  edgeLabels(c._derived.nodes.find((n) => n.id.startsWith("hw_tty")).id, addonId("a0d7b954_zigbee2mqtt")), ["owns (serial.port)"]);

// Without an SMB server in the picture, every claimant goes back to hanging
// off the drive directly - the old behaviour, unchanged.
T("no SMB server means direct edges for everyone",
  (() => {
    const plain = newCard();
    plain._addonInfoCache.set("d1c2b3a4_samba_nas", { name: "Samba NAS", options: { moredisks: ["MEDIA"] } });
    plain._derive();
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
    short._derive();
    return hw(short)[0].labels;
  })(), []);
T("a label must be the value or a path's last segment, not a substring",
  [
    ctx.matchDeviceValue("MEDIA", { labels: ["MEDIA"], paths: [] }),
    ctx.matchDeviceValue("/media/MEDIA/photos", { labels: ["MEDIA"], paths: ["/media/MEDIA"] }),
    ctx.matchDeviceValue("my MEDIA backup notes", { labels: ["MEDIA"], paths: [] }),
  ],
  ["MEDIA", "/media/MEDIA", null]);
T("servesSmb reads published ports, not the add-on name",
  [ctx.servesSmb({ network: { "445/tcp": 445 } }), ctx.servesSmb({ name: "samba", network: { "80/tcp": 80 } }), ctx.servesSmb(null)],
  [true, false, false]);

// A drive plus eight dongles needs a second hardware row, and everything
// below the hardware tier has to move down to make space for it.
const many = newCard({}, { extraDevices: Array.from({ length: 8 }, (_, i) => ({ ...DONGLE, by_id: `${DONGLE.by_id}_${i}` })) });
const tierTop = (card, tier) => Math.min(...card._derived.nodes.filter((n) => n.tier === tier).map((n) => n.y));
T("hardware wraps to a second row", new Set(hw(many).map((n) => n.y)).size, 2);
T("the tiers below are pushed down to clear the extra row",
  tierTop(many, "services") - tierTop(c, "services"), 182);
T("the host stays put whatever is discovered around it",
  [many._node("host").y, many._node("host").x], [150, 610]);
T("discovery off means no hardware nodes and no offset",
  (() => {
    const off = newCard({ discover_hardware: false });
    return [hw(off).length, tierTop(off, "services") === tierTop(c, "services")];
  })(), [0, true]);

// --- reading routes out of a log -------------------------------------------
// Verbatim from a real remotely-managed cloudflared: the ingress rules only
// ever appear in the log, as JSON escaped into a quoted log field, and the
// catch-all rule at the end has a service but no hostname.
const CLOUDFLARED_LOG = [
  "[13:58:22] INFO: Using Cloudflare Remote Management Tunnel",
  "[13:58:22] INFO: All app (add-on) configuration options except tunnel_token will be ignored.",
  "2026-09-02T12:58:22Z INF Starting tunnel tunnelID=8f1c0b2e-4a67-4d3b-9c05-1e2f3a4b5c6d",
  "2026-09-02T12:58:22Z INF Settings: map[metrics:0.0.0.0:36500 no-autoupdate:true token:*****]",
  '2026-09-02T12:58:22Z INF Updated to new configuration config="{\\"ingress\\":[{\\"hostname\\":\\"ha.example.com\\", \\"originRequest\\":{\\"noTLSVerify\\":true}, \\"service\\":\\"http://192.168.1.50:8123\\"}, {\\"hostname\\":\\"nas.example.com\\", \\"originRequest\\":{}, \\"service\\":\\"http://192.168.1.50:8080\\"}, {\\"hostname\\":\\"share.example.com\\", \\"service\\":\\"http://192.168.1.50:8095\\"}, {\\"service\\":\\"http_status:404\\"}], \\"warp-routing\\":{\\"enabled\\":false}}" version=15',
  '2026-09-02T12:58:32Z INF precheck component="DNS Resolution" status=pass target=region1.v2.argotunnel.com',
].join("\n");

T("ingress rules are read out of the log's escaped JSON",
  ctx.routesFromLog(CLOUDFLARED_LOG).map((r) => [r.hostname, r.service]),
  [
    ["ha.example.com", "http://192.168.1.50:8123"],
    ["nas.example.com", "http://192.168.1.50:8080"],
    ["share.example.com", "http://192.168.1.50:8095"],
  ]);
T("the catch-all rule is not a route", ctx.routesFromLog(CLOUDFLARED_LOG).length, 3);
T("a later configuration supersedes an earlier one",
  ctx.routesFromLog(
    CLOUDFLARED_LOG + '\n2026-09-02T13:00:00Z INF Updated to new configuration config="{\\"ingress\\":[{\\"hostname\\":\\"only.example.com\\", \\"service\\":\\"http://127.0.0.1:99\\"}]}" version=16'
  ).map((r) => r.hostname), ["only.example.com"]);
T("a log with no ingress config yields nothing", ctx.routesFromLog("INF nothing to see"), []);
T("a truncated config line is skipped rather than throwing",
  ctx.routesFromLog('INF Updated to new configuration config="{\\"ingr'), []);
T("only an add-on holding a tunnel credential has its log read",
  [
    ctx.looksLikeIngressProvider({ tunnel_token: "ey...", external_hostname: "" }),
    ctx.looksLikeIngressProvider({ workgroup: "WORKGROUP", moredisks: ["MEDIA"] }),
    ctx.looksLikeIngressProvider({ serial: { port: "/dev/ttyUSB0" } }),
  ], [true, false, false]);
T("a bare hostname option is a route to Home Assistant itself",
  ctx.collectRoutes({ external_hostname: "ha.example.com" }).map((r) => [r.hostname, r.service]),
  [["ha.example.com", "http://homeassistant:8123"]]);
T("an options-configured tunnel's additional hosts are routes",
  ctx.collectRoutes({ additional_hosts: [{ hostname: "s.example.com", service: "http://addon_x:3000" }] }).map((r) => r.service),
  ["http://addon_x:3000"]);
T("a version string is not mistaken for a hostname",
  [ctx.looksLikeHostname("1.4.2"), ctx.looksLikeHostname("mqtt"), ctx.looksLikeHostname("ha.example.com")],
  [false, false, true]);

// --- tiering, routes and layout, all derived -------------------------------
const tierOf = (card, slug) => card._node(addonId(slug))?.tier;
T("a DNS server is network infrastructure, by its port",
  tierOf(c, "a0d7b954_adguard"), "network");
T("an add-on with no recognised port is a service",
  [tierOf(c, "d1c2b3a4_photoprism"), tierOf(c, "d1c2b3a4_jellyfin")], ["services", "services"]);
T("an add-on publishing hostnames for other things is remote access",
  tierOf(c, "d1c2b3a4_cloudflared"), "remote");
T("an SMB server is still a service, not network infrastructure",
  tierOf(c, "d1c2b3a4_samba_nas"), "services");
T("the role read off the ports reaches the node's notes",
  c._node(addonId("core_mosquitto")).notes, ["Publishes MQTT broker"]);

// The tunnel points at the host's own LAN address, which is how a remotely
// managed cloudflared writes its rules - so routes resolve by port.
T("a route to the host's LAN address on 8123 resolves to the host",
  c._routes.find((r) => r.hostname === "ha.example.com")?.targetId, "host");
T("a route to the host's LAN address on an add-on's port resolves to that add-on",
  c._routes.find((r) => r.hostname === "nas.example.com")?.targetId, addonId("d1c2b3a4_photoprism"));
T("the public URL lands on what the tunnel actually reaches",
  [c._node("host").exposedUrl, c._node(addonId("d1c2b3a4_photoprism")).exposedUrl],
  ["https://ha.example.com", "https://nas.example.com"]);
// The edge exists but carries no label: the target node already wears the
// hostname, and printing it twice reads as two different facts.
T("the tunnel is edged to what it exposes, without repeating the hostname",
  c._derived.edges
    .filter((e) => e[0] === addonId("d1c2b3a4_cloudflared"))
    .map((e) => [e[1], e[2].label ?? null])
    .sort(),
  [["addon_d1c2b3a4_photoprism", null], ["host", null]]);
T("an unroutable rule exposes nothing",
  (() => {
    const stray = newCard({}, { logRoutes: [{ hostname: "x.example.com", service: "http://10.9.9.9:80", viaSlug: "d1c2b3a4_cloudflared" }] });
    return stray._routes[0].targetId;
  })(), null);

// Z2M's options name the broker: `mqtt://core-mosquitto:1883`.
T("one add-on naming another in its options becomes an edge",
  c._derived.edges.find((e) => e[0] === addonId("a0d7b954_zigbee2mqtt") && e[1] === addonId("core_mosquitto"))?.[2].label,
  "mqtt.server");
T("an add-on is not edged to itself",
  c._derived.edges.every((e) => e[0] !== e[1]), true);

T("a router integration is placed in the network tier by its device_tracker source_type",
  (() => {
    const net = newCard();
    net._entries.push({ entry_id: "e_router", domain: "asusrouter", title: "ASUS Router", state: "loaded" });
    net._entityRegistry.push({ entity_id: "device_tracker.phone", platform: "asusrouter", config_entry_id: "e_router" });
    net._hass.states["device_tracker.phone"] = { state: "home", attributes: { source_type: "router" } };
    net._derive();
    const node = net._derived.nodes.find((n) => n.kind === "integration" && n.domain === "asusrouter");
    return [node?.tier, node?.notes[0]];
  })(), ["network", "Reports 1 device as present on the network"]);
T("an integration with no router evidence stays in the grid",
  c._derived.nodes.some((n) => n.kind === "integration"), false);

T("every node gets a position",
  c._derived.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), true);
T("tiers stack in order down the page",
  (() => {
    const tops = ["hardware", "services", "network", "remote"]
      .map((t) => c._derived.nodes.filter((n) => n.tier === t))
      .filter((ns) => ns.length)
      .map((ns) => Math.min(...ns.map((n) => n.y)));
    return tops.every((y, i) => i === 0 || y > tops[i - 1]);
  })(), true);
T("layout is stable across repeated derivation",
  (() => {
    const before = c._derived.nodes.map((n) => `${n.id}@${n.x},${n.y}`).join("|");
    c._derive();
    return c._derived.nodes.map((n) => `${n.id}@${n.x},${n.y}`).join("|") === before;
  })(), true);
T("add-ons placed in a tier are not repeated in the leftovers grid",
  (() => {
    c._renderGraph();
    return c._addons.every((a) => !c._nodePositions.has(`addon:${a.slug}`));
  })(), true);

// --- reading a log --------------------------------------------------------
// Add-on logs are plain text and the WebSocket supervisor/api proxy speaks
// only JSON, so every read through it failed - and the old code returned the
// error message as though it were the log, which is why a failed read showed
// up as "log read (60 bytes)" with no rules in it.
const logCard = (fetchImpl, wsImpl) => {
  const card = newCard();
  card._hass.connection = {
    sendMessagePromise: async (msg) => {
      if (msg.type === "auth/sign_path") return { path: `${msg.path}?authSig=x` };
      if (wsImpl) return wsImpl(msg);
      throw new Error("not JSON");
    },
  };
  ctx.fetch = fetchImpl;
  return card;
};
T("a log is fetched over REST with a signed URL",
  await (async () => {
    const seen = [];
    const card = logCard(async (url) => {
      seen.push(url);
      return { ok: true, text: async () => "line one\nline two" };
    });
    const log = await card._fetchAddonLog("core_x", 0);
    return [seen, log];
  })(), [["/api/hassio/addons/core_x/logs?authSig=x"], "line one\nline two"]);
T("a failed read returns nothing and records why, rather than passing the error off as the log",
  await (async () => {
    const card = logCard(async () => ({ ok: false, status: 403 }));
    const log = await card._fetchAddonLog("core_x", 0);
    return [log, card._logErrors.get("core_x")];
  })(), [null, "HTTP 403"]);
T("an empty log is a failure with a reason, not an empty success",
  await (async () => {
    const card = logCard(async () => ({ ok: true, text: async () => "   " }));
    return [await card._fetchAddonLog("core_x", 0), card._logErrors.get("core_x")];
  })(), [null, "the log was empty"]);
T("the WebSocket proxy is still tried when signing is unavailable",
  await (async () => {
    const card = logCard(
      async () => { throw new Error("no fetch"); },
      async (msg) => (msg.type === "supervisor/api" ? "from the proxy" : (() => { throw new Error("x"); })())
    );
    return await card._fetchAddonLog("core_x", 0);
  })(), "from the proxy");
T("a scan reports a failed read as a failure, not as a zero-byte success",
  await (async () => {
    const card = newCard();
    card._fetchAddonLog = async (slug) => { card._logErrors.set(slug, "HTTP 403"); return null; };
    await card._loadRouteLogs();
    return card._routeScan.scanned.some((line) => line.includes("LOG COULD NOT BE READ"));
  })(), true);

// Matching an option name is reason enough to spend a log read, and nowhere
// near enough to call something an entry point: Let's Encrypt holds a
// Cloudflare API token for DNS challenges and is not a way in.
T("an option name alone does not move an add-on into remote access",
  await (async () => {
    const card = newCard({}, { logRoutes: [] });
    card._addons.push({ slug: "core_letsencrypt", name: "Let's Encrypt", state: "started" });
    card._addonInfoCache.set("core_letsencrypt", {
      name: "Let's Encrypt", network: {}, options: { dns: { provider: "dns-cloudflare" }, cloudflare_api_token: "x" },
    });
    card._fetchAddonLog = async () => "Certbot renewing certificates";
    await card._loadRouteLogs();
    card._derive();
    return card._node(addonId("core_letsencrypt")).tier;
  })(), "services");

// --- a way in is a way in, readable rules or not ----------------------------
// Tying the remote-access tier to successfully-parsed routes put a tunnel
// whose rules could not be read in among the ordinary services.
T("a tunnel whose rules cannot be read is still remote access",
  await (async () => {
    const card = newCard({}, { logRoutes: [] });
    card._addonInfoCache.set("d1c2b3a4_cloudflared", { name: "Cloudflared", network: {}, options: {} });
    card._fetchAddonLog = async (slug) =>
      slug === "d1c2b3a4_cloudflared"
        ? "INF Starting tunnel tunnelID=d159e957\nINF Registered tunnel connection connIndex=0"
        : "nothing of interest";
    await card._loadRouteLogs();
    card._derive();
    const node = card._node(addonId("d1c2b3a4_cloudflared"));
    return [node.tier, node.routes, node.notes.at(-1)];
  })(),
  ["remote", undefined, "Identified as a way in from outside, but none of its routes could be read"]);
T("and it is still one hop from the outside, labelled for what it is",
  await (async () => {
    const card = newCard({}, { logRoutes: [] });
    card._addonInfoCache.set("d1c2b3a4_cloudflared", { name: "Cloudflared", network: {}, options: {} });
    card._fetchAddonLog = async (slug) => (slug === "d1c2b3a4_cloudflared" ? "INF tunnelID=abc" : "");
    await card._loadRouteLogs();
    card._derive();
    return card._derived.edges.filter((e) => e[0] === "internet").map((e) => [e[1], e[2].label]);
  })(), [[addonId("d1c2b3a4_cloudflared"), "tunnel"]]);
T("the markers are narrow enough not to catch ordinary add-ons",
  [
    ctx.looksLikeTunnelLog("INF Starting tunnel tunnelID=abc"),
    ctx.looksLikeTunnelLog("Registered tunnel connection connIndex=0"),
    ctx.looksLikeTunnelLog("tailscaled starting"),
    ctx.looksLikeTunnelLog("[Api:RouterExplorer] Mapped {/api/ingress, GET} route"),
    ctx.looksLikeTunnelLog("Starting NGINX, ingress enabled"),
    ctx.looksLikeTunnelLog("nothing to see here"),
  ], [true, true, true, false, false, false]);
T("a readable tunnel still reports its hostnames rather than the fallback note",
  c._node(addonId("d1c2b3a4_cloudflared")).routes.length, 2);

// --- route resolution, step by step ----------------------------------------
// A private address is this machine whatever /network/info said. Depending on
// that endpoint having answered - and having named the same interface the
// tunnel rule points at - is the difference between every hostname landing
// and none of them landing.
T("a private address is recognised without help from /network/info",
  [
    ctx.isPrivateAddress("192.168.1.50"), ctx.isPrivateAddress("10.0.0.4"),
    ctx.isPrivateAddress("172.30.33.4"), ctx.isPrivateAddress("127.0.0.1"),
    ctx.isPrivateAddress("172.15.0.1"), ctx.isPrivateAddress("8.8.8.8"),
  ], [true, true, true, true, false, false]);
T("a rule resolves even when the network endpoint told us nothing",
  (() => {
    const blind = newCard();
    blind._system.network = null; // /network/info failed or was empty
    blind._derive();
    return blind._routes.find((r) => r.hostname === "nas.example.com")?.targetId;
  })(), addonId("d1c2b3a4_photoprism"));

T("every rule records why it landed where it did",
  c._routes.map((r) => [r.hostname, r.trace.reason]),
  [
    ["ha.example.com", "port 8123 is Home Assistant's own"],
    ["nas.example.com", "port 8080 is published by this add-on"],
  ]);
T("an unmatched rule says what it was looking for and what was on offer",
  (() => {
    const stray = newCard({}, {
      logRoutes: [{ hostname: "x.example.com", service: "http://192.168.1.50:7777", viaSlug: "d1c2b3a4_cloudflared" }],
    });
    const t = stray._routes[0].trace;
    return [t.reason, t.port, t.local, t.candidates.some((line) => line.startsWith("PhotoPrism:"))];
  })(), ["no add-on reports port 7777", 7777, true, true]);
T("a rule pointing off this machine says so rather than failing silently",
  (() => {
    const off = newCard({}, {
      logRoutes: [{ hostname: "y.example.com", service: "http://203.0.113.9:80", viaSlug: "d1c2b3a4_cloudflared" }],
    });
    return off._routes[0].trace.reason;
  })(), "203.0.113.9 is not this machine, so the rule points somewhere else");

// A remotely-managed tunnel can be configured entirely outside Home
// Assistant, leaving an add-on whose options say nothing at all.
T("logs are scanned even when no add-on's options look like a tunnel",
  await (async () => {
    const card = newCard();
    card._addonInfoCache.set("d1c2b3a4_cloudflared", { name: "Cloudflared", network: {}, options: {} });
    const read = [];
    card._fetchAddonLog = async (slug) => {
      read.push(slug);
      return slug === "d1c2b3a4_cloudflared"
        ? 'INF config="{\\"ingress\\":[{\\"hostname\\":\\"found.example.com\\", \\"service\\":\\"http://192.168.1.50:8080\\"}]}"'
        : "nothing";
    };
    await card._loadRouteLogs();
    return [card._routeScan.fallback, card._logRoutes.map((r) => r.hostname), read.length > 1];
  })(), [true, ["found.example.com"], true]);
T("the cheap path is still the usual one",
  await (async () => {
    const card = newCard();
    const read = [];
    card._fetchAddonLog = async (slug) => {
      read.push(slug);
      return 'INF config="{\\"ingress\\":[{\\"hostname\\":\\"a.example.com\\", \\"service\\":\\"http://192.168.1.50:8080\\"}]}"';
    };
    await card._loadRouteLogs();
    return [card._routeScan.fallback, read];
  })(), [false, ["d1c2b3a4_cloudflared"]]);

// --- cards -----------------------------------------------------------------
T("a node is drawn as a card, with the hostname as its own pill",
  (() => {
    const card = newCard();
    card._renderGraph();
    const svg = card._els.get(".smc-graph").innerHTML;
    return [
      svg.includes('class="smc-card"'),
      svg.includes('class="smc-host-pill"'),
      svg.includes(">nas.example.com<"),
      svg.includes('class="smc-card-stripe"'),
    ];
  })(), [true, true, true, true]);
T("the hostname pill is filled by a rule of its own, not left to the HTML pill's",
  // It once shared the status bar's .smc-pill class, whose `background`
  // means nothing to an SVG rect - so the pill painted black on black and
  // the hostname read as an ordinary sub-line.
  [/\.smc-host-pill\s*\{[^}]*fill:/.test(src), /\.smc-host-pill-text\s*\{[^}]*fill:/.test(src)],
  [true, true]);
T("the hostname appears once - as the pill, not also as a plain sub-line",
  (() => {
    const card = newCard();
    card._renderGraph();
    return (card._els.get(".smc-graph").innerHTML.match(/>nas\.example\.com</g) || []).length;
  })(), 1);
T("a card records its own box, so labels and panning use the real shape",
  (() => {
    const card = newCard();
    card._renderGraph();
    const pos = card._nodePositions.get(`node:${addonId("d1c2b3a4_photoprism")}`);
    return [pos.w, pos.h];
  })(), [148, 144]);
T("the host card is the larger one",
  (() => {
    const card = newCard();
    card._renderGraph();
    const pos = card._nodePositions.get("node:host");
    return [pos.w, pos.h];
  })(), [166, 152]);

T("a long name wraps rather than overflowing",
  ctx.wrapLabel("Advanced SSH & Web Terminal", 17), ["Advanced SSH &", "Web Terminal"]);
T("a name too long for two lines is truncated, not dropped",
  ctx.wrapLabel("PhotoPrism Machine Learning OpenVINO Extended Edition", 17).length, 2);
T("a short name stays on one line", ctx.wrapLabel("Jellyfin", 17), ["Jellyfin"]);
T("an empty name does not produce a broken line", ctx.wrapLabel("", 17), [""]);

// --- add-on icons ----------------------------------------------------------
// Supervisor serves each add-on's own icon, but the endpoint needs auth an
// <image> tag cannot send - hence the signed URL, exactly as HA's own
// frontend does it.
T("an icon URL is signed for every add-on that ships one",
  await (async () => {
    const card = newCard();
    const asked = [];
    card._hass.connection = {
      sendMessagePromise: async (msg) => {
        asked.push(msg.path);
        return { path: `${msg.path}?authSig=xyz` };
      },
    };
    card._addons = [
      { slug: "a_with", name: "Has icon", state: "started", icon: true },
      { slug: "b_without", name: "No icon", state: "started", icon: false },
    ];
    await card._loadAddonIcons();
    return [asked, [...card._addonIcons.keys()]];
  })(),
  [["/api/hassio/addons/a_with/icon"], ["a_with"]]);
T("a failure to sign leaves the derived icon in place rather than a blank",
  await (async () => {
    const card = newCard();
    card._hass.connection = { sendMessagePromise: async () => { throw new Error("nope"); } };
    card._addons = [{ slug: "a_with", name: "Has icon", state: "started", icon: true }];
    await card._loadAddonIcons();
    return card._addonIcons.size;
  })(), 0);
T("the add-on's own icon is drawn when there is one, and the derived one when not",
  (() => {
    const card = newCard();
    card._addonIcons.set("d1c2b3a4_photoprism", "/api/hassio/addons/d1c2b3a4_photoprism/icon?authSig=xyz");
    card._renderGraph();
    const svg = card._els.get(".smc-graph").innerHTML;
    return [svg.includes("<image href=\"/api/hassio/addons/d1c2b3a4_photoprism/icon?authSig=xyz\""), svg.includes("clip-path=\"url(#smc-icon-clip)\"")];
  })(), [true, true]);

// --- host networking -------------------------------------------------------
// An add-on running on the host network publishes nothing through `network`
// (the field is null). That is the normal case for Samba and for several
// media add-ons, and it silently broke both the share detection and every
// tunnel rule pointing at one of their ports.
T("ports are found in a web-UI template when there is no port mapping",
  [...ctx.hostPortsFor({ network: null, webui: "http://[HOST]:8080/" })], [8080]);
T("a container port in a template resolves through the mapping when there is one",
  [...ctx.hostPortsFor({ network: { "3001/tcp": 8080 }, webui: "http://[HOST]:[PORT:3001]/" })], [8080]);
T("and is taken literally when there is not",
  [...ctx.hostPortsFor({ network: null, webui: "http://[HOST]:[PORT:3001]/" })], [3001]);
T("an ingress port counts as reachable",
  [...ctx.hostPortsFor({ ingress_port: 8099 })], [8099]);
T("no evidence at all means no ports, not a guess",
  [...ctx.hostPortsFor({ network: null })], []);

T("a host-networked Samba is still recognised as an SMB server",
  [
    ctx.servesSmb({ network: null, options: { workgroup: "WORKGROUP", moredisks: ["MEDIA"] } }),
    ctx.servesSmb({ network: { "445/tcp": 445 }, options: {} }),
    ctx.servesSmb({ network: null, options: { workgroup_size: 4 } }),
    ctx.servesSmb({ network: null, options: { zim_dir: "MEDIA" } }),
  ], [true, true, false, false]);

T("a host-networked exporter still produces the share and its consumers",
  (() => {
    const hostNet = newCard();
    hostNet._addonInfoCache.set("d1c2b3a4_samba_nas", {
      name: "Samba NAS", network: null, options: { workgroup: "WORKGROUP", moredisks: ["MEDIA"] },
    });
    hostNet._derive();
    const share = hostNet._derived.nodes.find((n) => n.kind === "share");
    return [share?.label, hostNet._derived.edges.filter((e) => e[0] === share?.id).length];
  })(), ["MEDIA (SMB)", 2]);

// Attributing every unresolved rule to Home Assistant put someone else's
// subdomain on the host and left the real add-on with no hostname at all.
T("only Home Assistant's own port resolves to Home Assistant",
  (() => {
    const card = newCard();
    const addons = card._derived.nodes.filter((n) => n.kind === "addon");
    return [
      card._resolveService("http://192.168.1.50:8123", addons)?.id,
      card._resolveService("http://192.168.1.50:9999", addons),
    ];
  })(), ["host", null]);
T("a rule pointing at an add-on's own container address resolves to it",
  (() => {
    const card = newCard();
    card._addonInfoCache.get("d1c2b3a4_photoprism").ip_address = "172.30.33.9";
    card._derive();
    const addons = card._derived.nodes.filter((n) => n.kind === "addon");
    return card._resolveService("http://172.30.33.9:3001", addons)?.id;
  })(), addonId("d1c2b3a4_photoprism"));

// Even when a rule cannot be attributed, the hostname must still be visible.
T("a tunnel wears its hostnames whether or not they resolve",
  (() => {
    const stray = newCard({}, {
      logRoutes: [
        { hostname: "a.example.com", service: "http://192.168.1.50:8080", viaSlug: "d1c2b3a4_cloudflared" },
        { hostname: "b.example.com", service: "http://192.168.1.50:9999", viaSlug: "d1c2b3a4_cloudflared" },
      ],
    });
    const tunnel = stray._node(addonId("d1c2b3a4_cloudflared"));
    return [tunnel.routes.length, stray._nodeState(tunnel).sub, tunnel.notes.includes("b.example.com → http://192.168.1.50:9999")];
  })(), [2, "2 hostnames · 1 unmatched", true]);

// --- the boundary ----------------------------------------------------------
// "Which of these is a way in?" should be answerable from the shape of the
// map, not by reading tier labels.
const internet = (card = c) => card._derived.nodes.find((n) => n.kind === "internet");
T("the outside world is drawn as a node once anything is reachable from it",
  [internet()?.label, internet()?.tier, internet()?.badge],
  ["Internet", "remote", "OUTSIDE"]);
T("every entry point is one hop from the outside",
  c._derived.edges.filter((e) => e[0] === "internet").map((e) => [e[1], e[2].label]),
  [[addonId("d1c2b3a4_cloudflared"), "2 hostnames"]]);
T("a VPN add-on is an entry point even with no hostnames",
  (() => {
    const vpn = newCard({}, { logRoutes: [] });
    vpn._addons.push({ slug: "d1c2b3a4_tailscale", name: "Tailscale", state: "started" });
    vpn._addonInfoCache.set("d1c2b3a4_tailscale", { name: "Tailscale", network: { "41641/udp": 41641 }, options: {} });
    vpn._derive();
    return vpn._derived.edges.filter((e) => e[0] === "internet").map((e) => e[2].label);
  })(), ["VPN"]);
T("no way in means no boundary node - nothing to assert",
  (() => {
    const closed = newCard({}, { logRoutes: [] });
    closed._addons = closed._addons.filter((a) => a.slug !== "d1c2b3a4_cloudflared");
    closed._derive();
    return internet(closed);
  })(), undefined);
T("the boundary counts the ways in and the hostnames behind them",
  internet().notes, ["1 way in from outside", "2 public hostnames"]);

// The subdomain belongs on the node, not buried in a detail panel.
// "On the LAN" and "also public" are different facts, so both get a line.
T("an exposed service shows its LAN address and its public hostname",
  (() => {
    const node = c._node(addonId("d1c2b3a4_photoprism"));
    return [node.badge, c._nodeState(node).subs];
  })(), ["nas.example.com", ["192.168.1.50:8080", "nas.example.com"]]);
// Asserted as a rule over every node rather than for one add-on, because
// "it works for PhotoPrism" was true while the host, a host-networked Samba and
// the share itself all showed nothing.
T("every node with a resolved route shows that hostname",
  c._derived.nodes
    .filter((n) => n.hostname)
    .filter((n) => !c._nodeState(n).subs.includes(n.hostname))
    .map((n) => n.label), []);
T("every node we know an address for shows it",
  c._derived.nodes
    .filter((n) => n.lan)
    .filter((n) => !c._nodeState(n).subs.includes(n.lan))
    .map((n) => n.label), []);
T("Home Assistant shows its own LAN address, not only its public name",
  c._nodeState(c._node("host")).subs, ["192.168.1.50:8123", "ha.example.com"]);
T("a host-networked SMB server still gets an address, from the protocol",
  (() => {
    const hostNet = newCard();
    hostNet._addonInfoCache.set("d1c2b3a4_samba_nas", {
      name: "Samba NAS", network: null, options: { workgroup: "WG", moredisks: ["MEDIA"] },
    });
    hostNet._derive();
    return hostNet._nodeState(hostNet._node(addonId("d1c2b3a4_samba_nas"))).subs;
  })(), ["192.168.1.50:445"]);
T("a share shows the address you would actually type",
  c._nodeState(c._derived.nodes.find((n) => n.kind === "share")).subs, ["\\\\192.168.1.50\\MEDIA"]);

T("a LAN-only service shows just its address",
  c._nodeState(c._node(addonId("core_mosquitto"))).subs.includes("192.168.1.50:1883"), true);
T("a service with no reachable port shows neither",
  c._nodeState(c._node(addonId("d1c2b3a4_jellyfin"))).subs.some((l) => l.includes(":")), false);
T("a problem still comes first",
  c._nodeState(c._node(addonId("core_mosquitto"))).subs[0], "1/2 unavailable");
T("no more than three lines are ever drawn under a node",
  c._derived.nodes.every((n) => c._nodeState(n).subs.length <= 3), true);
T("Home Assistant itself wears the hostname routed to port 8123",
  [c._node("host").badge, c._node("host").exposedUrl],
  ["ha.example.com", "https://ha.example.com"]);
T("a node with no route has no hostname badge",
  c._node(addonId("d1c2b3a4_jellyfin")).badge, undefined);
T("the status bar says how much is reachable from outside",
  (() => {
    const item = c._statusItems().find((i) => i.key === "exposed");
    return [item?.value, item?.note.includes("nas.example.com")];
  })(), ["2 hostnames", true]);

// --- reading services out of a log -----------------------------------------
// PhotoPrism announces its machine-learning sidecar at runtime rather than in its
// options: "Machine learning server became healthy (http://192.168.1.50:3004)".
const IMMICH_LOG = [
  "[Nest] LOG [Api:Bootstrap] PhotoPrism Server is listening on http://127.0.0.1:2283 [v3.1.0] [production]",
  "[Nest] LOG [Api:MachineLearningRepository] Machine learning server became healthy (http://192.168.1.50:3004).",
  "[Nest] LOG [Microservices:MachineLearningRepository] Machine learning server became healthy (http://192.168.1.50:3004).",
  '[Nest] LOG [Api:StorageService] Verifying system mount folder checks: {"mountChecks":{"library":true}}',
].join("\n");

T("host:port endpoints are read out of a log and deduplicated",
  ctx.servicesFromLog(IMMICH_LOG).map((d) => d.service),
  ["http://127.0.0.1:2283", "http://192.168.1.50:3004"]);
// A URL carrying credentials is skipped outright rather than stripped: the
// map is not worth the risk of rendering a secret someone logged.
T("a URL with embedded credentials is ignored entirely",
  ctx.servicesFromLog("connecting to https://user:secret@example.com:8443/private?token=abc"), []);
T("only the host and port survive - never a path or query",
  ctx.servicesFromLog("GET http://example.com:8443/private?token=abc").map((d) => d.service),
  ["http://example.com:8443"]);
T("a log with no endpoints yields nothing", ctx.servicesFromLog("nothing here"), []);

T("an endpoint named in a log becomes an edge to the add-on serving that port",
  (() => {
    const dial = newCard({ scan_service_logs: true });
    dial._addons.push({ slug: "d1c2b3a4_thumbnailer", name: "Thumbnail worker", state: "started" });
    dial._addonInfoCache.set("d1c2b3a4_thumbnailer", { name: "Thumbnail worker", network: { "3003/tcp": 3004 }, options: {} });
    dial._logServices = [{ service: "http://192.168.1.50:3004", host: "192.168.1.50", port: 3004, fromSlug: "d1c2b3a4_photoprism" }];
    dial._derive();
    return dial._derived.edges
      .filter((e) => e[0] === addonId("d1c2b3a4_photoprism") && e[1] === addonId("d1c2b3a4_thumbnailer"))
      .map((e) => e[2].label);
  })(), [":3004 (log)"]);
T("an endpoint that resolves to the host itself is not drawn",
  (() => {
    const dial = newCard({ scan_service_logs: true });
    dial._logServices = [{ service: "http://192.168.1.50:8123", host: "192.168.1.50", port: 8123, fromSlug: "d1c2b3a4_photoprism" }];
    dial._derive();
    return dial._derived.edges.some((e) => e[0] === addonId("d1c2b3a4_photoprism") && e[1] === "host");
  })(), false);

// --- the evidence panel ----------------------------------------------------
T("the evidence panel reports what was seen per add-on",
  (() => {
    const dbg = newCard({ show_debug: true });
    const body = makeEl();
    const outer = dbg.querySelector;
    dbg.querySelector = (sel) => (sel === ".smc-debug-body" ? body : outer(sel));
    dbg._renderDebug();
    return [
      body.innerHTML.includes("Samba NAS"),
      body.innerHTML.includes("445/tcp"),
      body.innerHTML.includes("SMB file server"),
      body.innerHTML.includes("ha.example.com"),
      body.innerHTML.includes("moredisks"),
    ];
  })(), [true, true, true, true, true]);
T("the evidence panel is absent unless asked for",
  (() => {
    const off = newCard();
    let threw = false;
    try { off._renderDebug(); } catch (e) { threw = true; }
    return threw;
  })(), false);

// --- problem join ----------------------------------------------------------
// The mqtt entities resolve to whichever add-on publishes 1883 - derived
// from the port, with no table saying which add-on that is here.
T("a dead mqtt entity flags the add-on that serves the protocol",
  c._problemFor(`node:${addonId("core_mosquitto")}`),
  { severity: "bad", label: "1/2 unavailable", badge: "1", reason: "1 of 2 entities are unavailable or unknown" });
T("an open repair issue flags its integration",
  c._problemFor("entry:e_hue")?.label, "1 repair issue");
T("a healthy integration is not flagged", c._problemFor("entry:e_mjpeg"), null);
T("problem highlighting can be turned off",
  newCard({ highlight_problems: false })._problemFor(`node:${addonId("core_mosquitto")}`), null);
T("system health lands on the node its domain resolves to",
  c._problems.get(`node:${addonId("core_mosquitto")}`)?.health, { broker: "core-mosquitto", connected: true });

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
T("counts reach the node sub-label",
  c._nodeState(c._node(addonId("core_mosquitto"))).sub, "1/2 unavailable");

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
T("discovered hardware is drawn", svg.includes('data-node="hw_drive_drive_media"'), true);
T("a flagged node gets the problem class", svg.includes("smc-problem"), true);
// The invariant is "nothing on this instance is missing from the map", not
// "one circle per config entry" - the map draws one node per integration now.
T("every config entry is still represented on the map",
  c._entries.every((e) => c._nodePositions.has(`domain:${e.domain}`)), true);
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

// --- pending updates -------------------------------------------------------
// HA reports an add-on update twice: as an update.* entity named
// "<Add-on> Update", and as the add-on's own update_available flag named
// "<Add-on>". One update was being counted as two.
const updatesFor = (states, addons) => {
  const card = newCard();
  card._hass = { states };
  if (addons) card._addons = addons;
  return card._pendingUpdates();
};
T("an add-on update reported by both routes counts once",
  updatesFor(
    { "update.zigbee2mqtt_update": { state: "on", attributes: { friendly_name: "Zigbee2MQTT Update" } } },
    [{ slug: "a0d7b954_zigbee2mqtt", name: "Zigbee2MQTT", update_available: true }]
  ),
  ["Zigbee2MQTT"]);
T("the trailing word is stripped from the display name",
  updatesFor({ "update.core": { state: "on", attributes: { friendly_name: "Home Assistant Core Update" } } }, []),
  ["Home Assistant Core"]);
T("genuinely different updates are all counted",
  updatesFor(
    {
      "update.zigbee2mqtt_update": { state: "on", attributes: { friendly_name: "Zigbee2MQTT Update" } },
      "update.core": { state: "on", attributes: { friendly_name: "Home Assistant Core Update" } },
      "update.quiet": { state: "off", attributes: { friendly_name: "Not Pending" } },
    },
    [{ slug: "a0d7b954_zigbee2mqtt", name: "Zigbee2MQTT", update_available: true }]
  ).sort(),
  ["Home Assistant Core", "Zigbee2MQTT"]);
T("nothing pending is an empty list", updatesFor({}, []), []);

// --- edge label placement --------------------------------------------------
T("labels converging on one point are separated",
  (() => {
    const card = newCard();
    const placed = card._placeEdgeLabels(
      [
        { text: "serves (moredisks)", x: 600, y: 200 },
        { text: "admin access", x: 600, y: 200 },
        { text: "MEDIA (SMB loop)", x: 600, y: 200 },
      ],
      []
    );
    const ys = placed.map((l) => l.y);
    return new Set(ys).size === ys.length;
  })(), true);
T("a label is moved off a node it would otherwise be written across",
  (() => {
    const card = newCard();
    const [label] = card._placeEdgeLabels([{ text: "disk", x: 610, y: 150 }], [{ x: 610, y: 150, r: 62 }]);
    return Math.abs(label.y - 150) > 62;
  })(), true);
T("a label with nothing in its way keeps its own midpoint",
  newCard()._placeEdgeLabels([{ text: "USB", x: 300, y: 400 }], [])[0].y, 400);
T("with every slot blocked, a label still moves to the least-buried one",
  (() => {
    // A continuous wall of small nodes means no candidate is free, so the
    // label has to be ranked rather than given up on. One big node sits on
    // the midpoint, making that specific slot strictly the worst - staying
    // put would be the old behaviour and is what this catches.
    const card = newCard();
    const wall = Array.from({ length: 24 }, (_, i) => ({ x: 500, y: 120 + i * 30, r: 2 }));
    const [label] = card._placeEdgeLabels([{ text: "buried", x: 500, y: 360 }], [...wall, { x: 500, y: 360, r: 70 }]);
    return label.y !== 360;
  })(), true);
T("adjacent labels are separated even when their boxes only touch",
  (() => {
    const card = newCard();
    const placed = card._placeEdgeLabels(
      [{ text: "admin access", x: 560, y: 240 }, { text: "serves (moredisks)", x: 610, y: 240 }],
      []
    );
    return placed[0].y !== placed[1].y;
  })(), true);
T("placement never reorders the labels",
  newCard()
    ._placeEdgeLabels([{ text: "a", x: 0, y: 0 }, { text: "b", x: 0, y: 0 }, { text: "c", x: 0, y: 0 }], [])
    .map((l) => l.text),
  ["a", "b", "c"]);

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
  })(), [8, 8, 4]);

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

// --- pinch to zoom ---------------------------------------------------------
// A phone has no wheel and no zoom buttons worth hitting, so the pinch is the
// whole zoom story there. Two things can break independently: the anchor
// maths (the map drifts out from under the fingers) and the wiring (the
// second finger never starts a pinch at all), so both are asserted.

// Stubbed so that user space and client space coincide - the CTM is the
// identity - which makes the expected numbers below readable by hand.
function pinchCard() {
  const card = newCard();
  const wrap = makeEl();
  wrap.setPointerCapture = () => {};
  wrap.releasePointerCapture = () => {};
  const svg = {
    clientWidth: 400,
    clientHeight: 300,
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getScreenCTM: () => ({ inverse: () => ({}) }),
    createSVGPoint: () => ({
      x: 0,
      y: 0,
      matrixTransform() {
        const vb = card._viewBox;
        return { x: vb.x + (this.x / 400) * vb.w, y: vb.y + (this.y / 300) * vb.h };
      },
    }),
  };
  const extra = new Map([
    [".smc-graph-wrap", wrap], [".smc-graph svg", svg],
    [".smc-zoom-in", makeEl()], [".smc-zoom-out", makeEl()],
    [".smc-zoom-reset", makeEl()], [".smc-export", makeEl()],
  ]);
  const base = card.querySelector;
  card.querySelector = (sel) => extra.get(sel) || base(sel);
  card._naturalViewBox = { x: 0, y: 0, w: 400, h: 300 };
  card._viewBox = { ...card._naturalViewBox };
  card._buildZoomPan();
  const at = (x, y) => ({ x, y });
  const send = (type, id, x, y, target) =>
    (wrap._listeners[type] || []).forEach((fn) =>
      fn({ pointerId: id, clientX: x, clientY: y, preventDefault() {}, target: target || { closest: () => null } })
    );
  return { card, wrap, svg, send, at };
}

// Fingers 200px apart around (200,150), spread to 300px apart: the view
// narrows by exactly 200/300, and (200,150) is still the middle of it.
const spread = (() => {
  const { card, send } = pinchCard();
  send("pointerdown", 1, 100, 150);
  send("pointerdown", 2, 300, 150);
  send("pointermove", 1, 50, 150);
  send("pointermove", 2, 350, 150);
  return card._viewBox;
})();
T("spreading two fingers zooms in", Math.round(spread.w), 267);
T("a pinch keeps the viewBox aspect ratio", Math.round((spread.w / spread.h) * 1e6), Math.round((400 / 300) * 1e6));
T("the point under the fingers stays under the fingers",
  [Math.round(spread.x + spread.w / 2), Math.round(spread.y + spread.h / 2)], [200, 150]);

T("bringing two fingers together zooms out",
  (() => {
    const { card, send } = pinchCard();
    card._viewBox = { x: 100, y: 75, w: 200, h: 150 };
    send("pointerdown", 1, 50, 150);
    send("pointerdown", 2, 350, 150);
    send("pointermove", 1, 100, 150);
    send("pointermove", 2, 300, 150);
    return Math.round(card._viewBox.w);
  })(), 300);

T("a pinch cannot zoom in past the close limit, or out past the whole map",
  (() => {
    const zoomIn = pinchCard();
    zoomIn.send("pointerdown", 1, 190, 150);
    zoomIn.send("pointerdown", 2, 210, 150);
    zoomIn.send("pointermove", 1, 0, 150);
    zoomIn.send("pointermove", 2, 400, 150);
    const zoomOut = pinchCard();
    zoomOut.send("pointerdown", 1, 0, 150);
    zoomOut.send("pointerdown", 2, 400, 150);
    zoomOut.send("pointermove", 1, 199, 150);
    zoomOut.send("pointermove", 2, 201, 150);
    return [Math.round(zoomIn.card._viewBox.w), zoomOut.card._viewBox.w];
  })(), [48, 400]);

T("one finger still pans, and does not pinch against itself",
  (() => {
    const { card, send } = pinchCard();
    card._viewBox = { x: 100, y: 75, w: 200, h: 150 }; // zoomed in: there is something to pan
    send("pointerdown", 1, 200, 150);
    send("pointermove", 1, 150, 150);
    return [card._viewBox.w, card._viewBox.x];
  })(), [200, 125]);

// A view already showing the whole map has nothing to scroll, and dragging
// it used to slide the map off into empty space.
T("panning a fully zoomed-out view moves nothing",
  (() => {
    const { card, send } = pinchCard();
    send("pointerdown", 1, 200, 150);
    send("pointermove", 1, 150, 150);
    return [card._viewBox.x, card._viewBox.y];
  })(), [0, 0]);

T("panning stops at the edge of the map rather than scrolling past it",
  (() => {
    const { card, send } = pinchCard();
    card._viewBox = { x: 100, y: 75, w: 200, h: 150 };
    send("pointerdown", 1, 200, 150);
    send("pointermove", 1, 2000, 150); // a long drag to the right
    return card._viewBox.x;
  })(), 0);

// The drag in flight holds pointer capture and its own start position; left
// running, it would pan the map against the pinch on every move.
T("a second finger takes over from a drag already in progress",
  (() => {
    const { card, send } = pinchCard();
    card._viewBox = { x: 100, y: 75, w: 200, h: 150 };
    send("pointerdown", 1, 100, 150);
    send("pointermove", 1, 60, 150); // past the drag threshold: now panning
    const panned = card._viewBox.x;
    send("pointerdown", 2, 300, 150);
    send("pointermove", 1, 10, 150);
    send("pointermove", 2, 350, 150);
    return [panned !== 100, Math.round(card._viewBox.w) < 200];
  })(), [true, true]);

// Lifting one finger must not hand the map to the other where that finger
// *started*, or the map jumps by however far it travelled during the pinch.
T("lifting to one finger resumes panning from where that finger now is",
  (() => {
    const { card, send } = pinchCard();
    send("pointerdown", 1, 100, 150);
    send("pointerdown", 2, 300, 150);
    send("pointermove", 1, 50, 150);
    send("pointermove", 2, 350, 150);
    const afterPinch = { ...card._viewBox };
    send("pointerup", 2, 350, 150);
    send("pointermove", 1, 50, 150); // hasn't moved since: nothing should shift
    return [card._viewBox.x === afterPinch.x, card._viewBox.w === afterPinch.w];
  })(), [true, true]);

T("the finger lift that ends a pinch does not open a node's detail panel",
  (() => {
    const { card, send } = pinchCard();
    let opened = null;
    card._openDetail = (kind, id) => { opened = [kind, id]; };
    send("pointerdown", 1, 100, 150);
    send("pointerdown", 2, 300, 150);
    send("pointerup", 2, 300, 150);
    const node = { closest: (sel) => (sel === "[data-node]" ? { getAttribute: () => "host" } : null) };
    const click = () => card._onCardClick({ target: node });
    click();
    const duringGesture = opened;
    // ...and only that one click: the next real tap must still select.
    click();
    return [duringGesture, opened];
  })(), [null, ["node", "host"]]);


// --- export ----------------------------------------------------------------
// The export used to carry the card's stylesheet into the file and filter out
// the rules that could not apply there. That made a correct picture depend on
// parsing CSS correctly, and every way the parse could go wrong showed up as
// an image that looked nothing like the card, silently. The styles are read
// off the live elements now, so there is nothing to parse and no stylesheet
// for the file to depend on.
T("the export carries the properties that decide how an SVG is drawn",
  ["fill", "stroke", "stroke-width", "font-size", "font-family", "text-anchor", "opacity"].every((p) =>
    __EXPORT.SVG_PAINT_PROPS.includes(p)
  ), true);
T("it does not carry interaction-only properties into a still image",
  ["cursor", "pointer-events", "transition"].some((p) => __EXPORT.SVG_PAINT_PROPS.includes(p)), false);
T("the export no longer builds a stylesheet at all",
  /svgOnlyCss|resolveCssVars/.test(src), false);
// --- selection focus -------------------------------------------------------
// "What is this connected to" is the question a diagram exists to answer, and
// it was unanswerable: selecting a node opened a panel and left two dozen
// identical grey lines on screen.

const SHARE = "share_d1c2b3a4_samba_nas_media"; // exported by Samba, mounted by PhotoPrism and Jellyfin
const focused = (() => {
  const card = newCard();
  card._openDetail("node", SHARE);
  card._renderGraph();
  return card;
})();
const focusedSvg = focused._els.get(".smc-graph").innerHTML;

T("selecting a node marks its own edges hot",
  (focusedSvg.match(/smc-edge-hot/g) || []).length, 3);
T("an edge that does not touch the selection is dimmed, not hot",
  // host->disk is nowhere near the share, so it must be one of the dimmed ones.
  /<line class="smc-edge[^"]*smc-dim"/.test(focusedSvg), true);
T("the selected node and its neighbours stay lit",
  [SHARE, "addon_d1c2b3a4_samba_nas", "addon_d1c2b3a4_photoprism", "addon_d1c2b3a4_jellyfin"].map((id) =>
    new RegExp(`class="[^"]*smc-hi[^"]*" data-node="${id}"`).test(focusedSvg)
  ), [true, true, true, true]);
T("a node with no connection to the selection is dimmed",
  /class="[^"]*smc-dim[^"]*" data-node="addon_a0d7b954_adguard"/.test(focusedSvg), true);
T("the labels on hot edges are picked out too",
  (focusedSvg.match(/smc-edge-label-hot/g) || []).length, 3);

T("closing the panel releases the focus",
  (() => {
    const card = newCard();
    card._openDetail("node", SHARE);
    card._closeDetail();
    card._renderGraph();
    return card._els.get(".smc-graph").innerHTML.includes("smc-edge-hot");
  })(), false);

// The two are different claims - "these are joined" versus "both of these
// serve the entity you asked about" - so the finder's answer must not be
// overwritten by whatever node happens to be selected.
T("the entity finder's answer outranks a selected node",
  (() => {
    const card = newCard();
    card._openDetail("node", SHARE);
    card._highlight = new Set(["node:addon_a0d7b954_adguard"]);
    card._renderGraph();
    const svg = card._els.get(".smc-graph").innerHTML;
    return [
      /class="[^"]*smc-hi[^"]*" data-node="addon_a0d7b954_adguard"/.test(svg),
      new RegExp(`class="[^"]*smc-dim[^"]*" data-node="${SHARE}"`).test(svg),
      svg.includes("smc-edge-hot"),
    ];
  })(), [true, true, false]);

T("selecting the same node twice does not redraw the graph twice",
  (() => {
    const card = newCard();
    let renders = 0;
    card._renderHighlightables = () => { renders++; };
    card._openDetail("node", SHARE);
    card._openDetail("node", SHARE);
    return renders;
  })(), 1);

// --- columns ---------------------------------------------------------------
// Asking for more columns has to widen the canvas too. Squeezing more cards
// into a fixed 1220 just draws them closer together until they overlap, which
// is the opposite of using a landscape screen well.
const geoAt = (columns) => {
  const card = newCard(columns === undefined ? {} : { columns });
  card._derive();
  return { geo: card._geo(), card };
};

T("the default layout is unchanged", [geoAt().geo.cols, geoAt().geo.width], [6, 1220]);
T("more columns means a wider canvas", geoAt(10).geo.width, 2 * 110 + 9 * 200);
T("column spacing never falls below a card's width plus a gap",
  [3, 6, 9, 12].map((c) => {
    const { geo } = geoAt(c);
    return (geo.width - 2 * 110) / (geo.cols - 1);
  }), [200, 200, 200, 200]);
T("a silly column count is clamped rather than obeyed",
  [geoAt(1).geo.cols, geoAt(99).geo.cols, geoAt(0).geo.cols], [3, 12, 6]);

T("the hardware row keeps the host in its middle at any width",
  [3, 6, 11].map((c) => {
    const { geo } = geoAt(c);
    return geo.hostCol === Math.floor(geo.hwPerRow / 2);
  }), [true, true, true]);
T("hardware fills outward from the host rather than left to right",
  (() => {
    const { geo } = geoAt(6); // 7 slots, host at 3
    return [0, 1, 2, 3].map((i) => geo.hwSlot(i).col);
  })(), [2, 4, 1, 5]);
T("every hardware slot lands inside the canvas",
  (() => {
    const { geo } = geoAt(4);
    return Array.from({ length: geo.hwPerRow }, (_, i) => geo.hwColX(geo.hwSlot(i).col)).every(
      (x) => x >= 0 && x <= geo.width
    );
  })(), true);

T("the graph's viewBox is as wide as the layout it holds",
  (() => {
    const card = newCard({ columns: 9 });
    card._renderGraph();
    return card._naturalViewBox.w;
  })(), 2 * 110 + 8 * 200);

// The grid chips size themselves to their labels, which is the whole point:
// a fixed-radius circle truncated "utility_meter (3)" and let "systemmonitor"
// spill over its own edge.
T("a chip is wider for a longer label",
  __EXPORT.chipWidth("utility_meter (3)") > __EXPORT.chipWidth("hue"), true);

T("a tier smaller than the column count is not stretched across the whole width",
  (() => {
    // Four nodes in a twelve-column layout should stay four across.
    const card = newCard({ columns: 12 });
    card._derive();
    const xs = card._derived.nodes.filter((n) => n.tier === "network").map((n) => n.x);
    return xs.length <= 1 || Math.max(...xs) - Math.min(...xs) < card._geo().width - 2 * 110;
  })(), true);

// Rows used to stretch to the full canvas width whatever their length, so a
// last row of three was spaced like a row of ten and no two rows lined up.
T("every row in a box lands on the same column positions",
  (() => {
    const card = newCard({ columns: 4, group_services: false });
    card._derive();
    const xs = card._derived.nodes.filter((n) => n.tier === "services").map((n) => Math.round(n.x));
    return new Set(xs).size <= 4;
  })(), true);
T("column spacing does not change with how many are in the row",
  (() => {
    const card = newCard({ columns: 4, group_services: false });
    card._derive();
    const rows = new Map();
    for (const n of card._derived.nodes.filter((x) => x.tier === "services"))
      rows.set(n.y, [...(rows.get(n.y) || []), Math.round(n.x)]);
    const gaps = [...rows.values()]
      .map((xs) => xs.sort((a, b) => a - b))
      .filter((xs) => xs.length > 1)
      .flatMap((xs) => xs.slice(1).map((x, i) => x - xs[i]));
    return new Set(gaps).size;
  })(), 1);

// --- merged integration nodes ----------------------------------------------
// An integration that makes a config entry per device or per helper - a local
// Tuya bridge with three plugs, a dozen utility meters, switch-as-x - drew a
// row of identical circles saying nothing the one node doesn't. Merging them
// is only defensible while every entry stays reachable and no state is lost.
function mergeCard(extra = {}) {
  const card = newCard(extra);
  card._entries = [
    { entry_id: "t1", domain: "localtuya", title: "Desk plug", state: "loaded", source: "user" },
    { entry_id: "t2", domain: "localtuya", title: "Lamp", state: "loaded", source: "user" },
    { entry_id: "t3", domain: "localtuya", title: "Fan", state: "setup_error", source: "user" },
    { entry_id: "u1", domain: "utility_meter", title: "Daily", state: "loaded", source: "user" },
    { entry_id: "u2", domain: "utility_meter", title: "Monthly", state: "loaded", source: "user" },
    { entry_id: "h1", domain: "hue", title: "Hue Bridge", state: "loaded", source: "user" },
  ];
  card._entityRegistry = [
    { entity_id: "switch.desk", platform: "localtuya", config_entry_id: "t1", unique_id: "d1" },
  ];
  card._derive();
  card._renderGraph();
  return card;
}
const merged = mergeCard();
const mergedSvg = merged._els.get(".smc-graph").innerHTML;

T("three entries of one integration draw as one node",
  (mergedSvg.match(/data-node-domain="localtuya"/g) || []).length, 1);
T("the merged node says how many it stands for", mergedSvg.includes("localtuya (3)"), true);
T("an integration with a single entry is not labelled with a count",
  [mergedSvg.includes("hue (1)"), /data-node-domain="hue"/.test(mergedSvg)], [false, true]);
T("every integration is drawn exactly once",
  (mergedSvg.match(/data-node-domain=/g) || []).length,
  new Set(merged._entries.map((e) => e.domain)).size);

// A merged node covering a broken entry must not read as healthy.
T("the merged node wears the worst state among its entries",
  __EXPORT.worstStatus(["loaded", "loaded", "error"]), "error");
T("all-healthy entries still read as healthy", __EXPORT.worstStatus(["loaded", "loaded"]), "loaded");
T("a disabled entry outranks a loaded one but not an error",
  [__EXPORT.worstStatus(["loaded", "disabled"]), __EXPORT.worstStatus(["disabled", "error"])],
  ["disabled", "error"]);

T("every config entry is still listed individually below the map",
  (() => {
    const card = mergeCard();
    card._renderChipList("integrations");
    const html = card._els.get('[data-list="integrations"]').innerHTML;
    return card._entries.every((e) => html.includes(`data-chip="${e.entry_id}"`));
  })(), true);

// The finder has to answer in both currencies at once: the map knows only
// the integration, the list below knows only the entry.
const found = merged._mapTargetForRegistryEntry({ platform: "localtuya", config_entry_id: "t1" });
T("an entity resolves to both the drawn node and its own entry",
  [found.keys.includes("domain:localtuya"), found.keys.includes("entry:t1")], [true, true]);
T("the finder still names the specific entry, not just the integration",
  found.names[0].includes("Desk plug"), true);
T("the merged node is where a highlight actually lands",
  merged._nodePositions.has("domain:localtuya"), true);

// Selecting the merged node has to reach the entries behind it, or merging
// has thrown information away rather than folded it up.
T("the merged node's panel lists the entries behind it",
  (() => {
    const card = mergeCard();
    card._detailKey = "domain:localtuya";
    card._renderDetail();
    const html = card._els.get(".smc-detail").innerHTML;
    return ["Desk plug", "Lamp", "Fan"].every((name) => html.includes(name));
  })(), true);

// Counts and problems are keyed off the same resolution, so they land on the
// merged node rather than vanishing with the per-entry keys.
T("entity counts land on the merged node",
  (() => {
    const card = mergeCard({ show_counts: true });
    card._buildCounts();
    return card._counts.get("domain:localtuya")?.entities;
  })(), 1);

// --- fitting the view ------------------------------------------------------
// The first render happens before any data has arrived, so the map it fits is
// a fraction of the final one. The view was set once and never again, which
// left everything that loaded afterwards below the bottom edge - the "map is
// tiny and cut off, with empty margins either side" report.
T("the view re-fits when the map grows under it",
  (() => {
    const card = newCard();
    card._renderGraph();
    const first = card._naturalViewBox.h;
    card._addons = [...card._addons, ...Array.from({ length: 20 }, (_, i) => ({ slug: `x${i}`, name: `Extra ${i}`, state: "started" }))];
    card._derive();
    card._renderGraph();
    return [card._naturalViewBox.h > first, card._viewBox.h === card._naturalViewBox.h];
  })(), [true, true]);

// ...but a view the user has moved is theirs. Snapping it back on every
// 60-second refresh would make the card unusable.
T("a view the user has zoomed is left alone when the map grows",
  (() => {
    const card = newCard();
    card._renderGraph();
    card._zoomBy(0.5);
    const held = { ...card._viewBox };
    card._addons = [...card._addons, { slug: "x", name: "Extra", state: "started" }];
    card._derive();
    card._renderGraph();
    return [card._viewBox.w, card._viewBox.h];
  })(), (() => {
    const card = newCard();
    card._renderGraph();
    card._zoomBy(0.5);
    return [card._viewBox.w, card._viewBox.h];
  })());

T("panning marks the view as the user's, but the finder panning to a result does not",
  (() => {
    const card = newCard();
    card._renderGraph();
    card._highlight = new Set(["node:host"]);
    card._panToHighlight();
    return card._viewMoved;
  })(), false);

T("reset hands the view back to the card",
  (() => {
    const card = newCard();
    card._renderGraph();
    card._zoomBy(0.5);
    card._resetView();
    return [card._viewMoved, card._viewBox.h === card._naturalViewBox.h];
  })(), [false, true]);

// A label landing on a tier box's outline had that border drawn through it,
// which reads as struck-through text rather than a label crossing a line.
T("a label is moved off a tier outline, not just off the nodes",
  (() => {
    const card = newCard();
    const border = { x0: 0, x1: 400, y0: 98, y1: 102 };
    const [placed] = card._placeEdgeLabels([{ text: "mqtt.server", x: 200, y: 100 }], [], [border]);
    return placed.y < border.y0 - 4 || placed.y > border.y1 + 4;
  })(), true);
T("without an obstacle the label still keeps its own midpoint",
  (() => {
    const card = newCard();
    const [placed] = card._placeEdgeLabels([{ text: "mqtt.server", x: 200, y: 100 }], [], []);
    return placed.y;
  })(), 100);

// --- listener lifetime -----------------------------------------------------
// The visual editor calls setConfig on every keystroke and setConfig rebuilds
// the card, so anything bound during a build was bound again per character.
// Twenty keystrokes meant one click running _openDetail twenty times, each
// with its own render and refetch - and twenty window listeners holding the
// card alive for the life of the page.
T("rebuilding the card does not stack up click handlers",
  (() => {
    const card = newCard();
    card._hass = { states: {}, connection: { sendMessagePromise: async () => [], subscribeMessage: async () => () => {} } };
    let opened = 0;
    card._openDetail = () => { opened++; };
    for (let i = 0; i < 5; i++) card._bindOnce();
    const node = { closest: (sel) => (sel === "[data-node]" ? { getAttribute: () => "host" } : null) };
    (card._listeners?.click || []).forEach((fn) => fn({ target: node }));
    return opened;
  })(), 1);

T("a card removed from the page releases its global listeners",
  (() => {
    const card = newCard();
    card._bindOnce();
    const before = [ctx.window._removed || 0, ctx.document._removed || 0];
    card.disconnectedCallback();
    return [(ctx.window._removed || 0) - before[0], (ctx.document._removed || 0) - before[1]];
  })(), [1, 1]);

T("and takes them back when it returns to the page",
  (() => {
    const card = newCard();
    card._bindOnce();
    card.disconnectedCallback();
    const before = [ctx.window._added || 0, ctx.document._added || 0];
    card.connectedCallback();
    return [(ctx.window._added || 0) - before[0], (ctx.document._added || 0) - before[1]];
  })(), [1, 1]);

// --- keyboard and screen readers -------------------------------------------
// The map was mouse-and-touch only: every node, and the detail panel behind
// it, was unreachable from a keyboard, and a screen reader was read a <title>
// on an unfocusable <g>, which it never reaches.
const a11y = (() => {
  const card = newCard();
  card._renderGraph();
  return card._els.get(".smc-graph").innerHTML;
})();
T("every node is focusable and named",
  (() => {
    const groups = a11y.match(/<g class="smc-node[^>]*>/g) || [];
    return [groups.length > 0, groups.every((g) => g.includes('tabindex="0"') && g.includes("aria-label="))];
  })(), [true, true]);
T("a node's accessible name carries its facts, not just its id",
  /aria-label="[^"]*192\.168\.1\.50/.test(a11y), true);
T("the icon-only controls have accessible names",
  ["Refresh", "Zoom in", "Zoom out", "Fit to view", "Download as PNG"].every((l) => src.includes(`aria-label="${l}"`)),
  true);
T("Enter on a focused node opens it, exactly as a click does",
  (() => {
    const card = newCard();
    card._bindOnce();
    let opened = null;
    card._openDetail = (kind, key) => { opened = [kind, key]; };
    const target = { closest: (sel) => (sel.includes("data-node]") || sel === "[data-node]" ? { getAttribute: () => "host" } : null) };
    (card._listeners?.keydown || []).forEach((fn) => fn({ key: "Enter", target, preventDefault() {} }));
    return opened;
  })(), ["node", "host"]);
T("an ordinary key press on a node does nothing",
  (() => {
    const card = newCard();
    card._bindOnce();
    let opened = null;
    card._openDetail = (kind, key) => { opened = [kind, key]; };
    const target = { closest: () => ({ getAttribute: () => "host" }) };
    (card._listeners?.keydown || []).forEach((fn) => fn({ key: "a", target, preventDefault() {} }));
    return opened;
  })(), null);

// On a Core or Container install there is no Supervisor and so no network
// info; the host node was left showing a bare ":8123", which is not an
// address.
T("with no host address the host node shows none, rather than a bare port",
  (() => {
    const card = newCard();
    card._network = null;
    card._system = { core: { port: 8123 } };
    card._derive();
    const host = card._derived.nodes.find((n) => n.kind === "host");
    return host.lan;
  })(), null);
T("with an address it still shows address and port",
  (() => {
    const card = newCard();
    card._derive();
    return card._derived.nodes.find((n) => n.kind === "host").lan;
  })(), "192.168.1.50:8123");

// Selecting a config entry from the list below the map has to light its
// integration up there: the entry itself is no longer a node, so focusing it
// alone dimmed the entire map and lit nothing.
T("selecting an entry in the list lights its integration on the map",
  (() => {
    const card = mergeCard();
    card._openDetail("entry", "t2");
    card._renderGraph();
    const svg = card._els.get(".smc-graph").innerHTML;
    return /class="[^"]*smc-hi[^"]*"[^>]*data-node-domain="localtuya"/.test(svg);
  })(), true);

T("a label is moved off a tier's own name, not only off its outline",
  (() => {
    const card = newCard();
    card._renderGraph();
    const svg = card._els.get(".smc-graph").innerHTML;
    // Every tier label and every edge label, as {x, y, text}. None of the
    // edge labels may sit within a line's height of a tier label's baseline
    // while overlapping it horizontally.
    const grab = (cls) =>
      [...svg.matchAll(new RegExp(`<text class="${cls}[^"]*" x="([-\\d.]+)" y="([-\\d.]+)"[^>]*>([^<]*)<`, "g"))].map(
        (m) => ({ x: +m[1], y: +m[2], text: m[3] })
      );
    const tiers = grab("smc-tier-label");
    return grab("smc-edge-label").every((e) =>
      tiers.every((t) => Math.abs(e.y - t.y) > 12 || e.x + e.text.length * 3 < t.x || e.x - e.text.length * 3 > t.x + t.text.length * 7.4)
    );
  })(), true);

// --- what kind of service is this ------------------------------------------
// The services tier is the honest default, so on a real system it holds
// nearly everything. Splitting it is only worth doing if the split is made
// from the add-on's own manifest rather than from knowing the names of
// particular add-ons - these pin the evidence each branch rests on.
const cat = (info, ports = []) => __EXPORT.categoriseService(info, ports).category;

T("an add-on serving a known protocol is a network service",
  [cat({}, [445]), cat({}, [1883]), cat({}, [3306]), cat({}, [2049])],
  ["netsvc", "netsvc", "netsvc", "netsvc"]);
T("so is one whose manifest offers a service to other add-ons",
  cat({ services: ["mqtt:provide"] }), "netsvc");
T("but not one that merely needs a service", cat({ services: ["mqtt:need"] }), "other");

// The precedence that matters: a file server has to map Home Assistant's
// config folders in order to share them, and that must not make it read as
// an administration tool.
T("a file server is a network service, not an administrator, despite its folder access",
  cat({ map: ["config:rw", "addons:rw", "backup:rw"] }, [445]), "netsvc");
// SSH is the reverse - a protocol whose purpose is changing the machine.
T("SSH counts as administration rather than as a service offered",
  cat({}, [22]), "admin");

T("system access of any kind is administration",
  [
    cat({ hassio_role: "manager" }),
    cat({ hassio_role: "admin" }),
    cat({ docker_api: true }),
    cat({ full_access: true }),
    cat({ host_pid: true }),
    cat({ privileged: ["SYS_ADMIN"] }),
    cat({ map: ["homeassistant_config:rw"] }),
  ],
  ["admin", "admin", "admin", "admin", "admin", "admin", "admin"]);
T("the ordinary Supervisor roles are not administration",
  [cat({ hassio_role: "default", ingress: true }), cat({ hassio_role: "homeassistant", ingress: true })],
  ["apps", "apps"]);

// An add-on's own config directory is not the system's configuration, and
// the two differ by one character.
T("mapping its own config directory is not system access",
  cat({ map: ["addon_config:rw", "share:rw", "ssl:ro"], ingress: true }), "apps");
// Reading Home Assistant's configuration is not the same as being able to
// change it, and add-ons ask for the first far more often.
T("read-only access to the system's configuration is not administration",
  [cat({ map: ["config:ro"], ingress: true }), cat({ map: ["config:rw"], ingress: true })], ["apps", "admin"]);
T("read-only is recognised in the object form too",
  [
    cat({ map: [{ type: "config", read_only: true }], ingress: true }),
    cat({ map: [{ type: "config", read_only: false }], ingress: true }),
  ], ["apps", "admin"]);
T("folder mappings are read in all the shapes Supervisor returns them",
  [
    __EXPORT.mappedFolders({ map: ["config:rw", "share:ro"] }),
    __EXPORT.mappedFolders({ map: [{ type: "config", read_only: false }] }),
    __EXPORT.mappedFolders({ map: { config: {}, media: {} } }),
    __EXPORT.mappedFolders({}),
  ],
  [["config", "share"], ["config"], ["config", "media"], []]);

T("something a person opens is an app",
  [cat({ ingress: true }), cat({ webui: "http://[HOST]:[PORT:8080]" })], ["apps", "apps"]);
T("an add-on the manifest says nothing useful about is not guessed at",
  cat({ name: "Some Sidecar" }), "other");
T("every category carries the evidence it was decided on",
  [
    __EXPORT.categoriseService({}, [445]).why.includes("SMB"),
    __EXPORT.categoriseService({ docker_api: true }).why.includes("Docker"),
    __EXPORT.categoriseService({ ingress: true }).why.includes("ingress"),
  ], [true, true, true]);

// --- grouping the services tier --------------------------------------------
// Four boxes holding one card each is worse than one holding four, so the
// split has to earn itself.
function groupedCard(extra = {}) {
  const card = newCard(extra);
  card._addons = [
    { slug: "a_samba", name: "Samba NAS", state: "started" },
    { slug: "a_mqtt", name: "Mosquitto", state: "started" },
    { slug: "a_immich", name: "PhotoPrism", state: "started" },
    { slug: "a_firefox", name: "Firefox", state: "started" },
    { slug: "a_portainer", name: "Portainer", state: "started" },
    { slug: "a_ssh", name: "Terminal & SSH", state: "started" },
    { slug: "a_sidecar", name: "Thumbnail worker", state: "started" },
  ];
  card._addonInfoCache = new Map([
    ["a_samba", { name: "Samba NAS", network: { "445/tcp": 445 }, options: { workgroup: "WORKGROUP" }, map: ["config:rw"] }],
    ["a_mqtt", { name: "Mosquitto", network: { "1883/tcp": 1883 }, options: {} }],
    ["a_immich", { name: "PhotoPrism", network: { "3001/tcp": 8080 }, ingress: true, options: {} }],
    ["a_firefox", { name: "Firefox", ingress: true, options: {} }],
    ["a_portainer", { name: "Portainer", docker_api: true, ingress: true, options: {} }],
    ["a_ssh", { name: "Terminal & SSH", network: { "22/tcp": 22 }, full_access: true, options: {} }],
    ["a_sidecar", { name: "Thumbnail worker", options: {} }],
  ]);
  card._derive();
  return card;
}
const split = groupedCard();
const groupOf = (slug) => split._derived.nodes.find((n) => n.slug === slug)?.group;

T("the services tier splits into its categories",
  [groupOf("a_samba"), groupOf("a_immich"), groupOf("a_portainer"), groupOf("a_sidecar")],
  ["services:netsvc", "services:apps", "services:admin", "services:other"]);
T("a split tier draws one labelled box per category",
  (() => {
    split._renderGraph();
    const svg = split._els.get(".smc-graph").innerHTML;
    return ["Network services", "Apps", "Administration"].every((l) => svg.includes(l));
  })(), true);
T("the boxes are stacked in a fixed order, so the map does not reshuffle",
  (() => {
    const y = (cat) =>
      Math.min(...split._derived.nodes.filter((n) => n.group === `services:${cat}`).map((n) => n.y));
    return y("netsvc") < y("apps") && y("apps") < y("admin") && y("admin") < y("other");
  })(), true);

T("too few services to be worth splitting are left as one box",
  (() => {
    const card = newCard(); // the base fixture has only a handful of services
    card._derive();
    return card._derived.nodes.filter((n) => n.tier === "services").every((n) => n.group === "services");
  })(), true);
T("a split can be turned off",
  (() => {
    const card = groupedCard({ group_services: false });
    return card._derived.nodes.filter((n) => n.tier === "services").every((n) => n.group === "services");
  })(), true);
T("splitting changes which box a node is in, never which tier",
  split._derived.nodes.filter((n) => n.group?.startsWith("services:")).every((n) => n.tier === "services"), true);
T("the sub-boxes keep the tier's own colour, so it still reads as one tier",
  (() => {
    split._renderGraph();
    const svg = split._els.get(".smc-graph").innerHTML;
    const services = (svg.match(/fill:#ab47bc/g) || []).length;
    return services >= 3;
  })(), true);

T("a node's panel says which kind it is and why",
  await (async () => {
    const card = groupedCard();
    card._detailKey = `node:${card._derived.nodes.find((n) => n.slug === "a_portainer").id}`;
    await card._renderDetail();
    const html = card._els.get(".smc-detail").innerHTML;
    return [html.includes("Administration"), html.includes("Docker")];
  })(), [true, true]);

// --- what is reachable from outside ----------------------------------------
// Two halves of one claim: the service wears the hostname, and a line runs to
// it from whatever exposes it. Both were drawn already, but the line was one
// more grey dashed edge among thirty and could not be picked out - which
// leaves "what is reachable from the internet", a thing this card puts in a
// tier heading, unanswerable from the picture.
const exposed = (() => {
  const card = newCard();
  card._renderGraph();
  return { card, svg: card._els.get(".smc-graph").innerHTML };
})();

T("every resolved route has an edge from the tunnel to what it reaches",
  exposed.card._routes
    .filter((r) => r.targetId && r.viaId && r.viaId !== r.targetId)
    .filter((r) => !exposed.card._derived.edges.some(([a, b]) => a === r.viaId && b === r.targetId))
    .map((r) => r.hostname), []);
T("those edges are marked out from every other line on the map",
  (exposed.svg.match(/smc-edge-exposed/g) || []).length,
  exposed.card._routes.filter((r) => r.targetId && r.viaId && r.viaId !== r.targetId).length);
T("and are drawn in the same amber as the pill on the far end",
  /\.smc-edge-exposed \{[^}]*#ffca28/.test(src), true);

// The pill half of the same claim, asserted as a rule over every node rather
// than for one add-on.
T("every node with a hostname draws it as a pill",
  (() => {
    const withHost = exposed.card._derived.nodes.filter((n) => n.hostname);
    return [
      withHost.length > 0,
      withHost.every((n) => exposed.svg.includes(`>${n.hostname}<`)),
      (exposed.svg.match(/class="smc-host-pill"/g) || []).length === withHost.length,
    ];
  })(), [true, true, true]);
T("a hostname is never drawn as a pill and a sub-line both",
  exposed.card._derived.nodes
    .filter((n) => n.hostname)
    .filter((n) => (exposed.svg.match(new RegExp(`>${n.hostname.replace(/\./g, "\\.")}<`, "g")) || []).length !== 1)
    .map((n) => n.label), []);

// The failure mode that looks like "the card lost the hostnames": the rules
// were read and parsed, but none of them matched anything on this machine.
// Nothing is drawn for a route with no target, so the absence has to be
// stated rather than left to be inferred from a map with no pills on it.
T("hostnames that reached nothing are flagged, not reported as a plain count",
  (() => {
    const card = newCard();
    card._routes = [
      { hostname: "a.example.com", viaSlug: "cf", targetId: null },
      { hostname: "b.example.com", viaSlug: "cf", targetId: null },
    ];
    const item = card._statusItems().find((i) => i.key === "exposed");
    return [item.tone, item.value, /could not be matched/.test(item.note)];
  })(), ["warn", "2 hostnames", true]);
T("hostnames that did reach something are reported plainly",
  (() => {
    const card = newCard();
    const item = card._statusItems().find((i) => i.key === "exposed");
    return [item.tone, /could not be matched/.test(item.note)];
  })(), ["info", false]);

// --- how much log to ask for -----------------------------------------------
// The failure this exists for reports no error anywhere: the log reads fine,
// it is simply the wrong hundred lines. A tunnel logs its ingress rules once
// at startup, and Supervisor's default window is the tail - so on a tunnel
// that has been up for days the rules are long past it, and the card sees a
// healthy 14KB log with nothing it needs in it.
T("a route scan asks for far more of the log than the default window",
  await (async () => {
    const card = newCard();
    const asked = [];
    card._hass = {
      states: {},
      connection: {
        sendMessagePromise: async (m) => (m.type === "auth/sign_path" ? { path: "/signed" } : {}),
      },
    };
    ctx.fetch = async (url, opts) => {
      asked.push(opts?.headers?.Range || null);
      return { ok: true, text: async () => "INF nothing here" };
    };
    await card._fetchAddonLog("a", 0, 20000);
    return asked;
  })(), ["entries=:-20000:"]);

T("a Supervisor that rejects the range is retried without it, rather than failing",
  await (async () => {
    const card = newCard();
    card._hass = {
      states: {},
      connection: { sendMessagePromise: async () => ({ path: "/signed" }) },
    };
    let call = 0;
    ctx.fetch = async () => {
      call++;
      return call === 1 ? { ok: false, status: 416 } : { ok: true, text: async () => "second try worked" };
    };
    const text = await card._fetchAddonLog("a", 0, 20000);
    return [call, text];
  })(), [2, "second try worked"]);

T("a detail-panel log tail asks for no range at all",
  await (async () => {
    const card = newCard();
    card._hass = { states: {}, connection: { sendMessagePromise: async () => ({ path: "/signed" }) } };
    const asked = [];
    ctx.fetch = async (url, opts) => {
      asked.push(opts?.headers?.Range || null);
      return { ok: true, text: async () => "a\nb\nc" };
    };
    await card._fetchAddonLog("a");
    return asked;
  })(), [null]);

// A way in whose rules were never found draws no hostnames and no lines, so
// the map looks like it lost them rather than never having had them.
T("a tunnel with no rules found says so in the status bar",
  (() => {
    const card = newCard();
    card._routes = [];
    card._tunnelSlugs = new Set(["d1c2b3a4_cloudflared"]);
    const item = card._statusItems().find((i) => i.key === "exposed");
    return [item?.value, item?.tone, /logs its rules once/.test(item?.note || "")];
  })(), ["rules not found", "warn", true]);
T("with no tunnel at all there is nothing to report",
  (() => {
    const card = newCard();
    card._routes = [];
    card._tunnelSlugs = new Set();
    return card._statusItems().some((i) => i.key === "exposed");
  })(), false);

// Its category was decided while it was still a service, and it is not one.
T("an add-on promoted to remote access drops its service category",
  (() => {
    const card = newCard();
    card._derive();
    const cf = card._derived.nodes.find((n) => n.slug === "d1c2b3a4_cloudflared");
    return [cf.tier, cf.category ?? null];
  })(), ["remote", null]);

// Add-on detail used to be fetched strictly one at a time, which meant a
// long blank-looking map on a server with dozens of add-ons.
const { inBatches, ADDON_FETCH_BATCH } = __EXPORT;
T("work is issued concurrently, up to the batch size",
  await (async () => {
    let live = 0, peak = 0, done = 0;
    await inBatches([...Array(13).keys()], ADDON_FETCH_BATCH, async () => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--; done++;
    });
    return [peak, done];
  })(), [ADDON_FETCH_BATCH, 13]);
T("a card removed mid-walk stops between batches",
  await (async () => {
    let alive = true, seen = 0;
    const ok = await inBatches([...Array(20).keys()], ADDON_FETCH_BATCH,
      async () => { if (++seen >= ADDON_FETCH_BATCH) alive = false; }, () => alive);
    return [seen, ok];
  })(), [ADDON_FETCH_BATCH, false]);

T("add-on info is fetched once per uncached add-on, in batches",
  await (async () => {
    const card = newCard();
    const slugs = [];
    card._fetchAddonInfo = async (slug) => { slugs.push(slug); card._addonInfoCache.set(slug, {}); };
    card._loadAddonIcons = async () => {};
    card._loadRouteLogs = async () => {};
    card._addons = [...Array(13).keys()].map((i) => ({ slug: `a${i}`, name: `A${i}`, state: "started" }));
    card._addonInfoCache.set("a0", {});
    await card._loadAddonOptions();
    return [slugs.includes("a0"), slugs.length === new Set(slugs).size, slugs.length];
  })(), [false, true, 12]);

// A fixed size hint is what made a taller map spill past the footprint
// Lovelace handed the card.
T("a taller map asks for a taller footprint",
  (() => {
    const a = newCard(); a._config = { ...a._config, graph_height: 480 };
    const b = newCard(); b._config = { ...b._config, graph_height: 1200 };
    return [b.getCardSize() > a.getCardSize(), b.getGridOptions().rows > a.getGridOptions().rows];
  })(), [true, true]);
T("the footprint covers the map plus the sections around it",
  (() => {
    const card = newCard();
    card._config = { ...card._config, graph_height: 600 };
    const g = card.getGridOptions();
    return [g.rows * 56 + (g.rows - 1) * 8 >= 600, card.getCardSize() * 50 > 600];
  })(), [true, true]);
T("switching a section off gives its space back",
  (() => {
    const on = newCard(); on._config = { ...on._config, show_integration_list: true, show_entity_finder: true };
    const off = newCard(); off._config = { ...off._config, show_integration_list: false, show_entity_finder: false };
    return off._estimatedHeightPx() < on._estimatedHeightPx();
  })(), true);
T("the older layout hint reports the same numbers",
  (() => {
    const card = newCard();
    const g = card.getGridOptions(), l = card.getLayoutOptions();
    return [l.grid_rows === g.rows, l.grid_columns === g.columns];
  })(), [true, true]);
T("a card asked for its size before it is configured still answers",
  (() => {
    const card = new SystemMapCard();
    return [Number.isFinite(card.getCardSize()), card.getCardSize() > 0];
  })(), [true, true]);

// Reopening a view builds a brand new card. Without a shared cache each one
// repeated the whole walk for data fetched seconds earlier.
const { dataCache } = __EXPORT;
const resetCache = () => { dataCache.at = 0; dataCache.data = null; };
const stubFetches = (card, log) => {
  card._hass.connection = { sendMessagePromise: async (msg) => {
    log.push(msg.type === "supervisor/api" ? msg.endpoint : msg.type);
    if (msg.endpoint === "/addons") return { data: { addons: [] } };
    return {};
  } };
  card._loadAddonOptions = async () => {};
  card._loadRouteLogs = async () => {};
  card._loadHistory = () => {};
};

T("a second card paints from the cache instead of refetching",
  await (async () => {
    resetCache();
    const first = newCard(); const calls1 = [];
    stubFetches(first, calls1);
    await first._refreshData();
    const second = newCard(); const calls2 = [];
    stubFetches(second, calls2);
    await second._refreshData();
    return [calls1.length > 0, calls2.length, Number(second._lastRefreshed) === dataCache.at];
  })(), [true, 0, true]);

T("pressing refresh re-checks everything even when the cache is warm",
  await (async () => {
    resetCache();
    const card = newCard(); const calls = [];
    stubFetches(card, calls);
    await card._refreshData();
    card._addonInfoCache.set("stale", { v: 1 });
    calls.length = 0;
    await card._refreshData({ force: true });
    return [calls.length > 0, card._addonInfoCache.has("stale")];
  })(), [true, false]);

T("data older than the cache window is fetched again",
  await (async () => {
    resetCache();
    const card = newCard(); const calls = [];
    stubFetches(card, calls);
    await card._refreshData();
    dataCache.at = Date.now() - (Number(card._config.refresh_interval) * 1000 + 5000);
    calls.length = 0;
    await card._refreshData();
    return calls.length > 0;
  })(), true);

T("the next refresh is timed from when the data was fetched, not from now",
  (() => {
    resetCache();
    const card = newCard();
    card._config = { ...card._config, refresh_interval: 60 };
    dataCache.at = Date.now() - 50000; dataCache.data = {};
    let delay = null;
    const realSetTimeout = ctx.setTimeout;
    ctx.setTimeout = (fn, ms) => { delay = ms; return 1; };
    card._scheduleRefresh();
    ctx.setTimeout = realSetTimeout;
    return delay > 1000 && delay <= 11000;
  })(), true);

T("the cache window never outlives a signed icon URL",
  (() => {
    const card = newCard();
    card._config = { ...card._config, refresh_interval: 0 };
    return card._cacheTtlMs() <= 45 * 60 * 1000;
  })(), true);

resetCache();

process.exit(all ? 0 : 1);
