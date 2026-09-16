<script setup lang="ts">
import { computed, normalizeClass, type HTMLAttributes } from 'vue'

import { documentEntry } from '@/theme/home/document-entry'

const {
  name,
  metadata,
  previewURL,
  view = 'grid',
  disabled = false,
  badge = null,
  class: className
} = defineProps<{
  name: string
  metadata: string
  previewURL?: string | null
  view?: 'grid' | 'list'
  disabled?: boolean
  /** Localized marker rendered on the card, e.g. the unsaved-document label. */
  badge?: string | null
  class?: HTMLAttributes['class']
}>()
const emit = defineEmits<{ open: [] }>()
const styles = computed(() => documentEntry({ view }))
</script>

<template>
  <div data-slot="document-entry" :class="styles.root({ class: normalizeClass(className) })">
    <button
      type="button"
      :disabled="disabled"
      data-slot="trigger"
      :class="styles.trigger()"
      @click="emit('open')"
    >
      <span v-if="view === 'grid'" data-slot="preview" :class="styles.preview()">
        <img v-if="previewURL" :src="previewURL" alt="" :class="styles.image()" />
        <icon-lucide-file-image v-else :class="styles.fallback()" />
        <span
          v-if="badge"
          class="absolute top-1.5 left-1.5 rounded bg-panel px-1.5 py-0.5 text-[10px] font-medium text-muted shadow-sm"
        >{{ badge }}</span>
      </span>
      <icon-lucide-file-image v-else :class="styles.icon()" />
      <span data-slot="body" :class="styles.body()">
        <span data-slot="name" :class="styles.name()">
          {{ name }}
          <span
            v-if="badge"
            class="ml-1.5 rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium text-muted"
          >{{ badge }}</span>
        </span>
        <span data-slot="metadata" :class="styles.metadata()">{{ metadata }}</span>
      </span>
      <span v-if="view === 'list'" :class="styles.trailingMetadata()">{{ metadata }}</span>
    </button>
    <div v-if="$slots.actions" data-slot="actions" :class="styles.actions()">
      <slot name="actions" />
    </div>
  </div>
</template>
