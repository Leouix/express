<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import draggable from 'vuedraggable';
import { useAppStore } from './stores/app';
import { useIdsStore } from './stores/ids';
import { useAdditionsStore } from './stores/additions';
import { useUpdatesStore } from './stores/updates';
import { useInfiniteScroll } from './composables/useInfiniteScroll';

const appStore = useAppStore();
const store = useIdsStore();
const additionsStore = useAdditionsStore();
const updatesStore = useUpdatesStore();

const { unselected, selected, searchLeft, searchRight } = storeToRefs(store);
const { newManualId, pendingAdditions, batchResult } = storeToRefs(additionsStore);
const { pendingUpdates } = storeToRefs(updatesStore);

const leftList = ref<HTMLElement | null>(null);
const rightList = ref<HTMLElement | null>(null);

onMounted(() => appStore.init());
onUnmounted(() => appStore.dispose());

useInfiniteScroll(leftList, () => { store.loadMoreLeft(); }, { intervalMs: 2000 });
useInfiniteScroll(rightList, () => { store.loadMoreRight(); }, { intervalMs: 2000 });
</script>


<template>
  <div class="app-container">
    <!-- Блок добавления новых элементов -->
    <div class="add-bar">
      <input v-model="newManualId" type="number" placeholder="Введите новый ID" />
      <button @click="additionsStore.addNewId">Добавить в очередь</button>
      <span class="status" v-if="pendingAdditions.length">В очереди на добавление: {{ pendingAdditions.length }}</span>
      <span class="status success" v-if="batchResult && batchResult.added.length">
        Добавлено: {{ batchResult.added.length }}
      </span>
      <span class="status warn" v-if="batchResult && batchResult.duplicates.length">
        Дубликаты отклонены ({{ batchResult.duplicates.length }}): {{ batchResult.duplicates.join(', ') }}
      </span>
      <span class="status" v-if="pendingUpdates.length">Синхронизация сортировки...</span>
      <button class="reset-btn" @click="appStore.resetAll">Сбросить данные</button>
    </div>

    <div class="panes">
      <!-- ================= ЛЕВОЕ ОКНО (Невыбранные) ================= -->
      <div class="pane">
        <h3>Доступные ({{ unselected.length }} загружено)</h3>
        <input v-model="searchLeft" @input="store.onSearchLeft" placeholder="Поиск по ID..." class="search-input" />
        <div class="list-container" ref="leftList">
          <div 
            v-for="id in unselected" 
            :key="'u-' + id" 
            class="list-item"
            @click="store.selectItem(id)"
          >
            {{ id }} <span class="action-icon">→</span>
          </div>
        </div>
      </div>

      <!-- ================= ПРАВОЕ ОКНО (Выбранные + DnD) ================= -->
      <div class="pane">
        <h3>Выбранные (Drag&Drop)</h3>
        <input v-model="searchRight" @input="store.onSearchRight" placeholder="Поиск по ID..." class="search-input" />
        
        <div class="list-container" ref="rightList">
          <!-- 
             vuedraggable сам обновляет массив selected при перетаскивании. 
             @end срабатывает, когда мы отпустили элемент.
          -->
          <draggable 
            v-model="selected" 
            :item-key="el => el"
            @end="store.onDragEnd"
            class="drag-area"
          >
            <template #item="{ element }">
              <div class="list-item selected-item" @click="store.unselectItem(element)">
                <span class="action-icon">←</span> {{ element }}
              </div>
            </template>
          </draggable>
        </div>
      </div>
    </div>
  </div>
</template>


<style scoped>
/* Базовые стили для наглядности */
.app-container { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; }
.add-bar { margin-bottom: 20px; display: flex; gap: 10px; align-items: center; }
.status { color: #666; font-size: 0.9em; }
.status.success { color: #2e7d32; }
.status.warn { color: #c62828; }
.reset-btn { margin-left: auto; padding: 6px 12px; border: 1px solid #c62828; border-radius: 6px; background: #fff; color: #c62828; cursor: pointer; }
.reset-btn:hover { background: #c62828; color: #fff; }
.panes { display: flex; gap: 20px; flex: 1; min-height: 0; }
.pane { flex: 1; border: 1px solid #ccc; border-radius: 8px; padding: 10px; background: #fafafa; display: flex; flex-direction: column; min-height: 0; }
.search-input { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; }
.list-container { flex: 1; overflow-y: auto; border: 1px solid #eee; background: #fff; min-height: 0; }
.list-item { padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; }
.list-item:hover { background: #f0f8ff; }
.selected-item { background: #e6ffe6; }
.selected-item:hover { background: #ccffcc; }
.drag-area { min-height: 100%; }
</style>