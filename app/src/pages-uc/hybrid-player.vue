<template><PlayerGame v-if="query" :query="query" variant="draw" /></template>
<script setup lang="ts">
import {ref} from 'vue'
import {onLoad} from '@dcloudio/uni-app'
import PlayerGame from './components/PlayerGame.vue'
const query=ref<Record<string,string|undefined>|null>(null)
onLoad(value=>{query.value=value ?? {}})
</script>
