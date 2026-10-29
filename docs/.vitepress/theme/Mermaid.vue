<script lang="ts">
import { MERMAID } from './mermaid-config'

let mermaidReady: Promise<typeof import('mermaid').default> | undefined

// The dynamic import gives Mermaid its own chunk, which only a page with a diagram fetches.
function loadMermaid() {
  return (mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID)
    return mermaid
  }))
}
</script>

<script setup lang="ts">
import { onMounted, ref, useId } from 'vue'

/** `code` is the diagram source, URI-encoded so it survives an HTML attribute. */
const props = defineProps<{ code: string }>()
const source = decodeURIComponent(props.code)
const id = `mermaid-${useId()}`
const svg = ref('')

onMounted(async () => {
  const mermaid = await loadMermaid()
  svg.value = (await mermaid.render(id, source)).svg
})
</script>

<template>
  <div v-if="svg" class="mermaid" v-html="svg" />
  <pre v-else class="mermaid">{{ source }}</pre>
</template>
