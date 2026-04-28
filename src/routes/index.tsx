import { createFileRoute } from "@tanstack/react-router";

import { CrashLocationDashboard } from "../components/CrashLocationDashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crash GPS Dashboard" },
      {
        name: "description",
        content: "Minimal dashboard for ESP32 GPS crash detection with a live map pin and location details.",
      },
      { property: "og:title", content: "Crash GPS Dashboard" },
      {
        property: "og:description",
        content: "Monitor validated ESP32 GPS coordinates and pinpoint crash locations on a clean dashboard.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return <CrashLocationDashboard />;
}
