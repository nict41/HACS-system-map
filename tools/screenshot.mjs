// Renders the card against fixture data in headless Chromium and writes
// docs/screenshot.png for the README.
//
//   npm install --no-save playwright
//   npx playwright install chromium          (or set PLAYWRIGHT_CHROMIUM_PATH
//                                             to a Chromium already on disk)
//   node tools/screenshot.mjs
//
// The point is a screenshot that can be regenerated when the card changes,
// rather than a stale image nobody can reproduce. The fixtures below are
// representative rather than real - one add-on is stopped and one integration
// has a dead entity, so the states the card is *for* actually appear.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
// Overrides so one harness can render the README shot, a wide-screen layout,
// or a node mid-selection, rather than three near-identical scripts.
const CONFIG = {
  graph_height: Number(process.env.SMC_HEIGHT || 900),
  ...(process.env.SMC_COLUMNS ? { columns: Number(process.env.SMC_COLUMNS) } : {}),
};
const out = process.env.SMC_OUT || path.join(root, "docs", "screenshot.png");
const cardSource = fs.readFileSync(path.join(root, "system-map-card.js"), "utf8");

const ADDONS = [
  ["45df7312_zigbee2mqtt", "Zigbee2MQTT", "started"],
  ["core_mosquitto", "Mosquitto broker", "started"],
  ["c9a35110_sambanas", "Samba NAS", "started"],
  ["3b88f413_immich", "Immich", "started"],
  ["beb500c8_immich_ml", "Immich ML", "started"],
  ["beb500c8_kiwix", "Kiwix", "started"],
  ["a0d7b954_adguard", "AdGuard Home", "started"],
  ["a0d7b954_tailscale", "Tailscale", "started"],
  ["9074a9fa_cloudflared", "Cloudflared", "started"],
  ["beb500c8_wordpress", "WordPress", "started"],
  ["beb500c8_pingvin_share", "Pingvin Share", "started"],
  ["beb500c8_nas1_usb_watcher", "NAS1 USB Watcher", "started"],
  ["7b7df7b9_claudecode", "Claude Code", "started"],
  ["core_ssh", "Advanced SSH & Web Terminal", "started"],
  ["core_configurator", "File editor", "started"],
  ["a0d7b954_nodered", "Node-RED", "started"],
  ["core_mariadb", "MariaDB", "stopped"],
].map(([slug, name, state]) => ({ slug, name, state, version: "1.4.2", icon: true, update_available: slug.includes("zigbee") }));

const ENTRIES = [
  ["mqtt", "Mosquitto"], ["zha", "ZHA"], ["asusrouter", "ASUS Router"], ["huawei_lte", "Huawei LTE"],
  ["hue", "Hue Bridge"], ["mjpeg", "3D Print Cam"], ["spotify", "Spotify"], ["sonos", "Sonos"],
  ["met", "Met.no"], ["sun", "Sun"], ["shelly", "Shelly Plug"], ["esphome", "Desk Sensor"],
  ["cast", "Google Cast"], ["hacs", "HACS"], ["mobile_app", "Phone"], ["tado", "Tado"],
  ["octoprint", "OctoPrint"], ["systemmonitor", "System Monitor"], ["backup", "Backup"],
  ["zeroconf", "Zeroconf"], ["ipp", "Printer"], ["upnp", "UPnP"],
  // Two integrations that make an entry per device and per helper. Both are
  // the case the map merges, so the shot shows the merged nodes rather than
  // a row of identical circles.
  ["localtuya", "Desk plug"], ["localtuya", "Bedroom lamp"], ["localtuya", "Fan"],
  ["utility_meter", "Energy daily"], ["utility_meter", "Energy monthly"],
  ["utility_meter", "Water daily"], ["switch_as_x", "Kettle as switch"],
].map(([domain, title], i) => ({
  entry_id: `e_${domain}_${i}`, domain, title, source: "user",
  state: "loaded", disabled_by: domain === "spotify" ? "user" : null,
}));

// One integration with a dead entity, so the problem ring is in the shot.
const ENTITIES = [
  ...ENTRIES.flatMap((e, i) => [
    { entity_id: `sensor.${e.entry_id}_a`, platform: e.domain, config_entry_id: e.entry_id, device_id: `d_${e.entry_id}`, area_id: null },
    { entity_id: `sensor.${e.entry_id}_b`, platform: e.domain, config_entry_id: e.entry_id, device_id: `d_${e.entry_id}`, area_id: null },
  ]),
  { entity_id: "sensor.zigbee_dead", platform: "mqtt", config_entry_id: "e_mqtt_0", device_id: "d_mqtt" },
];

const STATES = Object.fromEntries([
  ...ENTITIES.map((e) => [e.entity_id, { state: e.entity_id.includes("dead") ? "unavailable" : "21.4", attributes: {} }]),
  ["sensor.processor_use", { state: "2", attributes: { unit_of_measurement: "%" } }],
  ["sensor.system_monitor_memory_use_percent", { state: "15.8", attributes: { unit_of_measurement: "%" } }],
  ["sensor.disk_use_percent_config", { state: "9.3", attributes: { unit_of_measurement: "%" } }],
  ["update.home_assistant_core_update", { state: "on", attributes: { friendly_name: "Home Assistant Core" } }],
]);

// Verbatim shape of a remotely-managed cloudflared's log: the ingress rules
// arrive as JSON escaped into a quoted log field, pointing at the host's own
// LAN address and a port per service.
const CLOUDFLARED_LOG = [
  "[13:58:22] INFO: Using Cloudflare Remote Management Tunnel",
  "[13:58:22] INFO: All app (add-on) configuration options except tunnel_token will be ignored.",
  '2026-09-02T12:58:22Z INF Updated to new configuration config="{\\"ingress\\":[' +
    '{\\"hostname\\":\\"ha.example.com\\", \\"service\\":\\"http://192.168.8.25:8123\\"}, ' +
    '{\\"hostname\\":\\"nas.example.com\\", \\"service\\":\\"http://192.168.8.25:8080\\"}, ' +
    '{\\"hostname\\":\\"example.com\\", \\"service\\":\\"http://192.168.8.25:5051\\"}, ' +
    '{\\"hostname\\":\\"share.example.com\\", \\"service\\":\\"http://192.168.8.25:8095\\"}, ' +
    '{\\"service\\":\\"http_status:404\\"}]}" version=15',
].join("\n");

const now = Date.now();
const RESPONSES = {
  "/addons": { addons: ADDONS },
  "/host/info": { hostname: "homeassistant", disk_total: 916.7, disk_free: 816.7, kernel: "6.6.7", operating_system: "Home Assistant OS 18.2", boot_timestamp: (now - 14 * 864e5) * 1000 },
  "/core/info": { version: "2026.8.3", version_latest: "2026.9.0", update_available: true, arch: "amd64", machine: "generic-x86-64" },
  "/os/info": { version: "18.2", version_latest: "18.2", update_available: false, board: "generic-x86-64" },
  "/supervisor/info": { version: "2026.08.0", channel: "stable", update_available: false },
  "/network/info": { host_internet: true, supervisor_internet: true, interfaces: [{ interface: "enp1s0", type: "ethernet", primary: true, connected: true, ipv4: { address: ["192.168.8.25/24"] } }] },
  "/backups": { backups: [{ slug: "b1", name: "Automatic backup", date: new Date(now - 41 * 60000).toISOString(), size: 512 }] },
  "/hardware/info": {
    devices: [{ name: "ttyUSB0", subsystem: "tty", dev_path: "/dev/ttyUSB0", by_id: "/dev/serial/by-id/usb-ITEAD_SONOFF_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00-port0" }],
    drives: [
      { id: "wdc", vendor: "WDC", model: "WD8003FFBX-68B9AN0", serial: "X1", size: 8001563222016, connection_bus: "usb", removable: true,
        filesystems: [{ device: "/dev/sda1", name: "NAS1", size: 8e12, system: false, mount_points: ["/media/NAS1"] }] },
      { id: "sandisk", vendor: "SanDisk", model: "Extreme SSD", serial: "X2", size: 1000204886016, connection_bus: "usb", removable: true,
        filesystems: [{ device: "/dev/sdb1", name: "MEDIA", size: 1e12, system: false, mount_points: ["/media/MEDIA"] }] },
    ],
  },
};

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  /* Home Assistant's dark theme variables, so the card renders as it does in HA. */
  :root {
    --primary-text-color:#e1e1e1; --secondary-text-color:#9b9b9b; --disabled-text-color:#6f6f6f;
    --primary-color:#03a9f4; --accent-color:#ff9800; --success-color:#43a047; --error-color:#db4437;
    --warning-color:#ff9800; --card-background-color:#1c1c1c; --secondary-background-color:#282828;
    --divider-color:#474747; --code-font-family:monospace;
    color-scheme: dark;
  }
  body { margin:0; padding:16px; background:#111111; font-family:Roboto,system-ui,sans-serif; }
  ha-card { display:block; background:var(--card-background-color); border-radius:12px;
            box-shadow:0 2px 4px rgba(0,0,0,.4); color:var(--primary-text-color); }
</style></head><body><div id="host"></div>
<script>${cardSource}</script>
<script>
  const ADDONS = ${JSON.stringify(ADDONS)};
  const CONFIG = ${JSON.stringify(CONFIG)};
  const SELECT = ${JSON.stringify(process.env.SMC_SELECT || "")};
  const DEGRADE = ${JSON.stringify(!!process.env.SMC_DEGRADE)};
  const FIND = ${JSON.stringify(process.env.SMC_FIND || "")};
  const CLOUDFLARED_LOG = ${JSON.stringify(CLOUDFLARED_LOG)};
  const RESPONSES = ${JSON.stringify(RESPONSES)};
  const ENTRIES = ${JSON.stringify(ENTRIES)};
  const ENTITIES = ${JSON.stringify(ENTITIES)};
  const STATES = ${JSON.stringify(STATES)};
  const hass = {
    states: STATES,
    connection: {
      async sendMessagePromise(msg) {
        if (msg.type === "supervisor/api") {
          // SMC_DEGRADE stands in for a Core or Container install, which has
          // no Supervisor at all - roughly half of what this card reads.
          if (DEGRADE) throw new Error("Not found");
          const key = msg.endpoint.replace(/\\/addons\\/[^/]+\\/(info|stats|logs)$/, "");
          if (msg.endpoint in RESPONSES) return { data: RESPONSES[msg.endpoint] };
          if (msg.endpoint.endsWith("/logs")) {
            return msg.endpoint.includes("cloudflared") ? CLOUDFLARED_LOG : "";
          }
          if (msg.endpoint.endsWith("/info")) {
            const slug = msg.endpoint.split("/")[2];
            // Samba mounts the drive by label and publishes it on 445; Immich
            // and Kiwix reach the same disk through that share. Fixtured this
            // way so the screenshot shows the republish chain, which is the
            // part of the derivation that is hardest to describe in words.
            const ADDON_OPTIONS = {
              "45df7312_zigbee2mqtt": { network: { "8099/tcp": 8099 }, options: { serial: { port: RESPONSES["/hardware/info"].devices[0].by_id }, mqtt: { server: "mqtt://core-mosquitto:1883" } } },
              core_mosquitto: { network: { "1883/tcp": 1883, "8883/tcp": 8883 }, options: {} },
              c9a35110_sambanas: { network: { "445/tcp": 445, "139/tcp": 139 }, options: { workgroup: "WORKGROUP", moredisks: ["NAS1"] } },
              "3b88f413_immich": { network: { "3001/tcp": 8080 }, options: { external_library: "/media/NAS1/photos" } },
              beb500c8_kiwix: { options: { zim_dir: "NAS1" } },
              a0d7b954_adguard: { network: { "53/tcp": 53, "3000/tcp": 3000 }, options: {} },
              a0d7b954_tailscale: { network: { "41641/udp": 41641 }, options: {} },
              // Remotely managed, so its options say nothing and the routes
              // are only in the log - the case the log parser exists for.
              "9074a9fa_cloudflared": { network: {}, options: { tunnel_token: "ey..." } },
              beb500c8_wordpress: { network: { "80/tcp": 5051 }, options: {} },
              beb500c8_pingvin_share: { network: { "3000/tcp": 8095 }, options: {} },
            };
            const name = (ADDONS.find((a) => a.slug === slug) || {}).name || slug;
            return { data: { name, state: "started", version: "1.4.2", options: {}, ...(ADDON_OPTIONS[slug] || {}) } };
          }
          throw new Error("no fixture for " + msg.endpoint);
        }
        if (msg.type === "auth/sign_path" && msg.path.endsWith("/logs")) {
          // Logs are signed and fetched exactly like icons now, so the stand-in
          // has to distinguish them - handing back an icon for a log request is
          // how the fixture silently produced a map with no routes on it.
          const slug = msg.path.split("/")[4];
          const body = slug.includes("cloudflared") ? CLOUDFLARED_LOG : slug + " started";
          return { path: "data:text/plain;charset=utf-8," + encodeURIComponent(body) };
        }
        if (msg.type === "auth/sign_path") {
          // Stands in for Supervisor's real icon endpoint: a distinct mark
          // per add-on, so the rendered image shows what shipping icons
          // actually look like rather than a wall of identical clouds.
          const slug = msg.path.split("/")[4];
          const seed = [...slug].reduce((a, ch) => a + ch.charCodeAt(0), 0);
          const initials = (ADDONS.find((a) => a.slug === slug)?.name || slug)
            .replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2)
            .map((w) => w[0].toUpperCase()).join("");
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
            '<rect width="64" height="64" fill="hsl(' + (seed % 360) + ',55%,42%)"/>' +
            '<text x="32" y="43" font-family="sans-serif" font-size="27" font-weight="700" fill="white" text-anchor="middle">' +
            initials + '</text></svg>';
          return { path: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) };
        }
        if (msg.type === "config_entries/get") return ENTRIES;
        if (msg.type === "config/entity_registry/list") return ENTITIES;
        if (msg.type === "config/device_registry/list")
          return ENTRIES.map((e) => ({ id: "d_" + e.domain, config_entries: [e.entry_id], area_id: "lounge" }));
        if (msg.type === "config/area_registry/list") return [{ area_id: "lounge", name: "Lounge" }];
        if (msg.type === "repairs/list_issues") return { issues: [] };
        if (msg.type === "history/history_during_period")
          return { "sensor.processor_use": Array.from({ length: 40 }, (_, i) => ({ s: String(2 + (i === 12 ? 9 : Math.random() * 2)) })) };
        throw new Error("no fixture for " + msg.type);
      },
      async subscribeMessage() { return async () => {}; },
    },
  };
  const card = document.createElement("system-map-card");
  // Taller than a dashboard default on purpose: the map is about 1220x1730
  // user units once both auto-grids are in it, so a short graph area fits it
  // by height and leaves the sides empty. ~1180/0.71 is the height at which
  // it fills the width instead.
  card.setConfig({ type: "custom:system-map-card", refresh_interval: 0, show_debug: true, ...CONFIG });
  document.getElementById("host").appendChild(card);
  card.hass = hass;
  // SMC_SELECT drives a real selection, so "what does clicking a node look
  // like" is something to look at rather than reason about from the markup.
  window.__ready = new Promise((r) =>
    setTimeout(async () => {
      if (SELECT) {
        await card._openDetail("node", SELECT);
        card._panToHighlight?.();
      }
      if (FIND) await card._highlightEntity(FIND);
      setTimeout(r, 300);
    }, 3500)
  );
</script></body></html>`;

// PLAYWRIGHT_CHROMIUM_PATH lets a machine with Chromium already on disk use
// it rather than downloading a second copy pinned to the npm package.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
);
const tab = await browser.newPage({
  viewport: { width: Number(process.env.SMC_WIDTH || 1240), height: 1000 },
  deviceScaleFactor: 2,
});
const errors = [];
tab.on("pageerror", (e) => errors.push(String(e)));
await tab.setContent(page);
await tab.evaluate(() => window.__ready);
fs.mkdirSync(path.dirname(out), { recursive: true });
await tab.screenshot({ path: out, fullPage: true });

// SMC_EXPORT=<path> also drives the card's own PNG export and saves what it
// produces, so "the card renders but the export doesn't" is a difference you
// can look at rather than reason about.
if (process.env.SMC_EXPORT) {
  const exported = await tab.evaluate(async () => {
    const card = document.querySelector("system-map-card");
    const markup = await card._exportSvg();
    if (!markup) return { error: "the card produced no SVG to export" };
    const nat = card._naturalViewBox;

    // Check the export against what the browser actually painted, rather
    // than against how it looks to whoever is reading the PNG. Every earlier
    // export bug was of one kind - some styling did not survive into the file
    // - and every one of them was invisible until somebody stared at the
    // image and noticed the font was wrong. These compare the two directly.
    const live = card.querySelector(".smc-graph svg");
    const complaints = [];
    if (/<style/.test(markup))
      complaints.push("the export still ships a stylesheet, so it can still lose one");

    // Each distinct colour, size and anchor the live map is drawn with has to
    // appear somewhere in the exported file. A dropped rule takes its values
    // with it, which is exactly what this catches.
    const want = new Map();
    for (const el of live.querySelectorAll("text, rect, circle, line, path")) {
      const cs = getComputedStyle(el);
      for (const prop of ["fill", "stroke", "font-size", "text-anchor"]) {
        const v = cs.getPropertyValue(prop);
        if (v && v !== "none" && v !== "normal") want.set(`${prop}: ${v}`, (want.get(`${prop}: ${v}`) || 0) + 1);
      }
    }
    for (const [decl, count] of want) {
      const [prop, value] = decl.split(": ");
      // Rare one-offs are not worth failing a build over; anything the map
      // uses more than a handful of times is structural.
      if (count < 4) continue;
      if (!markup.includes(`${prop}="${value}"`)) complaints.push(`no element in the export has ${decl}`);
    }

    // text-transform restyles glyphs rather than the string, so it cannot
    // travel as an attribute - the tier labels came out in sentence case.
    for (const el of live.querySelectorAll("text")) {
      if (getComputedStyle(el).textTransform !== "uppercase") continue;
      const upper = (el.textContent || "").toUpperCase();
      if (upper && !markup.includes(upper)) complaints.push(`"${el.textContent}" is not upper-cased in the export`);
      break;
    }
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    const png = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = nat.w * 2;
        canvas.height = nat.h * 2;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = getComputedStyle(card).getPropertyValue("--card-background-color") || "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    return { markup, png, nat, complaints };
  });
  if (exported.complaints?.length) {
    console.error("The export does not match what the card drew:");
    for (const c of exported.complaints) console.error(`  - ${c}`);
    process.exitCode = 1;
  }
  if (exported.error || !exported.png) {
    console.error(`Export failed: ${exported.error || "the browser refused to rasterise the map"}`);
    process.exitCode = 1;
  } else {
    fs.writeFileSync(process.env.SMC_EXPORT, Buffer.from(exported.png.split(",")[1], "base64"));
    fs.writeFileSync(process.env.SMC_EXPORT.replace(/\.png$/, ".svg"), exported.markup);
    console.log(
      `Wrote ${process.env.SMC_EXPORT} (${exported.nat.w}x${exported.nat.h} user units, ` +
        `${(exported.markup.length / 1024).toFixed(0)}KB of SVG)`
    );
  }
}

await browser.close();

if (errors.length) {
  console.error("Page errors while rendering:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`Wrote ${path.relative(root, out)}`);
