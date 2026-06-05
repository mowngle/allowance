<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  export let data: PageData;

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  // Per-cycle: are we showing the "adjust amount" inline editor?
  let adjustingId: string | null = null;
  // Per-cycle: the current adjusted amount in dollars (string for input binding).
  const adjustValues: Record<string, string> = {};
  function startAdjust(cycleId: string, suggestedCents: number) {
    adjustingId = cycleId;
    if (!(cycleId in adjustValues)) {
      adjustValues[cycleId] = (suggestedCents / 100).toFixed(2);
    }
  }
  function cancelAdjust() {
    adjustingId = null;
  }
  function dollarsToCents(s: string): number {
    const n = parseFloat(s);
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100);
  }
</script>

<svelte:head>
  <title>Weekly review</title>
</svelte:head>

<header class="flex items-center justify-between">
  <h1 class="text-2xl font-semibold">Weekly review</h1>
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800 underline">← Home</a>
</header>

{#if data.items.length === 0}
  <p class="mt-6 text-slate-500">No kids set up yet.</p>
{/if}

<div class="mt-6 space-y-4">
  {#each data.items as item (item.cycleId)}
    <article class="rounded-xl border border-slate-200 bg-white p-4">
      <header class="flex items-center justify-between">
        <div>
          <div class="font-medium text-lg">{item.kidName}</div>
          <div class="text-xs text-slate-500">
            Age {item.age} · Week of {item.weekStarting}
          </div>
        </div>
        {#if item.status === 'paid'}
          <span class="rounded-full bg-green-100 text-green-800 text-xs font-medium px-3 py-1">
            Paid {dollars(item.actualAmountCents ?? 0)}
          </span>
        {:else if item.status === 'skipped'}
          <span class="rounded-full bg-slate-200 text-slate-700 text-xs font-medium px-3 py-1">
            Skipped
          </span>
        {/if}
      </header>

      <!-- Progress summary -->
      <div class="mt-3 text-sm">
        <span class="font-medium">{item.confirmedCount} of {item.totalCount}</span>
        <span class="text-slate-500"> chores this week</span>
        {#if item.missedChoreNames.length > 0 && item.status === 'open'}
          <div class="mt-1 text-xs text-amber-700">
            Missed: {item.missedChoreNames.join(', ')}
          </div>
        {/if}
      </div>

      {#if item.status === 'open'}
        {#if adjustingId === item.cycleId}
          <!-- Adjust mode -->
          <form method="POST" action="?/approve" use:enhance class="mt-4 space-y-2">
            <input type="hidden" name="cycleId" value={item.cycleId} />
            <input
              type="hidden"
              name="amountCents"
              value={dollarsToCents(adjustValues[item.cycleId] ?? '0')}
            />
            <label class="block">
              <span class="text-sm font-medium">Amount</span>
              <div class="mt-1 flex items-center gap-2">
                <span class="text-lg">$</span>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  bind:value={adjustValues[item.cycleId]}
                  class="flex-1 rounded border border-slate-300 p-2 text-lg"
                />
              </div>
            </label>
            <label class="block">
              <span class="text-sm font-medium">Note (optional)</span>
              <input
                type="text"
                name="note"
                class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm"
                placeholder="e.g. great week"
              />
            </label>
            <div class="flex gap-2">
              <button
                type="submit"
                class="flex-1 rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 font-medium"
              >
                Approve {dollars(dollarsToCents(adjustValues[item.cycleId] ?? '0'))}
              </button>
              <button
                type="button"
                on:click={cancelAdjust}
                class="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        {:else}
          <!-- Default approve/adjust/skip -->
          <div class="mt-4 grid grid-cols-3 gap-2">
            <form method="POST" action="?/approve" use:enhance>
              <input type="hidden" name="cycleId" value={item.cycleId} />
              <input type="hidden" name="amountCents" value={item.suggestedAmountCents} />
              <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium">
                Approve {dollars(item.suggestedAmountCents)}
              </button>
            </form>
            <button
              type="button"
              on:click={() => startAdjust(item.cycleId, item.suggestedAmountCents)}
              class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium"
            >
              Adjust
            </button>
            <form method="POST" action="?/skip" use:enhance>
              <input type="hidden" name="cycleId" value={item.cycleId} />
              <button class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium">
                Skip
              </button>
            </form>
          </div>
        {/if}
      {/if}
    </article>
  {/each}
</div>
