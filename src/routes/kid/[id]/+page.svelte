<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;

  function dollars(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  let showAdjustForm = false;
</script>

<svelte:head>
  <title>{data.kid.name}</title>
</svelte:head>

<header class="flex items-center justify-between">
  <div>
    <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
    <h1 class="text-2xl font-semibold mt-1">{data.kid.name}</h1>
    <div class="text-xs text-slate-500">Age {data.kid.age}</div>
  </div>
  <div class="text-right">
    <div class="text-3xl font-semibold">{dollars(data.balanceCents)}</div>
    <div class="text-xs text-slate-500">in piggy bank</div>
  </div>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

<!-- Record cash withdrawal -->
<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Record cash withdrawal</h2>
  <p class="text-xs text-slate-500 mt-1">
    Take cash out of the piggy bank for {data.kid.name} and record what it was for.
    The description is visible to {data.kid.name}.
  </p>

  <form method="POST" action="?/debit" use:enhance class="mt-3 space-y-3">
    <label class="block">
      <span class="text-sm font-medium">Amount</span>
      <div class="mt-1 flex items-center gap-2">
        <span class="text-lg">$</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          name="amountDollars"
          required
          class="flex-1 rounded border border-slate-300 p-2 text-lg"
          placeholder="20.00"
        />
      </div>
    </label>
    <label class="block">
      <span class="text-sm font-medium">What was it for?</span>
      <input
        type="text"
        name="description"
        required
        class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm"
        placeholder="e.g. video game at GameStop"
      />
    </label>
    <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium">
      Record withdrawal
    </button>
  </form>
</section>

<!-- Adjustment -->
<section class="mt-4">
  <button
    type="button"
    on:click={() => (showAdjustForm = !showAdjustForm)}
    class="text-sm text-slate-500 underline"
  >
    {showAdjustForm ? 'Hide adjustment form' : 'Make an adjustment (rare)'}
  </button>

  {#if showAdjustForm}
    <div class="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      <p class="text-xs text-slate-500">
        Adjustments are for corrections or one-off credits/debits outside the chore loop. Positive for credit, negative for debit.
      </p>
      <form method="POST" action="?/adjust" use:enhance class="mt-3 space-y-3">
        <label class="block">
          <span class="text-sm font-medium">Amount (signed)</span>
          <div class="mt-1 flex items-center gap-2">
            <span class="text-lg">$</span>
            <input
              type="number"
              step="0.01"
              name="amountDollars"
              required
              class="flex-1 rounded border border-slate-300 p-2 text-lg"
              placeholder="e.g. -15.00 or 5.00"
            />
          </div>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Reason</span>
          <input
            type="text"
            name="description"
            required
            class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm"
          />
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="visibleToKid" checked />
          Visible to {data.kid.name}
        </label>
        <button class="w-full rounded-lg bg-slate-700 hover:bg-slate-800 text-white py-2 text-sm font-medium">
          Save adjustment
        </button>
      </form>
    </div>
  {/if}
</section>

<!-- History -->
<section class="mt-6">
  <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">History</h2>
  {#if data.ledger.length === 0}
    <p class="mt-2 text-sm text-slate-500">No entries yet.</p>
  {:else}
    <ul class="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {#each data.ledger as e (e.id)}
        <li class="p-3 flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{e.description}</div>
            <div class="text-xs text-slate-500">
              {fmtDate(e.createdAt)} · <span class="capitalize">{e.kind}</span>
              {#if !e.visibleToKid} · hidden from kid{/if}
            </div>
          </div>
          <div class="text-right font-medium {e.amountCents >= 0 ? 'text-green-700' : 'text-slate-700'}">
            {e.amountCents >= 0 ? '+' : ''}{dollars(e.amountCents)}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
