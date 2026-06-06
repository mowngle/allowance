<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Rivals</title></svelte:head>

<header>
  <a href="/" class="text-sm text-slate-500 hover:text-slate-800">← Home</a>
  <h1 class="text-2xl font-semibold mt-1">Rivals</h1>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{:else if form?.ok && form?.message}
  <p class="mt-3 rounded bg-green-100 p-3 text-green-800 text-sm">{form.message}</p>
{/if}

{#if !data.connected}
  <section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
    <h2 class="font-medium">Connect to a scoreboard</h2>
    <p class="text-xs text-slate-500 mt-1">
      Enter the scoreboard service URL and a name for your house. You'll get a friend
      code to share with other families.
    </p>
    <form method="POST" action="?/connect" use:enhance class="mt-3 space-y-3">
      <input name="url" placeholder="https://…workers.dev" required
        class="block w-full rounded border-slate-300 border p-2 text-sm" />
      <input name="houseName" placeholder="House name (e.g. Smith)" required
        class="block w-full rounded border-slate-300 border p-2 text-sm" />
      <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-2 font-medium">
        Connect
      </button>
    </form>
  </section>
{:else}
  <section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
    <h2 class="font-medium">Your friend code</h2>
    <p class="text-xs text-slate-500 mt-1">Share this with families you want to compete with.</p>
    <div class="mt-2 text-2xl font-mono tracking-widest">{data.friendCode}</div>
    <div class="text-xs text-slate-500 mt-1">House: {data.houseName}</div>
  </section>

  <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
    <h2 class="font-medium">Add a rival</h2>
    <form method="POST" action="?/request" use:enhance class="mt-3 flex gap-2">
      <input name="friendCode" placeholder="THEIR-CODE" required
        class="flex-1 rounded border-slate-300 border p-2 text-sm font-mono" />
      <button class="rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-4 text-sm font-medium">
        Request
      </button>
    </form>
  </section>

  {#if data.requests.length}
    <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="font-medium">Requests</h2>
      <div class="mt-2 space-y-2">
        {#each data.requests as r (r.fromHouseId)}
          <div class="flex items-center gap-2">
            <div class="flex-1 text-sm font-medium">{r.fromName}</div>
            <form method="POST" action="?/approve" use:enhance>
              <input type="hidden" name="fromHouseId" value={r.fromHouseId} />
              <button class="rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5">Approve</button>
            </form>
            <form method="POST" action="?/decline" use:enhance>
              <input type="hidden" name="fromHouseId" value={r.fromHouseId} />
              <button class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm px-3 py-1.5">Decline</button>
            </form>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if data.rivals.length}
    <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="font-medium">Current rivals</h2>
      <div class="mt-2 space-y-2">
        {#each data.rivals as rv (rv.houseId)}
          <div class="flex items-center gap-2">
            <div class="flex-1 text-sm font-medium">{rv.house}</div>
            <form method="POST" action="?/leave" use:enhance>
              <input type="hidden" name="houseId" value={rv.houseId} />
              <button class="rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm px-3 py-1.5">Leave</button>
            </form>
          </div>
        {/each}
      </div>
    </section>
  {/if}
{/if}

<section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Who can post cheers</h2>
  <p class="text-xs text-slate-500 mt-1">Let a kid send canned cheers to the wall. Off by default.</p>
  <div class="mt-3 space-y-2">
    {#each data.kidPerms as kid (kid.id)}
      <form method="POST" action="?/setCheer" use:enhance class="flex items-center justify-between">
        <span class="text-sm font-medium">{kid.name}</span>
        <span class="flex items-center gap-2">
          <input type="hidden" name="kidId" value={kid.id} />
          <input type="checkbox" name="allowed" checked={kid.canPostCheers}
            on:change={(e) => e.currentTarget.form?.requestSubmit()} />
          <span class="text-xs text-slate-500">{kid.canPostCheers ? 'On' : 'Off'}</span>
        </span>
      </form>
    {/each}
  </div>
</section>
