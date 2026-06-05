<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;

  function dollars(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
</script>

<svelte:head>
  <title>My history</title>
</svelte:head>

<header>
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
  <h1 class="text-2xl font-semibold mt-1">My piggy bank</h1>
</header>

<div class="mt-4 rounded-2xl bg-brand-700 text-white p-5 text-center">
  <div class="text-4xl font-bold">{dollars(data.balanceCents)}</div>
  <div class="mt-1 text-sm opacity-90">saved up</div>
</div>

<section class="mt-6">
  <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Where it came from / went</h2>
  {#if data.ledger.length === 0}
    <p class="mt-2 text-sm text-slate-500">Nothing yet.</p>
  {:else}
    <ul class="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {#each data.ledger as e (e.id)}
        <li class="p-3 flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{e.description}</div>
            <div class="text-xs text-slate-500">{fmtDate(e.createdAt)}</div>
          </div>
          <div class="text-right font-medium {e.amountCents >= 0 ? 'text-green-700' : 'text-slate-700'}">
            {e.amountCents >= 0 ? '+' : ''}{dollars(e.amountCents)}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
