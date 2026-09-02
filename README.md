# System Map Card

A Lovelace custom card that renders a live, layered topology map of a Home
Assistant server: physical hardware, which add-ons own each piece of
hardware and why, LAN network infrastructure, remote-access entry/exit
points, confirmed externally-exposed services, and every other installed
add-on in an auto-generated grid so nothing is ever missing.

All data is fetched live from Home Assistant's own WebSocket API (Supervisor
add-on list/info, config entries, device/entity registries) - no backend
add-on required.

## Features

- Layered, colour-coded tiers (physical hardware / services using that
  hardware / network infrastructure / remote access), each drawn as a
  bounding box computed from the actual node positions
- Zoom (mouse wheel or on-screen buttons) and pan (click-drag)
- Click any node for live detail: state, version, internal port, and (where
  applicable) its public URL
- "Hide inactive" filter for stopped add-ons and disabled/ignored
  integrations
- Entity finder: search for any entity and the card highlights which
  node(s) actually serve it, resolving through helper entities (e.g.
  `switch_as_x`) back to their real source
- MDI icons per node

## Install via HACS

1. HACS → the three-dot menu (top right) → **Custom repositories**
2. Add this repository's URL, category **Dashboard**
3. Find "System Map Card" in HACS and install it
4. Add a card to any dashboard with `type: custom:system-map-card`

HACS registers the Lovelace resource automatically - no manual resource
step needed.

## Configuration

No configuration is required. Optional:

```yaml
type: custom:system-map-card
title: System Map # defaults to "System Map"
```

## Notes

The graph's node positions, edges, and "why" text for each node are
hand-maintained (`HUB_LAYOUT` / `HUB_EDGES` / `ROLES` in the source) to
reflect one specific home lab's topology - hardware ownership, DNS/remote
access wiring, and confirmed Cloudflare Tunnel routes. If you fork this for
your own setup, that's the section to rewrite; everything else (live status,
the entity finder, the auto-generated "other add-ons" grid) is generic and
works against any Home Assistant instance without changes.
