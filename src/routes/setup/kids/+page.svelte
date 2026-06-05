<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Set up · Kids</title></svelte:head>

<header>
  <h1 class="text-2xl font-semibold">Add your kids</h1>
  <p class="mt-1 text-sm text-slate-600">
    Add each kid with their birthdate. Age determines their suggested allowance.
  </p>
  <ol class="mt-3 flex gap-2 text-xs text-slate-500">
    <li class="text-green-700">✓ Family</li>
    <li>›</li>
    <li class="text-green-700">✓ Parent</li>
    <li>›</li>
    <li class="font-medium text-brand-700">3. Kids</li>
    <li>›</li>
    <li>4. Done</li>
  </ol>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

{#if data.kids.length > 0}
  <section class="mt-6">
    <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Added</h2>
    <ul class="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {#each data.kids as k (k.id)}
        <li class="p-3">
          <div class="font-medium">{k.name}</div>
          <div class="text-xs text-slate-500">{k.birthdate}</div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<form method="POST" action="?/add" use:enhance class="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Add a kid</h2>
  <label class="block">
    <span class="text-sm font-medium">Name</span>
    <input
      type="text"
      name="name"
      required
      class="mt-1 block w-full rounded border-slate-300 border p-2"
    />
  </label>
  <label class="block">
    <span class="text-sm font-medium">Birthdate</span>
    <input
      type="date"
      name="birthdate"
      required
      class="mt-1 block w-full rounded border-slate-300 border p-2"
    />
  </label>
  <button class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-2 text-sm font-medium">
    Add kid
  </button>
</form>

<form action="/setup/done" class="mt-4">
  <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium">
    {data.kids.length === 0 ? 'Skip for now and finish' : 'Done — finish setup'} →
  </button>
</form>
