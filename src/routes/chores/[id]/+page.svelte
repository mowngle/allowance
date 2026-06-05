<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;

  let kind = data.recKind;
  let selectedDays: Set<number> = new Set(data.recDays);

  const DAYS = [
    { i: 0, label: 'S' },
    { i: 1, label: 'M' },
    { i: 2, label: 'T' },
    { i: 3, label: 'W' },
    { i: 4, label: 'T' },
    { i: 5, label: 'F' },
    { i: 6, label: 'S' },
  ];

  function toggleDay(i: number) {
    if (selectedDays.has(i)) selectedDays.delete(i);
    else selectedDays.add(i);
    selectedDays = selectedDays;
  }
  function preset(...days: number[]) {
    selectedDays = new Set(days);
  }

  $: daysCsv = Array.from(selectedDays).sort((a, b) => a - b).join(',');
</script>

<svelte:head>
  <title>Edit · {data.chore.name}</title>
</svelte:head>

<header>
  <a href="/chores" class="text-sm text-slate-500 hover:text-slate-800">← Chores</a>
  <h1 class="text-2xl font-semibold mt-1">Edit chore</h1>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

<form method="POST" action="?/save" class="mt-6 space-y-4">
  <label class="block">
    <span class="text-sm font-medium">Who is this for?</span>
    <select
      name="assigneeId"
      required
      class="mt-1 block w-full rounded border-slate-300 border p-2 bg-white"
    >
      {#each data.kids as k (k.id)}
        <option value={k.id} selected={k.id === data.chore.assigneeId}>{k.name}</option>
      {/each}
    </select>
  </label>

  <label class="block">
    <span class="text-sm font-medium">Chore name</span>
    <input
      type="text"
      name="name"
      required
      value={data.chore.name}
      class="mt-1 block w-full rounded border-slate-300 border p-2"
    />
  </label>

  <fieldset>
    <legend class="text-sm font-medium">How often?</legend>
    <div class="mt-2 space-y-2">
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="recurrenceKind" value="daily" bind:group={kind} />
        Every day
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="recurrenceKind" value="weekly" bind:group={kind} />
        Specific days
      </label>

      {#if kind === 'weekly'}
        <div class="ml-6 space-y-2">
          <div class="flex gap-1">
            {#each DAYS as d (d.i)}
              <button
                type="button"
                on:click={() => toggleDay(d.i)}
                class="w-10 h-10 rounded-full border-2 text-sm font-medium {selectedDays.has(d.i)
                  ? 'bg-brand-700 border-brand-700 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'}"
              >
                {d.label}
              </button>
            {/each}
          </div>
          <div class="flex gap-2 text-xs">
            <button type="button" class="text-slate-500 underline" on:click={() => preset(1, 2, 3, 4, 5)}>
              Mon–Fri
            </button>
            <button type="button" class="text-slate-500 underline" on:click={() => preset(0, 6)}>
              Weekends
            </button>
            <button type="button" class="text-slate-500 underline" on:click={() => preset(0, 1, 2, 3, 4, 5, 6)}>
              All week
            </button>
          </div>
        </div>
      {/if}

      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="recurrenceKind" value="by-end-of-week" bind:group={kind} />
        By end of week (due Saturday)
      </label>
    </div>
  </fieldset>

  <input type="hidden" name="recurrenceDays" value={daysCsv} />

  <fieldset>
    <legend class="text-sm font-medium">If it's not done by the end of the day…</legend>
    <div class="mt-2 space-y-2">
      <label class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="expiryRule"
          value="vanish"
          checked={data.chore.expiryRule === 'vanish'}
        />
        Vanish
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="expiryRule"
          value="roll_forward"
          checked={data.chore.expiryRule === 'roll_forward'}
        />
        Roll forward as "late"
      </label>
    </div>
  </fieldset>

  <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium">
    Save changes
  </button>
</form>

<form method="POST" action="?/toggleActive" use:enhance class="mt-6">
  <input type="hidden" name="active" value={data.chore.active ? 'false' : 'true'} />
  <button
    class="w-full rounded-lg {data.chore.active
      ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
      : 'bg-green-100 hover:bg-green-200 text-green-800'} py-2 text-sm font-medium"
  >
    {data.chore.active ? 'Disable this chore' : 'Enable this chore'}
  </button>
</form>
