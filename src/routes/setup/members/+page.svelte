<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import MemberManager from '$lib/components/MemberManager.svelte';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Add your family</title></svelte:head>

<header>
  <h1 class="text-2xl font-semibold">Add your family</h1>
  <p class="mt-1 text-sm text-slate-500">Add your kids and any co-parents. You can change these later in Settings.</p>
</header>

<MemberManager parents={data.parents} kids={data.kids} {form} />

<a href="/setup/done" class="mt-6 block rounded-lg bg-brand-700 hover:bg-brand-800 text-white py-3 text-center font-medium">
  Done
</a>
