// src/App.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import L from "leaflet";
// ============================================================
// HELPER: Generate unique IDs
// ============================================================
let _toastId = 0;
const nextToastId = () => ++_toastId;

let _historyId = 0;
const nextHistoryId = () => ++_historyId;

// ============================================================
// HELPER: Format timestamp
// ============================================================
const formatTime = (date) => {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

const formatDateTime = (date) => {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

// ============================================================
// COMPONENT: Toast Notification
// ============================================================
function Toast({ toast, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), 30);
    const autoDismiss = setTimeout(() => handleDismiss(), toast.duration || 8000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(autoDismiss);
    };
  }, []);

  const handleDismiss = () => {
    setHiding(true);
    setTimeout(() => onDismiss(toast.id), 400);
  };

  const cls = `toast ${toast.type === "success" ? "success" : ""} ${visible && !hiding ? "show" : ""} ${hiding ? "hiding" : ""}`;

  return (
    <div className={cls}>
      <div className={`toast-icon ${toast.type === "success" ? "success" : "crash"}`}>
        <i className={`fa-solid ${toast.type === "success" ? "fa-check" : "fa-triangle-exclamation"}`}></i>
      </div>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-message" dangerouslySetInnerHTML={{ __html: toast.message }}></div>
      </div>
      <button className="toast-close" onClick={handleDismiss}>
        <i className="fa-solid fa-xmark"></i>
      </button>
      <div className="toast-progress"></div>
    </div>
  );
}

// ============================================================
// COMPONENT: Toast Container
// ============================================================
function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ============================================================
// MAIN APP COMPONENT
// ============================================================
export default function App() {
  // --- Theme ---
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  // --- Connection ---
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  // --- Active Incidents (keyed by deviceId) ---
  const [incidents, setIncidents] = useState({});

  // --- Selected Incident ---
  const [selectedIncidentId, setSelectedIncidentId] = useState(null);

  // --- Crash History ---
  const [crashHistory, setCrashHistory] = useState([]);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);

  // --- Toasts ---
  const [toasts, setToasts] = useState([]);

  // --- Search ---
  const [searchQuery, setSearchQuery] = useState("");

  // --- Map ---
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const historyMarkersRef = useRef({});

  // --- Copy ---
  const [copied, setCopied] = useState(false);

  // --- Current coords display ---
  const [displayCoords, setDisplayCoords] = useState({ lat: null, lng: null });

  // =======================
  // TOAST HELPERS
  // =======================
  const addToast = useCallback((toast) => {
    const id = nextToastId();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // =======================
  // INIT MAP
  // =======================
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [14.5995, 120.9842],
      zoom: 13,
      zoomControl: false,
    });

    L.control.zoom({ position: "topright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // =======================
  // WEBSOCKET / MQTT CONNECTION
  // =======================
  useEffect(() => {
    const connectWs = () => {
      // Try connecting to typical ESP32 MQTT-over-WS or direct WS
      const wsUrl =
        import.meta.env.VITE_WS_URL || "ws://localhost:9001/mqtt";

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("[GPS Crash Dashboard] WebSocket connected");
          setConnected(true);

          // If MQTT, send a subscribe packet or rely on broker auto-forwarding
          // For raw WS from ESP32, just listen
        };

        ws.onmessage = (event) => {
          handleIncomingData(event.data);
        };

        ws.onerror = (err) => {
          console.warn("[GPS Crash Dashboard] WS error:", err);
        };

        ws.onclose = () => {
          console.log("[GPS Crash Dashboard] WebSocket closed, reconnecting...");
          setConnected(false);
          setTimeout(connectWs, 3000);
        };
      } catch (err) {
        console.error("[GPS Crash Dashboard] WS connection failed:", err);
        setConnected(false);
        setTimeout(connectWs, 5000);
      }
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // =======================
  // HANDLE INCOMING DATA — ANY packet = CRASH
  // =======================
  const handleIncomingData = useCallback(
    (raw) => {
      let data;
      try {
        data = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        // Even if unparseable, treat it as a crash from unknown device
        data = {};
      }

      const deviceId = data.deviceId || data.device_id || data.id || "ESP32-UNKNOWN";
      const lat = parseFloat(data.lat || data.latitude) || 14.5995;
      const lng = parseFloat(data.lng || data.longitude || data.lon) || 120.9842;
      const timestamp = new Date().toISOString();

      // === ANY data = CRASH_CONFIRMED ===
      const incident = {
        deviceId,
        lat,
        lng,
        timestamp,
        status: "CRASH_DETECTED",
        raw: data,
      };

      // Update incidents
      setIncidents((prev) => ({
        ...prev,
        [deviceId]: incident,
      }));

      // Add to crash history
      const historyEntry = {
        id: nextHistoryId(),
        deviceId,
        lat,
        lng,
        timestamp,
        status: "CRASH_CONFIRMED",
      };

      setCrashHistory((prev) => [historyEntry, ...prev]);

      // Update coords
      setDisplayCoords({ lat, lng });

      // Auto-select
      setSelectedIncidentId(deviceId);

      // Show toast notification
      addToast({
        type: "crash",
        title: "Crash Detected",
        message: `Device <span>${deviceId}</span> — ${formatTime(timestamp)}`,
        duration: 8000,
      });

      // Update map
      updateLiveMarker(deviceId, lat, lng);

      // Pan map to crash
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo([lat, lng], 16, { duration: 1.2 });
      }
    },
    [addToast]
  );

  // =======================
  // MAP MARKER HELPERS
  // =======================
  const createIcon = (type) => {
    const classMap = {
      live: "marker-live",
      history: "marker-history",
      resolved: "marker-resolved",
    };
    return L.divIcon({
      className: "custom-marker",
      html: `<div class="${classMap[type]}"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  };

  const updateLiveMarker = (deviceId, lat, lng) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (markersRef.current[deviceId]) {
      markersRef.current[deviceId].setLatLng([lat, lng]);
    } else {
      const marker = L.marker([lat, lng], { icon: createIcon("live") })
        .addTo(map)
        .bindPopup(
          `<strong>🚨 Live Crash</strong><br/>Device: ${deviceId}<br/>Lat: ${lat.toFixed(6)}<br/>Lng: ${lng.toFixed(6)}`
        );
      markersRef.current[deviceId] = marker;
    }
  };

  const removeLiveMarker = (deviceId) => {
    const map = mapInstanceRef.current;
    if (!map || !markersRef.current[deviceId]) return;
    map.removeLayer(markersRef.current[deviceId]);
    delete markersRef.current[deviceId];
  };

  const showHistoryMarker = (historyId, lat, lng, deviceId, status) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove previous history highlight marker
    Object.keys(historyMarkersRef.current).forEach((key) => {
      map.removeLayer(historyMarkersRef.current[key]);
    });
    historyMarkersRef.current = {};

    const type = status === "RESOLVED" ? "resolved" : "history";
    const marker = L.marker([lat, lng], { icon: createIcon(type) })
      .addTo(map)
      .bindPopup(
        `<strong>${status === "RESOLVED" ? "✅ Resolved" : "⚠️ Crash"}</strong><br/>Device: ${deviceId}<br/>Lat: ${lat.toFixed(6)}<br/>Lng: ${lng.toFixed(6)}`
      )
      .openPopup();

    historyMarkersRef.current[historyId] = marker;

    map.flyTo([lat, lng], 17, { duration: 1 });
  };

  // =======================
  // RESOLVE INCIDENT
  // =======================
  const resolveIncident = (deviceId) => {
    const incident = incidents[deviceId];
    if (!incident) return;

    // Remove from active incidents
    setIncidents((prev) => {
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });

    // Add resolved entry to history
    const resolvedEntry = {
      id: nextHistoryId(),
      deviceId: incident.deviceId,
      lat: incident.lat,
      lng: incident.lng,
      timestamp: new Date().toISOString(),
      status: "RESOLVED",
    };
    setCrashHistory((prev) => [resolvedEntry, ...prev]);

    // Clear selection if this was selected
    if (selectedIncidentId === deviceId) {
      setSelectedIncidentId(null);
    }

    // Remove live marker
    removeLiveMarker(deviceId);

    // Show success toast
    addToast({
      type: "success",
      title: "Incident Resolved",
      message: `Device <span>${deviceId}</span> marked as resolved`,
      duration: 4000,
    });
  };

  // =======================
  // COPY COORDINATES
  // =======================
  const copyCoordinates = () => {
    if (displayCoords.lat === null) return;
    const text = `${displayCoords.lat.toFixed(6)}, ${displayCoords.lng.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // =======================
  // FILTERED INCIDENTS
  // =======================
  const filteredIncidents = Object.values(incidents).filter((inc) =>
    inc.deviceId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedIncident = selectedIncidentId ? incidents[selectedIncidentId] : null;

  // =======================
  // VIEW ON MAP (history)
  // =======================
  const viewOnMap = (entry) => {
    setSelectedHistoryId(entry.id);
    showHistoryMarker(entry.id, entry.lat, entry.lng, entry.deviceId, entry.status);
    setDisplayCoords({ lat: entry.lat, lng: entry.lng });
  };

  // Determine overall status for the status bar
  const hasActiveIncidents = Object.keys(incidents).length > 0;

  // =======================
  // SIMULATE (for testing — remove in production)
  // =======================
  const simulateCrash = () => {
    const fakeData = JSON.stringify({
      deviceId: `ESP32-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      lat: 14.5995 + (Math.random() - 0.5) * 0.02,
      lng: 120.9842 + (Math.random() - 0.5) * 0.02,
      accel_x: Math.random() * 20,
      accel_y: Math.random() * 20,
      accel_z: Math.random() * 20,
    });
    handleIncomingData(fakeData);
  };

  // =======================
  // RENDER
  // =======================
  return (
    <div className="dashboard-root">
      {/* ===== TOAST NOTIFICATIONS ===== */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ===== TOP NAV ===== */}
      <nav className="top-nav">
        <div className="top-nav-brand">
          <div className="brand-icon">
            <i className="fa-solid fa-satellite-dish"></i>
          </div>
          <div>
            <div className="brand-title">GPS Crash Dashboard</div>
            <div className="brand-subtitle">Real-Time Fleet Monitoring</div>
          </div>
        </div>

        <div className="top-nav-actions">
          <div className={`connection-indicator ${connected ? "connected" : "disconnected"}`}>
            <span className="connection-dot"></span>
            {connected ? "Connected" : "Disconnected"}
          </div>

          <button className="nav-btn" onClick={simulateCrash} title="Simulate Crash (Testing)">
            <i className="fa-solid fa-bolt"></i>
          </button>

          <button className="nav-btn" onClick={toggleTheme} title="Toggle Theme">
            <i className={`fa-solid ${theme === "dark" ? "fa-sun" : "fa-moon"}`}></i>
          </button>
        </div>
      </nav>

      {/* ===== MAIN LAYOUT ===== */}
      <div className="main-content">
        {/* ===== LEFT SIDEBAR ===== */}
        <aside className="left-sidebar">
          {/* Search */}
          <div className="search-bar">
            <i className="fa-solid fa-magnifying-glass"></i>
            <input
              type="text"
              placeholder="Search incidents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Active Incidents */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              <i className="fa-solid fa-triangle-exclamation" style={{ color: "var(--accent-red)" }}></i>
              Active Incidents
              {filteredIncidents.length > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    background: "var(--accent-red-dim)",
                    color: "var(--accent-red)",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    fontSize: "10px",
                    fontWeight: 700,
                  }}
                >
                  {filteredIncidents.length}
                </span>
              )}
            </div>
          </div>

          <div className="incidents-list">
            {filteredIncidents.length === 0 ? (
              <div className="no-incidents">
                <div className="no-incidents-icon">
                  <i className="fa-solid fa-shield-halved"></i>
                </div>
                <h4>All Clear</h4>
                <p>No active incidents detected</p>
              </div>
            ) : (
              filteredIncidents.map((inc) => (
                <div
                  key={inc.deviceId}
                  className={`incident-card ${selectedIncidentId === inc.deviceId ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedIncidentId(inc.deviceId);
                    setDisplayCoords({ lat: inc.lat, lng: inc.lng });
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo([inc.lat, inc.lng], 16, { duration: 1 });
                    }
                  }}
                >
                  <div className="incident-card-header">
                    <span className="incident-device-id">{inc.deviceId}</span>
                    <span className="incident-badge crash">Crash</span>
                  </div>
                  <div className="incident-card-details">
                    <div className="incident-detail">
                      <i className="fa-solid fa-clock"></i>
                      {formatTime(inc.timestamp)}
                    </div>
                    <div className="incident-detail">
                      <i className="fa-solid fa-location-dot"></i>
                      {inc.lat.toFixed(4)}, {inc.lng.toFixed(4)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ===== CENTER: MAP ===== */}
        <main className="center-panel">
          {/* Status Bar */}
          <div className="map-status-bar">
            <div className="map-status-left">
              {hasActiveIncidents ? (
                <div className="status-chip crash">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  Crash Detected — {Object.keys(incidents).length} Active
                </div>
              ) : (
                <div className="status-chip idle">
                  <i className="fa-solid fa-circle-check"></i>
                  System Normal
                </div>
              )}
            </div>
            <div className="map-status-right">
              {displayCoords.lat !== null && (
                <>
                  <span className="coord-display">
                    {displayCoords.lat.toFixed(6)}, {displayCoords.lng.toFixed(6)}
                  </span>
                  <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={copyCoordinates}>
                    <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`}></i>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Map */}
          <div className="map-container">
            <div id="map" ref={mapRef}></div>

            {/* Map Legend */}
            <div className="map-legend">
              <div className="map-legend-title">Legend</div>
              <div className="map-legend-item">
                <span className="legend-dot live"></span>
                Live Crash
              </div>
              <div className="map-legend-item">
                <span className="legend-dot history"></span>
                Historical Crash
              </div>
              <div className="map-legend-item">
                <span className="legend-dot resolved"></span>
                Resolved
              </div>
            </div>
          </div>
        </main>

        {/* ===== RIGHT PANEL ===== */}
        <aside className="right-panel">
          <div className="right-panel-header">
            <h3>
              <i className="fa-solid fa-shield-halved"></i>
              Incident Command
            </h3>
          </div>

          {selectedIncident ? (
            <div className="right-panel-body">
              {/* Device Info */}
              <div className="info-card">
                <div className="info-card-title">
                  <i className="fa-solid fa-microchip"></i>
                  Device Information
                </div>
                <div className="info-row">
                  <span className="info-label">Device ID</span>
                  <span className="info-value">{selectedIncident.deviceId}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Status</span>
                  <span className="info-value" style={{ color: "var(--accent-red)" }}>
                    CRASH DETECTED
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Detected At</span>
                  <span className="info-value">{formatDateTime(selectedIncident.timestamp)}</span>
                </div>
              </div>

              {/* Location Info */}
              <div className="info-card">
                <div className="info-card-title">
                  <i className="fa-solid fa-location-crosshairs"></i>
                  Location Data
                </div>
                <div className="info-row">
                  <span className="info-label">Latitude</span>
                  <span className="info-value">{selectedIncident.lat.toFixed(6)}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Longitude</span>
                  <span className="info-value">{selectedIncident.lng.toFixed(6)}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Accuracy</span>
                  <span className="info-value">GPS Lock</span>
                </div>
              </div>

              {/* Actions */}
              <div className="actions-group">
                <button
                  className="action-btn primary"
                  onClick={() => {
                    window.open(
                      `https://www.google.com/maps?q=${selectedIncident.lat},${selectedIncident.lng}`,
                      "_blank"
                    );
                  }}
                >
                  <i className="fa-solid fa-up-right-from-square"></i>
                  Open in Google Maps
                </button>

                <button
                  className="action-btn resolve"
                  onClick={() => resolveIncident(selectedIncident.deviceId)}
                >
                  <i className="fa-solid fa-circle-check"></i>
                  Resolve Incident
                </button>
              </div>
            </div>
          ) : (
            <div className="no-incident-selected">
              <div className="no-incident-icon">
                <i className="fa-solid fa-hand-pointer"></i>
              </div>
              <h4>No Incident Selected</h4>
              <p>Select an active incident from the left panel to view details and take action.</p>
            </div>
          )}

          {/* ===== CRASH HISTORY ===== */}
          <div className="crash-history-section">
            <div className="crash-history-header" onClick={() => setHistoryExpanded(!historyExpanded)}>
              <div className="crash-history-header-left">
                <i className="fa-solid fa-clock-rotate-left"></i>
                Crash History
                {crashHistory.length > 0 && <span className="history-count">{crashHistory.length}</span>}
              </div>
              <i className={`fa-solid fa-chevron-down crash-history-toggle ${historyExpanded ? "expanded" : ""}`}></i>
            </div>

            <div className={`crash-history-list ${historyExpanded ? "expanded" : ""}`}>
              {crashHistory.length === 0 ? (
                <div className="empty-history">No crash events recorded yet</div>
              ) : (
                crashHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={`history-card ${selectedHistoryId === entry.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedHistoryId(entry.id);
                      setDisplayCoords({ lat: entry.lat, lng: entry.lng });
                    }}
                  >
                    <div className={`history-card-icon ${entry.status === "RESOLVED" ? "resolved" : "crash"}`}>
                      <i
                        className={`fa-solid ${
                          entry.status === "RESOLVED" ? "fa-circle-check" : "fa-car-burst"
                        }`}
                      ></i>
                    </div>
                    <div className="history-card-info">
                      <div className="history-card-device">{entry.deviceId}</div>
                      <div className="history-card-time">{formatDateTime(entry.timestamp)}</div>
                    </div>
                    <div className="history-card-actions">
                      <span
                        className={`history-badge ${
                          entry.status === "RESOLVED" ? "resolved" : "crash-confirmed"
                        }`}
                      >
                        {entry.status === "RESOLVED" ? "Resolved" : "Crash"}
                      </span>
                      <button
                        className="history-map-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          viewOnMap(entry);
                        }}
                      >
                        <i className="fa-solid fa-map-pin"></i>
                        Map
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
