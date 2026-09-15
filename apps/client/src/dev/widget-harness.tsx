/**
 * Dev-only page mounting the embedded widget entry against the local dev
 * socket URL; used by the Playwright visual suite to baseline the widget's
 * connection-free stage (the prejoin card).
 */

import { ZvonokEmbeddedRoom } from "@zvonok/react/embedded";

export function WidgetHarness() {
  return (
    <div style={{ height: "100dvh" }}>
      <ZvonokEmbeddedRoom
        serverUrl={import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3000"}
        roomSlug="visual-room"
        token="visual-token"
      />
    </div>
  );
}
