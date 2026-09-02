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
const out = path.join(root, "docs", "screenshot.png");
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
].map(([slug, name, state]) => ({ slug, name, state, version: "1.4.2", update_available: slug.includes("zigbee") }));

const ENTRIES = [
  ["mqtt", "Mosquitto"], ["zha", "ZHA"], ["asusrouter", "ASUS Router"], ["huawei_lte", "Huawei LTE"],
  ["hue", "Hue Bridge"], ["mjpeg", "3D Print Cam"], ["spotify", "Spotify"], ["sonos", "Sonos"],
  ["met", "Met.no"], ["sun", "Sun"], ["shelly", "Shelly Plug"], ["esphome", "Desk Sensor"],
  ["cast", "Google Cast"], ["hacs", "HACS"], ["mobile_app", "Phone"], ["tado", "Tado"],
  ["octoprint", "OctoPrint"], ["systemmonitor", "System Monitor"], ["backup", "Backup"],
  ["zeroconf", "Zeroconf"], ["ipp", "Printer"], ["upnp", "UPnP"],
].map(([domain, title], i) => ({
  entry_id: `e_${domain}`, domain, title, source: "user",
  state: "loaded", disabled_by: domain === "spotify" ? "user" : null,
}));

// One integration with a dead entity, so the problem ring is in the shot.
const ENTITIES = [
  ...ENTRIES.flatMap((e, i) => [
    { entity_id: `sensor.${e.domain}_a`, platform: e.domain, config_entry_id: e.entry_id, device_id: `d_${e.domain}`, area_id: null },
    { entity_id: `sensor.${e.domain}_b`, platform: e.domain, config_entry_id: e.entry_id, device_id: `d_${e.domain}`, area_id: null },
  ]),
  { entity_id: "sensor.zigbee_dead", platform: "mqtt", config_entry_id: "e_mqtt", device_id: "d_mqtt" },
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
  "/network/info": { host_internet: true, supervisor_internet: true, interfaces: [{ interface: "enp1s0", type: "ethernet", primary: true, connected: true, ipv4: { address: ["192.168.8.50/24"] } }] },
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
  card.setConfig({ type: "custom:system-map-card", graph_height: 900, refresh_interval: 0 });
  document.getElementById("host").appendChild(card);
  card.hass = hass;
  window.__ready = new Promise((r) => setTimeout(r, 3500));
</script></body></html>`;

// PLAYWRIGHT_CHROMIUM_PATH lets a machine with Chromium already on disk use
// it rather than downloading a second copy pinned to the npm package.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
);
const tab = await browser.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
tab.on("pageerror", (e) => errors.push(String(e)));
await tab.setContent(page);
await tab.evaluate(() => window.__ready);
fs.mkdirSync(path.dirname(out), { recursive: true });
await tab.screenshot({ path: out, fullPage: true });
await browser.close();

if (errors.length) {
  console.error("Page errors while rendering:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`Wrote ${path.relative(root, out)}`);
