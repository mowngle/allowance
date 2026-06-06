<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  export let data: PageData;
  $: session = data.session!;

  function dollars(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }
</script>

<svelte:head>
  <title>Allowance</title>
</svelte:head>

<header class="flex items-center justify-between">
  <h1 class="text-2xl font-semibold">Allowance</h1>
  <div class="flex items-center gap-3 text-sm">
    {#if session.role === 'parent'}
      <a href="/settings" class="text-slate-500 hover:text-slate-800 underline">Settings</a>
    {/if}
    <form method="POST" action="/logout">
      <button class="text-slate-500 hover:text-slate-800 underline">Log out</button>
    </form>
  </div>
</header>

<p class="mt-1 text-sm text-slate-600">
  Hi {session.personName} · <span class="capitalize">{session.role}</span>
</p>

{#if session.role === 'kid' && data.chores && data.progress}
  <!-- Balance card -->
  <a
    href="/me/history"
    class="mt-5 block rounded-2xl bg-brand-700 hover:bg-brand-800 text-white p-4 text-center"
  >
    <div class="text-3xl font-bold">{dollars(data.balanceCents ?? 0)}</div>
    <div class="mt-1 text-xs opacity-90">in your piggy bank · tap for history →</div>
  </a>

  <!-- Progress badge -->
  <div
    class="mt-5 rounded-2xl p-5 text-center {data.progress.status === 'on_track'
      ? 'bg-green-100 text-green-900'
      : 'bg-amber-100 text-amber-900'}"
  >
    {#if data.progress.status === 'on_track'}
      <div class="text-2xl font-semibold">On track ✓</div>
      <div class="mt-1 text-sm opacity-80">Keep it up.</div>
    {:else}
      <div class="text-2xl font-semibold">
        {data.progress.behindCount} chore{data.progress.behindCount === 1 ? '' : 's'} behind
      </div>
      <div class="mt-1 text-sm opacity-80">Catch up to stay on track for this week.</div>
    {/if}
  </div>

  <!-- Today's chores -->
  <section class="mt-6">
    <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Today's chores</h2>

    {#if data.chores.length === 0}
      <div class="mt-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 text-center">
        Nothing for today.
      </div>
    {:else}
      <div class="mt-2 grid grid-cols-2 gap-3">
        {#each data.chores as chore (chore.instanceId)}
          <form method="POST" action="?/markDone" use:enhance class="contents">
            <input type="hidden" name="instanceId" value={chore.instanceId} />
            <button
              type="submit"
              disabled={chore.status === 'done' || chore.status === 'confirmed'}
              class="rounded-xl border-2 p-4 text-left transition-colors {chore.status === 'confirmed'
                ? 'border-green-300 bg-green-50 text-green-900'
                : chore.status === 'done'
                ? 'border-blue-300 bg-blue-50 text-blue-900'
                : chore.rolledFromYesterday
                ? 'border-amber-400 bg-amber-50 hover:border-amber-500'
                : 'border-slate-200 bg-white hover:border-slate-400'}"
            >
              <div class="text-3xl mb-2" aria-hidden="true">
                {chore.status === 'confirmed' ? '✓' : chore.status === 'done' ? '⏳' : '○'}
              </div>
              <div class="font-medium">{chore.name}</div>
              {#if chore.rolledFromYesterday && chore.status === 'pending'}
                <div class="mt-1 text-xs font-medium text-amber-700">Late from yesterday</div>
              {/if}
              {#if chore.status === 'done'}
                <div class="mt-1 text-xs">Waiting for parent</div>
              {/if}
              {#if chore.status === 'confirmed'}
                <div class="mt-1 text-xs">Done</div>
              {/if}
            </button>
          </form>
        {/each}
      </div>
    {/if}
  </section>
  <a href="/leaderboard" class="mt-6 block rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-center py-3 font-medium">
    🏆 Leaderboard →
  </a>
{:else if session.role === 'parent' && data.kids && data.pending}
  <!-- Pending approvals -->
  <section class="mt-6">
    <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">
      {data.pending.length > 0 ? `${data.pending.length} to approve` : 'No pending approvals'}
    </h2>

    {#if data.pending.length > 0}
      <div class="mt-2 space-y-2">
        {#each data.pending as p (p.instanceId)}
          <div class="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">
                {p.kidName}: {p.choreName}
              </div>
              <div class="text-xs text-slate-500">
                {#if p.rolledFromYesterday}Late · {/if}
                Due {p.dueDate}
              </div>
            </div>
            <form method="POST" action="?/confirm" use:enhance>
              <input type="hidden" name="instanceId" value={p.instanceId} />
              <button class="rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-2 font-medium">
                Confirm
              </button>
            </form>
            <form method="POST" action="?/dispute" use:enhance>
              <input type="hidden" name="instanceId" value={p.instanceId} />
              <button class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm px-3 py-2 font-medium">
                Dispute
              </button>
            </form>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Quick links -->
  <div class="mt-6 grid grid-cols-2 gap-3">
    <a
      href="/review"
      class="rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-center py-3 font-medium"
    >
      Weekly review →
    </a>
    <a
      href="/chores"
      class="rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-center py-3 font-medium"
    >
      Chore admin →
    </a>
    <a href="/leaderboard" class="rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-center py-3 font-medium">
      🏆 Leaderboard →
    </a>
    <a href="/rivals" class="rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-center py-3 font-medium">
      Rivals →
    </a>
  </div>

  <!-- Kid summaries -->
  <section class="mt-6">
    <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Family</h2>
    <div class="mt-2 space-y-3">
      {#each data.kids as kid (kid.personId)}
        <a
          href="/kid/{kid.personId}"
          class="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium text-lg">{kid.name}</div>
              <div class="text-xs text-slate-500">Age {kid.age}</div>
            </div>
            <div class="text-right">
              <div class="text-lg font-semibold">{dollars(kid.balanceCents)}</div>
              <div class="text-xs text-slate-500">balance</div>
            </div>
          </div>
          <div class="mt-3 flex items-center gap-3">
            {#if kid.weekProgressStatus === 'on_track'}
              <span class="rounded-full bg-green-100 text-green-800 text-xs font-medium px-2 py-1">
                On track
              </span>
            {:else}
              <span class="rounded-full bg-amber-100 text-amber-900 text-xs font-medium px-2 py-1">
                {kid.behindCount} behind
              </span>
            {/if}
            {#if kid.pendingApprovalsCount > 0}
              <span class="text-xs text-slate-500">
                {kid.pendingApprovalsCount} waiting for you
              </span>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  </section>

  <div class="mt-8 text-xs text-slate-400">
    Coming next: parent PIN · push notifications · backups · Mac mini deploy.
  </div>
{/if}
