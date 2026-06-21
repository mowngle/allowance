<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Payouts</title></svelte:head>

<header>
  <a href="/settings" class="text-sm text-slate-500 hover:text-slate-800">← Settings</a>
  <h1 class="text-2xl font-semibold mt-1">Payouts</h1>
  <p class="text-xs text-slate-500 mt-1">
    Sets the <em>suggested</em> weekly amount. You still choose the actual amount at review.
  </p>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{:else if form?.ok}
  <p class="mt-3 rounded bg-green-100 p-3 text-green-800 text-sm">{form.message}</p>
{/if}

<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Family default</h2>
  <form method="POST" action="?/saveFamily" use:enhance class="mt-3 space-y-3">
    <label class="flex items-center gap-2 text-sm">
      <input type="radio" name="mode" value="age" checked={data.family.mode === 'age'} /> Age-based
    </label>
    <div class="grid grid-cols-2 gap-2 pl-6">
      <label class="text-xs">$/year of age
        <input name="rate" value={data.family.rate} inputmode="decimal"
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
      <label class="text-xs">Bonus $
        <input name="bonus" value={data.family.bonus} inputmode="decimal"
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
    </div>
    <label class="flex items-center gap-2 text-sm">
      <input type="radio" name="mode" value="fixed" checked={data.family.mode === 'fixed'} /> Fixed amount
    </label>
    <div class="pl-6">
      <label class="text-xs">Amount $
        <input name="fixed" value={data.family.fixed} inputmode="decimal"
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
    </div>
    <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 text-sm font-medium">
      Save family default
    </button>
  </form>
</section>

{#each data.kids as kid (kid.id)}
  <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
    <div class="flex items-center justify-between">
      <h3 class="font-medium text-sm">{kid.name}</h3>
      <span class="text-xs text-slate-500">{kid.hasOverride ? 'Custom' : 'Using family default'}</span>
    </div>
    <form method="POST" action="?/saveKid" use:enhance class="mt-3 space-y-2">
      <input type="hidden" name="kidId" value={kid.id} />
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="mode" value="age" checked={kid.mode === 'age'} /> Age-based
      </label>
      <div class="grid grid-cols-2 gap-2 pl-6">
        <label class="text-xs">$/year
          <input name="rate" value={kid.rate} inputmode="decimal"
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
        <label class="text-xs">Bonus $
          <input name="bonus" value={kid.bonus} inputmode="decimal"
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="mode" value="fixed" checked={kid.mode === 'fixed'} /> Fixed
      </label>
      <div class="pl-6">
        <label class="text-xs">Amount $
          <input name="fixed" value={kid.fixed} inputmode="decimal"
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm" /></label>
      </div>
      <div class="flex gap-2">
        <button class="flex-1 rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 text-sm font-medium">
          Save override
        </button>
      </div>
    </form>
    {#if kid.hasOverride}
      <form method="POST" action="?/clearKid" use:enhance class="mt-2">
        <input type="hidden" name="kidId" value={kid.id} />
        <button class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-2 text-sm font-medium">
          Use family default
        </button>
      </form>
    {/if}
  </section>
{/each}
