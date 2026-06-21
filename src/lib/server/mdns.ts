import Bonjour from 'bonjour-service';
import { createSocket } from 'dgram';

const BEACON_PORT = 41234;
const BEACON_INTERVAL_MS = 3_000;

let instance: InstanceType<typeof Bonjour> | null = null;
let beaconTimer: ReturnType<typeof setInterval> | null = null;

export function startMdnsAdvertisement(): void {
  if (instance) return;
  const port = parseInt(process.env.PORT || '3000', 10);

  // mDNS (works on most devices, but not Fire OS)
  instance = new Bonjour();
  instance.publish({ name: 'Allowance', type: 'allowance', port });
  console.log(`[mdns] advertising _allowance._tcp on port ${port}`);

  // UDP broadcast beacon (reliable fallback for Fire tablets)
  const beacon = createSocket({ type: 'udp4', reuseAddr: true });
  const message = Buffer.from(JSON.stringify({ service: 'allowance', port }));

  beacon.bind(() => {
    beacon.setBroadcast(true);
    beaconTimer = setInterval(() => {
      beacon.send(message, 0, message.length, BEACON_PORT, '255.255.255.255');
    }, BEACON_INTERVAL_MS);
    console.log(`[beacon] broadcasting on UDP ${BEACON_PORT} every ${BEACON_INTERVAL_MS / 1000}s`);
  });

  const shutdown = () => {
    if (beaconTimer) {
      clearInterval(beaconTimer);
      beaconTimer = null;
    }
    try { beacon.close(); } catch (_) {}
    if (instance) {
      instance.unpublishAll();
      instance.destroy();
      instance = null;
      console.log('[mdns] stopped advertisement');
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
