<script lang="ts">
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;

  let pushStatus = '';

  function urlBase64ToUint8Array(s: string): Uint8Array {
    const padding = '='.repeat((4 - (s.length % 4)) % 4);
    const base64 = (s + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function subscribe() {
    pushStatus = 'Working…';
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        pushStatus = 'This browser does not support push notifications.';
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        pushStatus = `Permission ${perm}.`;
        return;
      }
      const keyRes = await fetch('/api/push/vapid-key');
      if (!keyRes.ok) {
        pushStatus = `Server not configured for push (${keyRes.status}).`;
        return;
      }
      const { key } = await keyRes.json();
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
      }
      const saveRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      pushStatus = saveRes.ok ? 'Subscribed.' : `Save failed: ${await saveRes.text()}`;
    } catch (e) {
      pushStatus = `Failed: ${(e as Error).message}`;
    }
  }

  async function sendTest() {
    pushStatus = 'Sending…';
    const res = await fetch('/api/push/test', { method: 'POST' });
    pushStatus = res.ok ? 'Sent.' : `Failed: ${res.status}`;
  }
</script>

<svelte:head>
  <title>Settings</title>
</svelte:head>

<header>
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
  <h1 class="text-2xl font-semibold mt-1">Settings</h1>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{:else if form?.ok}
  <p class="mt-3 rounded bg-green-100 p-3 text-green-800 text-sm">{form.message}</p>
{/if}

<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <a href="/settings/payouts" class="flex items-center justify-between">
    <span class="font-medium">Payouts</span>
    <span class="text-slate-400 text-sm">Configure suggested amounts →</span>
  </a>
</section>

<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Notifications on this device</h2>
  <p class="text-xs text-slate-500 mt-1">
    Get pinged when a kid marks a chore done or it's Sunday review time. Requires browser permission.
  </p>
  <div class="mt-3 flex gap-2">
    <button
      type="button"
      on:click={subscribe}
      class="flex-1 rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 text-sm font-medium"
    >
      Enable notifications
    </button>
    <button
      type="button"
      on:click={sendTest}
      class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-2 px-3 text-sm font-medium"
    >
      Send test
    </button>
  </div>
  {#if pushStatus}
    <p class="mt-2 text-xs text-slate-600">{pushStatus}</p>
  {/if}
</section>

<section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Parent PIN</h2>
  <p class="text-xs text-slate-500 mt-1">
    {data.hasPin
      ? 'A PIN is set. You re-enter it every 5 minutes of inactivity for parent actions on this device.'
      : 'No PIN is set. Optional — without one, anyone using a claimed parent device can approve chores and record debits.'}
  </p>

  <form method="POST" action="?/setPin" class="mt-4 space-y-3">
    <label class="block">
      <span class="text-sm font-medium">{data.hasPin ? 'New PIN' : 'PIN'}</span>
      <input
        type="password"
        name="pin"
        required
        minlength="4"
        inputmode="numeric"
        autocomplete="new-password"
        class="mt-1 block w-full rounded border-slate-300 border p-2 text-lg tracking-widest text-center"
      />
    </label>
    <label class="block">
      <span class="text-sm font-medium">Confirm</span>
      <input
        type="password"
        name="pin2"
        required
        minlength="4"
        inputmode="numeric"
        autocomplete="new-password"
        class="mt-1 block w-full rounded border-slate-300 border p-2 text-lg tracking-widest text-center"
      />
    </label>
    <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 font-medium">
      {data.hasPin ? 'Change PIN' : 'Set PIN'}
    </button>
  </form>
</section>

{#if data.hasPin}
  <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
    <h3 class="font-medium text-sm">Clear PIN</h3>
    <p class="text-xs text-slate-500 mt-1">Removes the PIN entirely. Re-enter your current PIN to confirm.</p>
    <form method="POST" action="?/clearPin" class="mt-3 space-y-3">
      <input
        type="password"
        name="currentPin"
        placeholder="Current PIN"
        required
        inputmode="numeric"
        class="block w-full rounded border-slate-300 border p-2 text-sm text-center tracking-widest"
      />
      <button class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-2 text-sm font-medium">
        Clear PIN
      </button>
    </form>
  </section>
{/if}
