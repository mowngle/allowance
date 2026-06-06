<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<header class="flex items-center justify-between">
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
  <h1 class="text-xl font-semibold">Leaderboard</h1>
  <span class="w-12"></span>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

{#if !data.connected}
  <div class="mt-6 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
    <p class="font-medium">Not connected to a scoreboard yet.</p>
    <p class="mt-1 text-sm">A parent can connect on the <a href="/rivals" class="underline">Rivals</a> page.</p>
  </div>
{:else if data.unreachable}
  <div class="mt-6 rounded-xl bg-amber-100 text-amber-900 p-4 text-sm text-center">
    Can't reach the scoreboard right now. Showing nothing until it's back.
  </div>
{:else}
  <div class="mt-4 flex justify-end">
    <form method="POST" action="?/refresh" use:enhance>
      <button class="text-sm text-slate-500 hover:text-slate-800 underline">Refresh</button>
    </form>
  </div>
  {#if data.cup}
    <div class="mt-5 rounded-2xl bg-brand-700 text-white p-4 text-center">
      <div class="text-xs uppercase tracking-wide opacity-80">🏆 Cup holder</div>
      <div class="text-2xl font-bold mt-1">{data.cup.house}</div>
      <div class="text-xs opacity-90 mt-1">{data.cup.avgPct}% house average</div>
    </div>
  {/if}

  <section class="mt-6">
    <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Standings</h2>
    <div class="mt-2 space-y-2">
      {#each data.ranked as k (k.house + k.name)}
        <div class="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3">
          <div class="w-6 text-center font-semibold text-slate-400">{k.rank}</div>
          <div class="text-2xl" aria-hidden="true">{k.avatar || '🙂'}</div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">{k.name}</div>
            <div class="text-xs text-slate-500 truncate">{k.house}</div>
          </div>
          <div class="text-right">
            <div class="font-semibold">{k.pct}%</div>
            <div class="text-xs text-slate-500">🔥 {k.streak}</div>
          </div>
        </div>
        {#if k.badges.length}
          <div class="-mt-1 ml-9 flex gap-1 flex-wrap">
            {#each k.badges as b}
              <span class="rounded-full bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5">{b}</span>
            {/each}
          </div>
        {/if}
      {/each}
    </div>
  </section>

  {#if data.viewerCanCheer}
    <section class="mt-6">
      <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Send a cheer</h2>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each data.phrases as p}
          <form method="POST" action="?/cheer" use:enhance>
            <input type="hidden" name="phraseId" value={p.id} />
            <button class="rounded-full border border-slate-200 bg-white hover:border-slate-400 text-sm px-3 py-1.5">
              {p.text}
            </button>
          </form>
        {/each}
      </div>
    </section>
  {/if}

  <section class="mt-6">
    <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">Cheer wall</h2>
    {#if data.cheers.length === 0}
      <p class="mt-2 text-sm text-slate-500">No cheers yet.</p>
    {:else}
      <div class="mt-2 space-y-1">
        {#each data.cheers as c (c.ts + c.fromName)}
          <div class="text-sm">
            <span aria-hidden="true">{c.avatar || '🙂'}</span>
            <span class="font-medium">{c.fromName}</span>
            <span class="text-slate-500">({c.fromHouse}):</span>
            {c.text}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}
