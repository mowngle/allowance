<script lang="ts">
  type Member = { id: string; name: string; birthdate?: string | null; active: boolean; hasPin?: boolean };
  export let parents: Member[];
  export let kids: Member[];
  export let form: { error?: string; ok?: boolean; message?: string } | null = null;
</script>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{:else if form?.ok}
  <p class="mt-3 rounded bg-green-100 p-3 text-green-800 text-sm">{form.message}</p>
{/if}

<section class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Parents</h2>
  <ul class="mt-3 space-y-3">
    {#each parents as p (p.id)}
      <li class="flex items-center gap-2" class:opacity-50={!p.active}>
        <form method="POST" action="?/edit" class="flex flex-1 items-center gap-2">
          <input type="hidden" name="id" value={p.id} />
          <input name="name" value={p.name} required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
          <button class="rounded bg-slate-200 hover:bg-slate-300 px-3 py-2 text-sm">Save</button>
        </form>
        {#if p.active}
          <form method="POST" action="?/archive">
            <input type="hidden" name="id" value={p.id} />
            <button class="rounded bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm text-slate-600">Archive</button>
          </form>
        {:else}
          <form method="POST" action="?/restore">
            <input type="hidden" name="id" value={p.id} />
            <button class="rounded bg-brand-100 hover:bg-brand-200 px-3 py-2 text-sm">Restore</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
  <form method="POST" action="?/addParent" class="mt-4 flex gap-2">
    <input name="name" placeholder="Co-parent name" required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
    <button class="rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 text-sm font-medium">Add co-parent</button>
  </form>
  <p class="mt-2 text-xs text-slate-500">They set their own PIN on their device after claiming it.</p>
</section>

<section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
  <h2 class="font-medium">Kids</h2>
  <ul class="mt-3 space-y-3">
    {#each kids as k (k.id)}
      <li class="flex items-center gap-2" class:opacity-50={!k.active}>
        <form method="POST" action="?/edit" class="flex flex-1 items-center gap-2">
          <input type="hidden" name="id" value={k.id} />
          <input name="name" value={k.name} required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
          <input name="birthdate" type="date" value={k.birthdate ?? ''} required class="rounded border border-slate-300 p-2 text-sm" />
          <button class="rounded bg-slate-200 hover:bg-slate-300 px-3 py-2 text-sm">Save</button>
        </form>
        {#if k.active}
          <form method="POST" action="?/archive">
            <input type="hidden" name="id" value={k.id} />
            <button class="rounded bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm text-slate-600">Archive</button>
          </form>
        {:else}
          <form method="POST" action="?/restore">
            <input type="hidden" name="id" value={k.id} />
            <button class="rounded bg-brand-100 hover:bg-brand-200 px-3 py-2 text-sm">Restore</button>
          </form>
        {/if}
      </li>
    {/each}
  </ul>
  <form method="POST" action="?/addKid" class="mt-4 flex gap-2">
    <input name="name" placeholder="Kid name" required class="flex-1 rounded border border-slate-300 p-2 text-sm" />
    <input name="birthdate" type="date" required class="rounded border border-slate-300 p-2 text-sm" />
    <button class="rounded-lg bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 text-sm font-medium">Add kid</button>
  </form>
</section>
