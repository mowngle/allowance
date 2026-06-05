<script lang="ts">
  import type { ActionData } from './$types';
  export let form: ActionData;
</script>

<svelte:head><title>Set up · First parent</title></svelte:head>

<header>
  <h1 class="text-2xl font-semibold">First parent</h1>
  <p class="mt-1 text-sm text-slate-600">
    Who's setting this up? You can add a second parent later.
  </p>
  <ol class="mt-3 flex gap-2 text-xs text-slate-500">
    <li class="text-green-700">✓ Family</li>
    <li>›</li>
    <li class="font-medium text-brand-700">2. Parent</li>
    <li>›</li>
    <li>3. Kids</li>
    <li>›</li>
    <li>4. Done</li>
  </ol>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

<form method="POST" class="mt-6 space-y-4">
  <label class="block">
    <span class="text-sm font-medium">Your name</span>
    <input
      type="text"
      name="name"
      required
      autofocus
      class="mt-1 block w-full rounded border-slate-300 border p-2"
      placeholder="e.g. Pat"
    />
  </label>

  <fieldset class="rounded-xl bg-slate-100 p-4 space-y-3">
    <legend class="text-sm font-medium">Optional: parent PIN</legend>
    <p class="text-xs text-slate-600 -mt-2">
      If set, you'll re-enter it every 5 minutes of inactivity for parent actions.
      Prevents kids from approving their own chores. Leave blank to skip.
    </p>
    <label class="block">
      <span class="text-sm font-medium">PIN (4+ digits)</span>
      <input
        type="password"
        name="pin"
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
        minlength="4"
        inputmode="numeric"
        autocomplete="new-password"
        class="mt-1 block w-full rounded border-slate-300 border p-2 text-lg tracking-widest text-center"
      />
    </label>
  </fieldset>

  <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium">
    Continue →
  </button>
</form>
