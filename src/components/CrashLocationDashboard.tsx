import { useMemo, useState } from "react";
import { useMqttFleet } from "../hooks/useMqttFleet";
import { AlertTriangle, Clock3, Copy, ExternalLink, MapPin, Navigation, Radio, Search, ShieldCheck } from "lucide-react";

type DeviceStatus = "crash" | "online";

type DevicePacket = {
  device: string;
  lat: number;
  lon: number;
  valid: 0 | 1;
  ts_ms: number;
  status: DeviceStatus;
};

// ESP32 / HiveMQ payload format expected by this dashboard:
// {
//   "device": "vestmicro-esp32-01",
//   "lat": 3.139000,
//   "lon": 101.686900,
//   "valid": 1,
//   "ts_ms": 1714221000123
// }
//
// Integration placeholder:
// Replace this demo `fleet` array with live packets from your source code later.
// Recommended flow: ESP32 -> HiveMQ MQTT broker -> backend/API bridge -> dashboard state.
// The dashboard already expects `device`, `lat`, `lon`, `valid`, and `ts_ms` from each packet.


function timeAgo(tsMs: number) {
  const now = Date.now();
  const seconds = Math.max(1, Math.round((now - tsMs) / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
}

const statusStyles: Record<DeviceStatus, string> = {
  crash: "bg-emergency text-emergency-foreground",
  online: "bg-safe text-safe-foreground",
};

const statusDot: Record<DeviceStatus, string> = {
  crash: "bg-emergency shadow-emergency-pulse",
  online: "bg-safe shadow-pulse",
};

function DeviceCard({ device, active, onSelect }: { device: DevicePacket; active: boolean; onSelect: () => void }) {
  const now = Date.now();
  const stale = now - device.ts_ms > 30000;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition hover:border-sidebar-ring ${
        active ? "border-sidebar-ring bg-sidebar-accent" : device.status === "crash" ? "border-emergency bg-emergency-muted" : "border-sidebar-border bg-sidebar"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot[device.status]}`} />
            <h3 className="truncate font-mono text-sm font-semibold text-sidebar-foreground">{device.device}</h3>
          </div>
          <p className={`mt-2 text-xs font-medium ${stale ? "text-warning" : "text-muted-foreground"}`}>Last seen {timeAgo(device.ts_ms)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${statusStyles[device.status]}`}>
          {device.status === "crash" ? "Crash" : "Online"}
        </span>
      </div>
    </button>
  );
}

function SummaryField({ label, value, icon: Icon }: { label: string; value: string; icon: typeof ShieldCheck }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className="mt-3 truncate text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function CrashLocationDashboard() {
  // Use the MQTT fleet hook inside the component (fixes invalid hook call)
  const { fleet: fleetObj } = useMqttFleet();
  // Convert fleet object to array of DevicePacket
  const fleet: DevicePacket[] = Object.values(fleetObj).map((entry) => ({
    device: entry.data.deviceId || entry.data.device || "",
    lat: entry.data.lat ?? 0,
    lon: entry.data.lon ?? 0,
    valid: entry.data.valid ?? 0,
    ts_ms: entry.data.ts_ms ?? entry.data.timestamp ?? entry.lastSeen,
    status: entry.status,
  }));
  // Later integration point:
  // 1. Subscribe to your HiveMQ topic in a backend/API layer.
  // 2. Validate the incoming JSON payload matches DevicePacket fields.
  // 3. Update this fleet data from live messages instead of the demo array above.
  // 4. Mark a device as `status: "crash"` when your crash-detection source code reports an incident.
  const priorityDevice = fleet.find((device: DevicePacket) => device.status === "crash") ?? fleet[0];
  const [selectedDeviceId, setSelectedDeviceId] = useState(priorityDevice?.device ?? "");
  const [search, setSearch] = useState("");

  const filteredFleet = useMemo(
    () => fleet.filter((device: DevicePacket) => device.device.toLowerCase().includes(search.toLowerCase().trim())),
    [search, fleet],
  );
  const activeDevice = fleet.find((device: DevicePacket) => device.device === selectedDeviceId) ?? priorityDevice;
  const incidentQueue = filteredFleet.filter((device: DevicePacket) => device.status === "crash");
  const normalFleet = filteredFleet.filter((device: DevicePacket) => device.status === "online");
  const currentState = activeDevice?.status === "crash" ? "Crash Detected" : "Online";
  const coordinates = activeDevice ? `${activeDevice.lat.toFixed(6)}, ${activeDevice.lon.toFixed(6)}` : "";
  // Google Maps handoff URL generated from the selected device coordinates.
  const googleMapsUrl = activeDevice ? `https://www.google.com/maps/search/?api=1&query=${activeDevice.lat.toFixed(6)},${activeDevice.lon.toFixed(6)}` : "";
  // Embedded map auto-centers around the selected/crash device coordinates.
  const mapSrc = activeDevice ? `https://www.openstreetmap.org/export/embed.html?bbox=${activeDevice.lon - 0.018}%2C${
    activeDevice.lat - 0.013
  }%2C${activeDevice.lon + 0.018}%2C${activeDevice.lat + 0.013}&layer=mapnik&marker=${activeDevice.lat}%2C${activeDevice.lon}` : "";

  // If there are no devices, show a friendly message and return early
  if (!activeDevice) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">No devices found</h1>
          <p className="text-muted-foreground">Waiting for device data from MQTT. Make sure your ESP is publishing to the correct topic.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-390 lg:grid-cols-[360px_1fr]">
        <aside className="border-b border-border bg-sidebar p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-sidebar-foreground">VestMicro</p>
                <p className="text-xs text-muted-foreground">Fleet response console</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-safe">
              <Radio className="h-4 w-4" aria-hidden="true" />
              Live
            </div>
          </div>

          <label className="mt-5 flex items-center gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-2 text-sm text-muted-foreground">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Search device ID"
            />
          </label>

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Active incidents</h2>
              <span className="rounded-full bg-emergency px-2.5 py-1 text-xs font-bold text-emergency-foreground">{incidentQueue.length}</span>
            </div>
            <div className="grid gap-3">
              {incidentQueue.map((device) => (
                <DeviceCard key={device.device} device={device} active={device.device === activeDevice.device} onSelect={() => setSelectedDeviceId(device.device)} />
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Fleet devices</h2>
            <div className="grid gap-3">
              {normalFleet.map((device) => (
                <DeviceCard key={device.device} device={device} active={device.device === activeDevice.device} onSelect={() => setSelectedDeviceId(device.device)} />
              ))}
            </div>
          </section>
        </aside>

        <section className="grid content-start gap-5 p-4 sm:p-6 lg:p-8">
          <header>
            <div
              className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${
                activeDevice.status === "crash" ? "bg-emergency-muted text-emergency" : "bg-safe-muted text-safe"
              }`}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              State: <strong>{currentState}</strong>
            </div>
            <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">Incident Command</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {activeDevice.device} is selected for precise GPS review and location handoff.
            </p>
          </header>

          <div className="grid gap-4 md:grid-cols-3">
            <SummaryField label="Device Identity" value={activeDevice.device} icon={ShieldCheck} />
            <SummaryField label="Incident Status" value={currentState} icon={AlertTriangle} />
            <SummaryField label="Precise Location" value={coordinates} icon={MapPin} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <article className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Live location map</h2>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">{coordinates}</p>
                </div>
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
                >
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  Open in Google Maps
                </a>
              </div>
              <div className="relative min-h-90 bg-muted sm:aspect-video">
                <iframe key={activeDevice.device} title="Emergency GPS location" src={mapSrc} className="h-full w-full border-0 grayscale-12" loading="lazy" />
                <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-soft backdrop-blur">
                  <p className={`text-xs font-bold uppercase tracking-[0.14em] ${activeDevice.status === "crash" ? "text-emergency" : "text-safe"}`}>Map pin</p>
                  <p className="mt-1 font-mono text-sm text-foreground">{coordinates}</p>
                </div>
              </div>
            </article>

            <article className={`rounded-lg border bg-card p-5 shadow-lift ${activeDevice.status === "crash" ? "border-emergency" : "border-border"}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className={`text-sm font-bold uppercase tracking-[0.14em] ${activeDevice.status === "crash" ? "text-emergency" : "text-safe"}`}>Location Handoff</p>
                  <h2 className="mt-2 text-2xl font-semibold text-foreground">Golden Action</h2>
                </div>
                <MapPin className={`h-6 w-6 ${activeDevice.status === "crash" ? "text-emergency" : "text-safe"}`} aria-hidden="true" />
              </div>

              <dl className="mt-6 grid gap-3 text-sm">
                <div className="rounded-lg bg-secondary p-4">
                  <dt className="text-muted-foreground">Device ID</dt>
                  <dd className="mt-1 font-mono font-semibold text-foreground">{activeDevice.device}</dd>
                </div>
                <div className="rounded-lg bg-secondary p-4">
                  <dt className="text-muted-foreground">Coordinates</dt>
                  <dd className="mt-2 break-all font-mono text-2xl font-semibold text-foreground">{coordinates}</dd>
                </div>
              </dl>

              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(coordinates)}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-3 text-sm font-bold text-background transition hover:opacity-90"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy Coordinates
                </button>
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open in Google Maps
                </a>
              </div>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
