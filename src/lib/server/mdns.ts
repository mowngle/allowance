import Bonjour from 'bonjour-service';

let instance: InstanceType<typeof Bonjour> | null = null;

export function startMdnsAdvertisement(): void {
  const port = parseInt(process.env.PORT || '3000', 10);
  instance = new Bonjour();
  instance.publish({ name: 'Allowance', type: 'allowance', port });
  console.log(`[mdns] advertising _allowance._tcp on port ${port}`);

  const shutdown = () => {
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
