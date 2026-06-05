<script lang="ts">
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head>
  <title>Enter PIN</title>
</svelte:head>

<header>
  <h1 class="text-2xl font-semibold">Enter PIN</h1>
  <p class="mt-1 text-sm text-slate-600">
    Required for parent actions on this device.
  </p>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

<form method="POST" class="mt-6 space-y-4">
  <input type="hidden" name="return" value={data.returnPath} />
  <label class="block">
    <span class="text-sm font-medium">PIN</span>
    <input
      type="password"
      name="pin"
      autocomplete="current-password"
      inputmode="numeric"
      autofocus
      required
      minlength="4"
      class="mt-1 block w-full rounded border-slate-300 border p-3 text-lg tracking-widest text-center"
    />
  </label>
  <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium">
    Unlock
  </button>
</form>
