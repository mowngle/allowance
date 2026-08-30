<script lang="ts">
  import { enhance } from '$app/forms';
  import ReviewCard from '$lib/components/ReviewCard.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  let expandedOlder = false;

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  $: olderWeekCount = new Set(data.queue.older.map((i) => i.weekStarting)).size;
  $: olderTotalCents = data.queue.older.reduce((s, i) => s + i.suggestedAmountCents, 0);
  $: behindWeeks = new Set(
    [...data.queue.recent, ...data.queue.older].map((i) => i.weekStarting)
  ).size;
  $: nothingToDo =
    data.queue.current.length === 0 &&
    data.queue.recent.length === 0 &&
    data.queue.older.length === 0;
</script>

<svelte:head>
  <title>Weekly review</title>
</svelte:head>

<header class="flex items-center justify-between">
  <h1 class="text-2xl font-semibold">Weekly review</h1>
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800 underline">← Home</a>
</header>

{#if behindWeeks > 0}
  <div class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
    <div class="font-medium">
      {behindWeeks} earlier week{behindWeeks === 1 ? '' : 's'} still needs a decision.
    </div>
    <p class="mt-1 text-amber-800">
      Nothing was paid for {behindWeeks === 1 ? 'it' : 'them'} yet. Approving pays it now — it
      lands in the kid's history labelled with the week it covers — or skip to close it out.
    </p>
  </div>
{/if}

{#if nothingToDo}
  <p class="mt-6 text-slate-500">Nothing to review — you're all caught up.</p>
{/if}

{#if data.queue.current.length > 0}
  <section class="mt-6">
    <h2 class="text-xs font-medium uppercase tracking-wide text-slate-500">This week</h2>
    <div class="mt-2 space-y-4">
      {#each data.queue.current as item (item.cycleId)}
        <ReviewCard {item} />
      {/each}
    </div>
  </section>
{/if}

{#if data.queue.recent.length > 0}
  <section class="mt-8">
    <h2 class="text-xs font-medium uppercase tracking-wide text-amber-700">Waiting on you</h2>
    <div class="mt-2 space-y-4">
      {#each data.queue.recent as item (item.cycleId)}
        <ReviewCard {item} />
      {/each}
    </div>
  </section>
{/if}

{#if data.queue.older.length > 0}
  <section class="mt-8">
    <h2 class="text-xs font-medium uppercase tracking-wide text-slate-500">Earlier</h2>

    <div class="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">
            {olderWeekCount} earlier week{olderWeekCount === 1 ? '' : 's'} · {dollars(
              olderTotalCents
            )}
          </div>
          <div class="text-xs text-slate-500">
            Back to {shortDate(data.queue.older[data.queue.older.length - 1].weekStarting)}
          </div>
        </div>
        <button
          type="button"
          on:click={() => (expandedOlder = !expandedOlder)}
          class="text-sm text-slate-500 hover:text-slate-800 underline"
        >
          {expandedOlder ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {#if !expandedOlder}
        <div class="mt-4 grid grid-cols-2 gap-2">
          <form method="POST" action="?/approveAll" use:enhance>
            {#each data.queue.older as item (item.cycleId)}
              <input type="hidden" name="cycleId" value={item.cycleId} />
            {/each}
            <button
              class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium"
            >
              Approve all {dollars(olderTotalCents)}
            </button>
          </form>
          <form method="POST" action="?/skipAll" use:enhance>
            {#each data.queue.older as item (item.cycleId)}
              <input type="hidden" name="cycleId" value={item.cycleId} />
            {/each}
            <button
              class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium"
            >
              Skip all
            </button>
          </form>
        </div>
      {/if}
    </div>

    {#if expandedOlder}
      <div class="mt-4 space-y-4">
        {#each data.queue.older as item (item.cycleId)}
          <ReviewCard {item} />
        {/each}
      </div>
    {/if}
  </section>
{/if}
