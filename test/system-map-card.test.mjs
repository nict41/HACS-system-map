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
  // isConnected is a real DOM property the card checks before doing
  // background work; on a bare stub it is undefined, which would silently
  // skip every background loader under test.
  HTMLElement: class { get isConnected() { return true; } querySelector() { return null; } addEventListener() {} appendChild() {} },
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
    { slug: "c9a35110_sambanas", name: "Samba NAS", state: "started" },
    { slug: "3b88f413_immich", name: "Immich", state: "started" },
    { slug: "beb500c8_kiwix", name: "Kiwix", state: "started" },
    { slug: "a0d7b954_adguard", name: "AdGuard Home", state: "started" },
    { slug: "9074a9fa_cloudflared", name: "Cloudflared", state: "started" },
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
    ["core_mosquitto", { name: "Mosquitto broker", network: { "1883/tcp": 1883 }, options: {} }],
    ["45df7312_zigbee2mqtt", { name: "Zigbee2MQTT", network: { "8099/tcp": 8099 }, options: { serial: { port: DONGLE.by_id }, mqtt: { server: "mqtt://core-mosquitto:1883" } } }],
    ["c9a35110_sambanas", { name: "Samba NAS", network: { "445/tcp": 445, "139/tcp": 139 }, options: { workgroup: "WORKGROUP", moredisks: ["NAS1"] } }],
    ["3b88f413_immich", { name: "Immich", network: { "3001/tcp": 8080 }, options: { external_library: "/media/NAS1/photos" } }],
    ["beb500c8_kiwix", { name: "Kiwix", options: { zim_dir: "NAS1" } }],
    ["a0d7b954_adguard", { name: "AdGuard Home", network: { "53/tcp": 53, "3000/tcp": 3000 }, options: {} }],
    ["9074a9fa_cloudflared", { name: "Cloudflared", network: {}, options: { tunnel_token: "ey...", external_hostname: "" } }],
    ["a_spare", { name: "Some Other Add-on", options: {} }],
    ...(opts.addonInfo || []),
  ]);
  card._system = {
    host: { hostname: "homeassistant", disk_total: 100, disk_free: 4.2, kernel: "6.6", boot_timestamp: (Date.now() - 3 * 864e5) * 1000 },
    core: { version: "2026.8.1", version_latest: "2026.9.0", update_available: true, arch: "amd64" },
    os: { version: "13.1", board: "generic-x86-64", update_available: false },
    supervisor: { version: "2026.08.0", channel: "stable" },
    network: { host_internet: true, supervisor_internet: true, interfaces: [{ interface: "enp1s0", type: "ethernet", connected: true, primary: true, ipv4: { address: ["192.168.8.25/24"] } }] },
    backups: [{ slug: "b1", name: "Nightly", date: new Date(Date.now() - 20 * 864e5).toISOString(), size: 512 }],
  };
  card._issues = [{ domain: "hue", issue_id: "bridge_firmware", severity: "warning", is_fixable: true }];
  card._systemHealth = { mqtt: { info: { broker: "core-mosquitto", connected: true } } };
  card._logRoutes = opts.logRoutes ?? [
    { hostname: "ha.example.com", service: "http://192.168.8.25:8123", source: "log", viaSlug: "9074a9fa_cloudflared" },
    { hostname: "nas.example.com", service: "http://192.168.8.25:8080", source: "log", viaSlug: "9074a9fa_cloudflared" },
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
T("a drive and a serial dongle become nodes", hw().map((n) => n.label), ["LITEON EP2", "ITead Sonoff Zigbee 3.0"]);
T("a drive carries its filesystem labels", hw()[0].labels, ["NAS1"]);
T("no discovered device lands on top of the host",
  hw().some((n) => Math.abs(n.x - 610) < 60 && n.y === 150), false);
T("ownership is derived from the add-on's own nested options",
  c._derived.edges.filter((e) => e[0].startsWith("hw_tty")).map((e) => [e[1], e[2].label]),
  [[addonId("45df7312_zigbee2mqtt"), "owns (serial.port)"]]);
T("every discovered device hangs off the host",
  c._derived.edges.filter((e) => e[0] === "host").length, 2);
// --- the Samba republish chain --------------------------------------------
const drive = () => c._derived.nodes.find((n) => n.id.startsWith("hw_drive"));
const edgeLabels = (from, to) =>
  c._derived.edges.filter((e) => (!from || e[0] === from) && (!to || e[1] === to)).map((e) => e[2].label);

T("a disk referenced by filesystem label, not path, is still matched",
  drive().usedBy.find((u) => u.slug === "c9a35110_sambanas")?.option, "moredisks");
T("the SMB server owns the drive",
  edgeLabels(drive().id, addonId("c9a35110_sambanas")), ["serves (moredisks)"]);
// The share is a node of its own, so the chain reads disk -> exporter ->
// share -> consumers rather than being implied by two edge labels.
const shareNode = () => c._derived.nodes.find((n) => n.kind === "share");
T("the exported share becomes a node",
  [shareNode()?.label, shareNode()?.tier, shareNode()?.servedBy],
  ["NAS1 (SMB)", "services", "c9a35110_sambanas"]);
T("the exporting add-on is edged to the share it exports",
  edgeLabels(addonId("c9a35110_sambanas"), shareNode().id), ["exports"]);
T("consumers hang off the share, not the hardware",
  [edgeLabels(drive().id, addonId("3b88f413_immich")), edgeLabels(shareNode().id, addonId("3b88f413_immich"))],
  [[], ["mounts (external_library)"]]);
T("a consumer referencing the bare label resolves the same way",
  edgeLabels(shareNode().id, addonId("beb500c8_kiwix")), ["mounts (zim_dir)"]);
T("a share takes the state of the add-on exporting it",
  (() => {
    const state = (addonState) => {
      const card = newCard();
      card._addons.find((a) => a.slug === "c9a35110_sambanas").state = addonState;
      card._derive();
      return card._nodeState(card._derived.nodes.find((n) => n.kind === "share")).status;
    };
    return [state("started"), state("stopped")];
  })(), ["started", "stopped"]);
T("only one share node per exported share",
  c._derived.nodes.filter((n) => n.kind === "share").length, 1);
T("the drive detail separates who mounts it from who reaches it over SMB",
  drive().usedBy.map((u) => [u.name, u.via, u.share]),
  [["Samba NAS", null, null], ["Immich", "Samba NAS", "NAS1"], ["Kiwix", "Samba NAS", "NAS1"]]);
T("a serial device with one claimant is still a direct owns edge",
  edgeLabels(c._derived.nodes.find((n) => n.id.startsWith("hw_tty")).id, addonId("45df7312_zigbee2mqtt")), ["owns (serial.port)"]);

// Without an SMB server in the picture, every claimant goes back to hanging
// off the drive directly - the old behaviour, unchanged.
T("no SMB server means direct edges for everyone",
  (() => {
    const plain = newCard();
    plain._addonInfoCache.set("c9a35110_sambanas", { name: "Samba NAS", options: { moredisks: ["NAS1"] } });
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
const tierTop = (card, tier) => Math.min(...card._derived.nodes.filter((n) => n.tier === tier).map((n) => n.y));
T("hardware wraps to a second row", new Set(hw(many).map((n) => n.y)).size, 2);
T("the tiers below are pushed down to clear the extra row",
  tierTop(many, "services") - tierTop(c, "services"), 130);
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
  "2026-09-02T12:58:22Z INF Starting tunnel tunnelID=d159e957-5122-42c1-94f5-68964ac4a209",
  "2026-09-02T12:58:22Z INF Settings: map[metrics:0.0.0.0:36500 no-autoupdate:true token:*****]",
  '2026-09-02T12:58:22Z INF Updated to new configuration config="{\\"ingress\\":[{\\"hostname\\":\\"ha.nicholastoo.com\\", \\"originRequest\\":{\\"noTLSVerify\\":true}, \\"service\\":\\"http://192.168.8.25:8123\\"}, {\\"hostname\\":\\"nas.nicholastoo.com\\", \\"originRequest\\":{}, \\"service\\":\\"http://192.168.8.25:8080\\"}, {\\"hostname\\":\\"share.nicholastoo.com\\", \\"service\\":\\"http://192.168.8.25:8095\\"}, {\\"service\\":\\"http_status:404\\"}], \\"warp-routing\\":{\\"enabled\\":false}}" version=15',
  '2026-09-02T12:58:32Z INF precheck component="DNS Resolution" status=pass target=region1.v2.argotunnel.com',
].join("\n");

T("ingress rules are read out of the log's escaped JSON",
  ctx.routesFromLog(CLOUDFLARED_LOG).map((r) => [r.hostname, r.service]),
  [
    ["ha.nicholastoo.com", "http://192.168.8.25:8123"],
    ["nas.nicholastoo.com", "http://192.168.8.25:8080"],
    ["share.nicholastoo.com", "http://192.168.8.25:8095"],
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
    ctx.looksLikeIngressProvider({ workgroup: "WORKGROUP", moredisks: ["NAS1"] }),
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
  [tierOf(c, "3b88f413_immich"), tierOf(c, "beb500c8_kiwix")], ["services", "services"]);
T("an add-on publishing hostnames for other things is remote access",
  tierOf(c, "9074a9fa_cloudflared"), "remote");
T("an SMB server is still a service, not network infrastructure",
  tierOf(c, "c9a35110_sambanas"), "services");
T("the role read off the ports reaches the node's notes",
  c._node(addonId("core_mosquitto")).notes, ["Publishes MQTT broker"]);

// The tunnel points at the host's own LAN address, which is how a remotely
// managed cloudflared writes its rules - so routes resolve by port.
T("a route to the host's LAN address on 8123 resolves to the host",
  c._routes.find((r) => r.hostname === "ha.example.com")?.targetId, "host");
T("a route to the host's LAN address on an add-on's port resolves to that add-on",
  c._routes.find((r) => r.hostname === "nas.example.com")?.targetId, addonId("3b88f413_immich"));
T("the public URL lands on what the tunnel actually reaches",
  [c._node("host").exposedUrl, c._node(addonId("3b88f413_immich")).exposedUrl],
  ["https://ha.example.com", "https://nas.example.com"]);
T("the tunnel is edged to what it exposes",
  c._derived.edges.filter((e) => e[0] === addonId("9074a9fa_cloudflared")).map((e) => e[2].label).sort(),
  ["ha.example.com", "nas.example.com"]);
T("an unroutable rule exposes nothing",
  (() => {
    const stray = newCard({}, { logRoutes: [{ hostname: "x.example.com", service: "http://10.9.9.9:80", viaSlug: "9074a9fa_cloudflared" }] });
    return stray._routes[0].targetId;
  })(), null);

// Z2M's options name the broker: `mqtt://core-mosquitto:1883`.
T("one add-on naming another in its options becomes an edge",
  c._derived.edges.find((e) => e[0] === addonId("45df7312_zigbee2mqtt") && e[1] === addonId("core_mosquitto"))?.[2].label,
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

// --- a way in is a way in, readable rules or not ----------------------------
// Tying the remote-access tier to successfully-parsed routes put a tunnel
// whose rules could not be read in among the ordinary services.
T("a tunnel whose rules cannot be read is still remote access",
  await (async () => {
    const card = newCard({}, { logRoutes: [] });
    card._addonInfoCache.set("9074a9fa_cloudflared", { name: "Cloudflared", network: {}, options: {} });
    card._fetchAddonLog = async (slug) =>
      slug === "9074a9fa_cloudflared"
        ? "INF Starting tunnel tunnelID=d159e957\nINF Registered tunnel connection connIndex=0"
        : "nothing of interest";
    await card._loadRouteLogs();
    card._derive();
    const node = card._node(addonId("9074a9fa_cloudflared"));
    return [node.tier, node.routes, node.notes.at(-1)];
  })(),
  ["remote", undefined, "Identified as a way in from outside, but none of its routes could be read"]);
T("and it is still one hop from the outside, labelled for what it is",
  await (async () => {
    const card = newCard({}, { logRoutes: [] });
    card._addonInfoCache.set("9074a9fa_cloudflared", { name: "Cloudflared", network: {}, options: {} });
    card._fetchAddonLog = async (slug) => (slug === "9074a9fa_cloudflared" ? "INF tunnelID=abc" : "");
    await card._loadRouteLogs();
    card._derive();
    return card._derived.edges.filter((e) => e[0] === "internet").map((e) => [e[1], e[2].label]);
  })(), [[addonId("9074a9fa_cloudflared"), "tunnel"]]);
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
  c._node(addonId("9074a9fa_cloudflared")).routes.length, 2);

// --- route resolution, step by step ----------------------------------------
// A private address is this machine whatever /network/info said. Depending on
// that endpoint having answered - and having named the same interface the
// tunnel rule points at - is the difference between every hostname landing
// and none of them landing.
T("a private address is recognised without help from /network/info",
  [
    ctx.isPrivateAddress("192.168.8.25"), ctx.isPrivateAddress("10.0.0.4"),
    ctx.isPrivateAddress("172.30.33.4"), ctx.isPrivateAddress("127.0.0.1"),
    ctx.isPrivateAddress("172.15.0.1"), ctx.isPrivateAddress("8.8.8.8"),
  ], [true, true, true, true, false, false]);
T("a rule resolves even when the network endpoint told us nothing",
  (() => {
    const blind = newCard();
    blind._system.network = null; // /network/info failed or was empty
    blind._derive();
    return blind._routes.find((r) => r.hostname === "nas.example.com")?.targetId;
  })(), addonId("3b88f413_immich"));

T("every rule records why it landed where it did",
  c._routes.map((r) => [r.hostname, r.trace.reason]),
  [
    ["ha.example.com", "port 8123 is Home Assistant's own"],
    ["nas.example.com", "port 8080 is published by this add-on"],
  ]);
T("an unmatched rule says what it was looking for and what was on offer",
  (() => {
    const stray = newCard({}, {
      logRoutes: [{ hostname: "x.example.com", service: "http://192.168.8.25:7777", viaSlug: "9074a9fa_cloudflared" }],
    });
    const t = stray._routes[0].trace;
    return [t.reason, t.port, t.local, t.candidates.some((line) => line.startsWith("Immich:"))];
  })(), ["no add-on reports port 7777", 7777, true, true]);
T("a rule pointing off this machine says so rather than failing silently",
  (() => {
    const off = newCard({}, {
      logRoutes: [{ hostname: "y.example.com", service: "http://203.0.113.9:80", viaSlug: "9074a9fa_cloudflared" }],
    });
    return off._routes[0].trace.reason;
  })(), "203.0.113.9 is not this machine, so the rule points somewhere else");

// A remotely-managed tunnel can be configured entirely outside Home
// Assistant, leaving an add-on whose options say nothing at all.
T("logs are scanned even when no add-on's options look like a tunnel",
  await (async () => {
    const card = newCard();
    card._addonInfoCache.set("9074a9fa_cloudflared", { name: "Cloudflared", network: {}, options: {} });
    const read = [];
    card._fetchAddonLog = async (slug) => {
      read.push(slug);
      return slug === "9074a9fa_cloudflared"
        ? 'INF config="{\\"ingress\\":[{\\"hostname\\":\\"found.example.com\\", \\"service\\":\\"http://192.168.8.25:8080\\"}]}"'
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
      return 'INF config="{\\"ingress\\":[{\\"hostname\\":\\"a.example.com\\", \\"service\\":\\"http://192.168.8.25:8080\\"}]}"';
    };
    await card._loadRouteLogs();
    return [card._routeScan.fallback, read];
  })(), [false, ["9074a9fa_cloudflared"]]);

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
    card._addonIcons.set("3b88f413_immich", "/api/hassio/addons/3b88f413_immich/icon?authSig=xyz");
    card._renderGraph();
    const svg = card._els.get(".smc-graph").innerHTML;
    return [svg.includes("<image href=\"/api/hassio/addons/3b88f413_immich/icon?authSig=xyz\""), svg.includes("clip-path=\"url(#smc-node-clip)\"")];
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
    ctx.servesSmb({ network: null, options: { workgroup: "WORKGROUP", moredisks: ["NAS1"] } }),
    ctx.servesSmb({ network: { "445/tcp": 445 }, options: {} }),
    ctx.servesSmb({ network: null, options: { workgroup_size: 4 } }),
    ctx.servesSmb({ network: null, options: { zim_dir: "NAS1" } }),
  ], [true, true, false, false]);

T("a host-networked exporter still produces the share and its consumers",
  (() => {
    const hostNet = newCard();
    hostNet._addonInfoCache.set("c9a35110_sambanas", {
      name: "Samba NAS", network: null, options: { workgroup: "WORKGROUP", moredisks: ["NAS1"] },
    });
    hostNet._derive();
    const share = hostNet._derived.nodes.find((n) => n.kind === "share");
    return [share?.label, hostNet._derived.edges.filter((e) => e[0] === share?.id).length];
  })(), ["NAS1 (SMB)", 2]);

// Attributing every unresolved rule to Home Assistant put someone else's
// subdomain on the host and left the real add-on with no hostname at all.
T("only Home Assistant's own port resolves to Home Assistant",
  (() => {
    const card = newCard();
    const addons = card._derived.nodes.filter((n) => n.kind === "addon");
    return [
      card._resolveService("http://192.168.8.25:8123", addons)?.id,
      card._resolveService("http://192.168.8.25:9999", addons),
    ];
  })(), ["host", null]);
T("a rule pointing at an add-on's own container address resolves to it",
  (() => {
    const card = newCard();
    card._addonInfoCache.get("3b88f413_immich").ip_address = "172.30.33.9";
    card._derive();
    const addons = card._derived.nodes.filter((n) => n.kind === "addon");
    return card._resolveService("http://172.30.33.9:3001", addons)?.id;
  })(), addonId("3b88f413_immich"));

// Even when a rule cannot be attributed, the hostname must still be visible.
T("a tunnel wears its hostnames whether or not they resolve",
  (() => {
    const stray = newCard({}, {
      logRoutes: [
        { hostname: "a.example.com", service: "http://192.168.8.25:8080", viaSlug: "9074a9fa_cloudflared" },
        { hostname: "b.example.com", service: "http://192.168.8.25:9999", viaSlug: "9074a9fa_cloudflared" },
      ],
    });
    const tunnel = stray._node(addonId("9074a9fa_cloudflared"));
    return [tunnel.routes.length, stray._nodeState(tunnel).sub, tunnel.notes.includes("b.example.com → http://192.168.8.25:9999")];
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
  [[addonId("9074a9fa_cloudflared"), "2 hostnames"]]);
T("a VPN add-on is an entry point even with no hostnames",
  (() => {
    const vpn = newCard({}, { logRoutes: [] });
    vpn._addons.push({ slug: "a0d7b954_tailscale", name: "Tailscale", state: "started" });
    vpn._addonInfoCache.set("a0d7b954_tailscale", { name: "Tailscale", network: { "41641/udp": 41641 }, options: {} });
    vpn._derive();
    return vpn._derived.edges.filter((e) => e[0] === "internet").map((e) => e[2].label);
  })(), ["VPN"]);
T("no way in means no boundary node - nothing to assert",
  (() => {
    const closed = newCard({}, { logRoutes: [] });
    closed._addons = closed._addons.filter((a) => a.slug !== "9074a9fa_cloudflared");
    closed._derive();
    return internet(closed);
  })(), undefined);
T("the boundary counts the ways in and the hostnames behind them",
  internet().notes, ["1 way in from outside", "2 public hostnames"]);

// The subdomain belongs on the node, not buried in a detail panel.
// "On the LAN" and "also public" are different facts, so both get a line.
T("an exposed service shows its LAN address and its public hostname",
  (() => {
    const node = c._node(addonId("3b88f413_immich"));
    return [node.badge, c._nodeState(node).subs];
  })(), ["nas.example.com", ["192.168.8.25:8080", "nas.example.com"]]);
// Asserted as a rule over every node rather than for one add-on, because
// "it works for Immich" was true while the host, a host-networked Samba and
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
  c._nodeState(c._node("host")).subs, ["192.168.8.25:8123", "ha.example.com"]);
T("a host-networked SMB server still gets an address, from the protocol",
  (() => {
    const hostNet = newCard();
    hostNet._addonInfoCache.set("c9a35110_sambanas", {
      name: "Samba NAS", network: null, options: { workgroup: "WG", moredisks: ["NAS1"] },
    });
    hostNet._derive();
    return hostNet._nodeState(hostNet._node(addonId("c9a35110_sambanas"))).subs;
  })(), ["192.168.8.25:445"]);
T("a share shows the address you would actually type",
  c._nodeState(c._derived.nodes.find((n) => n.kind === "share")).subs, ["\\\\192.168.8.25\\NAS1"]);

T("a LAN-only service shows just its address",
  c._nodeState(c._node(addonId("core_mosquitto"))).subs.includes("192.168.8.25:1883"), true);
T("a service with no reachable port shows neither",
  c._nodeState(c._node(addonId("beb500c8_kiwix"))).subs.some((l) => l.includes(":")), false);
T("a problem still comes first",
  c._nodeState(c._node(addonId("core_mosquitto"))).subs[0], "1/2 unavailable");
T("no more than three lines are ever drawn under a node",
  c._derived.nodes.every((n) => c._nodeState(n).subs.length <= 3), true);
T("Home Assistant itself wears the hostname routed to port 8123",
  [c._node("host").badge, c._node("host").exposedUrl],
  ["ha.example.com", "https://ha.example.com"]);
T("a node with no route has no hostname badge",
  c._node(addonId("beb500c8_kiwix")).badge, undefined);
T("the status bar says how much is reachable from outside",
  (() => {
    const item = c._statusItems().find((i) => i.key === "exposed");
    return [item?.value, item?.note.includes("nas.example.com")];
  })(), ["2 hostnames", true]);

// --- reading services out of a log -----------------------------------------
// Immich announces its machine-learning sidecar at runtime rather than in its
// options: "Machine learning server became healthy (http://192.168.8.25:3004)".
const IMMICH_LOG = [
  "[Nest] LOG [Api:Bootstrap] Immich Server is listening on http://127.0.0.1:2283 [v3.1.0] [production]",
  "[Nest] LOG [Api:MachineLearningRepository] Machine learning server became healthy (http://192.168.8.25:3004).",
  "[Nest] LOG [Microservices:MachineLearningRepository] Machine learning server became healthy (http://192.168.8.25:3004).",
  '[Nest] LOG [Api:StorageService] Verifying system mount folder checks: {"mountChecks":{"library":true}}',
].join("\n");

T("host:port endpoints are read out of a log and deduplicated",
  ctx.servicesFromLog(IMMICH_LOG).map((d) => d.service),
  ["http://127.0.0.1:2283", "http://192.168.8.25:3004"]);
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
    dial._addons.push({ slug: "beb500c8_immich_ml", name: "Immich ML", state: "started" });
    dial._addonInfoCache.set("beb500c8_immich_ml", { name: "Immich ML", network: { "3003/tcp": 3004 }, options: {} });
    dial._logServices = [{ service: "http://192.168.8.25:3004", host: "192.168.8.25", port: 3004, fromSlug: "3b88f413_immich" }];
    dial._derive();
    return dial._derived.edges
      .filter((e) => e[0] === addonId("3b88f413_immich") && e[1] === addonId("beb500c8_immich_ml"))
      .map((e) => e[2].label);
  })(), [":3004 (log)"]);
T("an endpoint that resolves to the host itself is not drawn",
  (() => {
    const dial = newCard({ scan_service_logs: true });
    dial._logServices = [{ service: "http://192.168.8.25:8123", host: "192.168.8.25", port: 8123, fromSlug: "3b88f413_immich" }];
    dial._derive();
    return dial._derived.edges.some((e) => e[0] === addonId("3b88f413_immich") && e[1] === "host");
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
    [{ slug: "45df7312_zigbee2mqtt", name: "Zigbee2MQTT", update_available: true }]
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
    [{ slug: "45df7312_zigbee2mqtt", name: "Zigbee2MQTT", update_available: true }]
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
        { text: "NAS1 (SMB loop)", x: 600, y: 200 },
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

process.exit(all ? 0 : 1);
