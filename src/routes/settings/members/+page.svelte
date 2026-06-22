<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import MemberManager from '$lib/components/MemberManager.svelte';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>Family members</title></svelte:head>

<header>
  <a href="/settings" class="text-sm text-slate-500 hover:text-slate-800">← Settings</a>
  <h1 class="text-2xl font-semibold mt-1">Family members</h1>
</header>

<MemberManager parents={data.parents} kids={data.kids} {form} />
