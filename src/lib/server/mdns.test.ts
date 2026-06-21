import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('bonjour-service', () => {
  const publishFn = vi.fn();
  const unpublishAllFn = vi.fn();
  const destroyFn = vi.fn();
  return {
    default: class Bonjour {
      publish = publishFn;
      unpublishAll = unpublishAllFn;
      destroy = destroyFn;
      static _mocks = { publishFn, unpublishAllFn, destroyFn };
    },
  };
});

import Bonjour from 'bonjour-service';

describe('mDNS advertisement', () => {
  const mocks = (Bonjour as any)._mocks;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PORT;
  });

  it('publishes _allowance._tcp on PORT from env', async () => {
    process.env.PORT = '4000';
    const { startMdnsAdvertisement } = await import('./mdns');
    startMdnsAdvertisement();

    expect(mocks.publishFn).toHaveBeenCalledOnce();
    const call = mocks.publishFn.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({ name: 'Allowance', type: 'allowance', port: 4000 })
    );
  });

  it('defaults to port 3000 when PORT is unset', async () => {
    const { startMdnsAdvertisement } = await import('./mdns');
    startMdnsAdvertisement();

    const call = mocks.publishFn.mock.calls[0][0];
    expect(call.port).toBe(3000);
  });
});
