<script lang="ts">
  import { enhance } from '$app/forms';
  import type { WeeklyReviewItem } from '$lib/review-types';

  export let item: WeeklyReviewItem;

  let adjusting = false;
  let adjustValue = '';

  function dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function dollarsToCents(s: string): number {
    const n = parseFloat(s);
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100);
  }

  function startAdjust() {
    adjustValue = (item.suggestedAmountCents / 100).toFixed(2);
    adjusting = true;
  }

  function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  // A cycle stays actionable until finalized. 'reviewed' is currently unreachable,
  // but gating on 'open' alone would strand it if that ever changes.
  $: actionable = item.status !== 'paid' && item.status !== 'skipped';
  $: overdue = item.weeksAgo > 0;
</script>

<article
  class="rounded-xl border bg-white p-4 {overdue ? 'border-amber-300' : 'border-slate-200'}"
>
  <header class="flex items-center justify-between">
    <div>
      <div class="font-medium text-lg">{item.kidName}</div>
      <div class="text-xs text-slate-500">
        Age {item.age} · {shortDate(item.weekStarting)} – {shortDate(item.weekEnding)}
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

  <div class="mt-3 text-sm">
    <span class="font-medium">{item.confirmedCount} of {item.totalCount}</span>
    <span class="text-slate-500"> chores {overdue ? 'that week' : 'this week'}</span>
    {#if item.missedChoreNames.length > 0 && actionable}
      <div class="mt-1 text-xs text-amber-700">
        Missed: {item.missedChoreNames.join(', ')}
      </div>
    {/if}
  </div>

  {#if actionable}
    {#if adjusting}
      <form method="POST" action="?/approve" use:enhance class="mt-4 space-y-2">
        <input type="hidden" name="cycleId" value={item.cycleId} />
        <input type="hidden" name="amountCents" value={dollarsToCents(adjustValue)} />
        <label class="block">
          <span class="text-sm font-medium">Amount</span>
          <div class="mt-1 flex items-center gap-2">
            <span class="text-lg">$</span>
            <input
              type="number"
              step="0.25"
              min="0"
              bind:value={adjustValue}
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
            Approve {dollars(dollarsToCents(adjustValue))}
          </button>
          <button
            type="button"
            on:click={() => (adjusting = false)}
            class="rounded-lg bg-slate-200 hover:bg-slate-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    {:else}
      <div class="mt-4 grid grid-cols-3 gap-2">
        <form method="POST" action="?/approve" use:enhance>
          <input type="hidden" name="cycleId" value={item.cycleId} />
          <input type="hidden" name="amountCents" value={item.suggestedAmountCents} />
          <button
            class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium"
          >
            Approve {dollars(item.suggestedAmountCents)}
          </button>
        </form>
        <button
          type="button"
          on:click={startAdjust}
          class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium"
        >
          Adjust
        </button>
        <form method="POST" action="?/skip" use:enhance>
          <input type="hidden" name="cycleId" value={item.cycleId} />
          <button
            class="w-full rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 py-3 text-sm font-medium"
          >
            Skip
          </button>
        </form>
      </div>
    {/if}
  {/if}
</article>
