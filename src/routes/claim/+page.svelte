<script lang="ts">
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;

  let selectedPersonId = '';
  let deviceName = '';
  let deviceKind: 'phone' | 'tablet' | 'desktop' | 'unknown' = 'desktop';

  // Group persons by family for display
  $: byFamily = data.families.map((f) => ({
    family: f,
    persons: data.persons.filter((p) => p.familyId === f.id),
  }));

  function pick(personId: string, personName: string) {
    selectedPersonId = personId;
    if (!deviceName) deviceName = `${personName}'s device`;
  }
</script>

<svelte:head>
  <title>Claim this device</title>
</svelte:head>

<h1 class="text-2xl font-semibold">Who's using this device?</h1>
<p class="mt-1 text-slate-600 text-sm">
  Tap your name to set up this device. You'll stay logged in until you log out.
</p>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

<form method="POST" class="mt-6 space-y-6">
  {#each byFamily as group (group.family.id)}
    <div>
      <h2 class="text-xs uppercase tracking-wide text-slate-500 font-medium">{group.family.name}</h2>
      <div class="mt-2 grid grid-cols-2 gap-3">
        {#each group.persons as person (person.id)}
          <button
            type="button"
            on:click={() => pick(person.id, person.name)}
            class="rounded-xl border-2 p-4 text-left transition-colors {selectedPersonId === person.id
              ? 'border-brand-600 bg-brand-50'
              : 'border-slate-200 bg-white hover:border-slate-300'}"
          >
            <div class="font-medium text-lg">{person.name}</div>
            <div class="text-xs text-slate-500 capitalize">{person.role}</div>
          </button>
        {/each}
      </div>
    </div>
  {/each}

  {#if selectedPersonId}
    <input type="hidden" name="personId" value={selectedPersonId} />

    <div class="space-y-3 rounded-xl bg-white border border-slate-200 p-4">
      <label class="block">
        <span class="text-sm font-medium">What is this device called?</span>
        <input
          type="text"
          name="deviceName"
          bind:value={deviceName}
          required
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm"
          placeholder="e.g. Sam's tablet"
        />
      </label>

      <label class="block">
        <span class="text-sm font-medium">Device type</span>
        <select
          name="deviceKind"
          bind:value={deviceKind}
          class="mt-1 block w-full rounded border-slate-300 border p-2 text-sm bg-white"
        >
          <option value="phone">Phone</option>
          <option value="tablet">Tablet</option>
          <option value="desktop">Desktop / Laptop</option>
          <option value="unknown">Other</option>
        </select>
      </label>

      <button
        type="submit"
        class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium"
      >
        Claim this device
      </button>
    </div>
  {/if}
</form>
