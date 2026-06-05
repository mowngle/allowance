<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  export let data: PageData;

  // Group chores by assignee for display
  $: byKid = data.kids.map((k) => ({
    kid: k,
    chores: data.chores.filter((c) => c.assigneeId === k.id),
  }));
</script>

<svelte:head>
  <title>Chore admin</title>
</svelte:head>

<header class="flex items-center justify-between">
  <div>
    <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
    <h1 class="text-2xl font-semibold mt-1">Chores</h1>
  </div>
  <a
    href="/chores/new"
    class="rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 font-medium text-sm"
  >
    + Add
  </a>
</header>

<div class="mt-6 space-y-6">
  {#each byKid as group (group.kid.id)}
    <section>
      <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">
        {group.kid.name}
      </h2>
      {#if group.chores.length === 0}
        <p class="mt-1 text-sm text-slate-400">No chores yet.</p>
      {:else}
        <ul class="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {#each group.chores as c (c.id)}
            <li class="p-3 flex items-center gap-3 {c.active ? '' : 'opacity-50'}">
              <a
                href="/chores/{c.id}"
                class="flex-1 min-w-0 hover:bg-slate-50 -mx-3 px-3 py-1 rounded"
              >
                <div class="font-medium truncate">{c.name}</div>
                <div class="text-xs text-slate-500">
                  {c.recurrencePretty} ·
                  {c.expiryRule === 'roll_forward' ? 'Rolls forward if missed' : 'Vanishes if missed'}
                </div>
              </a>
              <form method="POST" action="?/toggleActive" use:enhance>
                <input type="hidden" name="choreId" value={c.id} />
                <input type="hidden" name="active" value={c.active ? 'false' : 'true'} />
                <button
                  type="submit"
                  class="text-xs rounded px-2 py-1 {c.active
                    ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                    : 'bg-green-100 hover:bg-green-200 text-green-800'}"
                >
                  {c.active ? 'Disable' : 'Enable'}
                </button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>
