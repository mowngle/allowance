<script lang="ts">
  import type { ActionData } from './$types';
  export let form: ActionData;
</script>

<svelte:head><title>Welcome · Set up</title></svelte:head>

<header>
  <h1 class="text-2xl font-semibold">Welcome to Allowance</h1>
  <p class="mt-1 text-sm text-slate-600">Let's set up your family. Takes about a minute.</p>
  <ol class="mt-3 flex gap-2 text-xs text-slate-500">
    <li class="font-medium text-brand-700">1. Family</li>
    <li>›</li>
    <li>2. Parent</li>
    <li>›</li>
    <li>3. Kids</li>
    <li>›</li>
    <li>4. Done</li>
  </ol>
</header>

{#if form?.error}
  <p class="mt-3 rounded bg-red-100 p-3 text-red-800 text-sm">{form.error}</p>
{/if}

<form method="POST" class="mt-6 space-y-4">
  <label class="block">
    <span class="text-sm font-medium">Family name</span>
    <input
      type="text"
      name="name"
      required
      autofocus
      class="mt-1 block w-full rounded border-slate-300 border p-2"
      placeholder="e.g. The Smith Family"
    />
  </label>

  <label class="block">
    <span class="text-sm font-medium">Allowance review day</span>
    <select name="payoutDay" class="mt-1 block w-full rounded border-slate-300 border p-2 bg-white">
      <option value="0" selected>Sunday</option>
      <option value="1">Monday</option>
      <option value="2">Tuesday</option>
      <option value="3">Wednesday</option>
      <option value="4">Thursday</option>
      <option value="5">Friday</option>
      <option value="6">Saturday</option>
    </select>
    <span class="mt-1 text-xs text-slate-500 block">
      When you review the week's chores and decide each kid's allowance. Can be changed later.
    </span>
  </label>

  <button class="w-full rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 font-medium">
    Continue →
  </button>
</form>
