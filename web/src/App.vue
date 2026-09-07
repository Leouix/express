<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import draggable from 'vuedraggable';
import { useIdsStore } from './stores/ids';
import { useInfiniteScroll } from './composables/useInfiniteScroll';

const store = useIdsStore();

const {
  unselected,
  selected,
  searchLeft,
  searchRight,
  newManualId,
  pendingAdditions,
  pendingUpdates,
  batchResult,
} = storeToRefs(store);

const leftObserver = ref(null);
const rightObserver = ref(null);

onMounted(() => store.init());
onUnmounted(() => store.dispose());

useInfiniteScroll(leftObserver, () => store.loadMoreLeft());
useInfiniteScroll(rightObserver, () => store.loadMoreRight());
</script>


<template>
  <div class="app-container">
    <!-- Блок добавления новых элементов -->
    <div class="add-bar">
      <input v-model="newManualId" type="number" placeholder="Введите новый ID" />
      <button @click="store.addNewId">Добавить в очередь</button>
      <span class="status" v-if="pendingAdditions.length">В очереди на добавление: {{ pendingAdditions.length }}</span>
      <span class="status success" v-if="batchResult && batchResult.added.length">
        Добавлено: {{ batchResult.added.length }}
      </span>
      <span class="status warn" v-if="batchResult && batchResult.duplicates.length">
        Дубликаты отклонены ({{ batchResult.duplicates.length }}): {{ batchResult.duplicates.join(', ') }}
      </span>
      <span class="status" v-if="pendingUpdates.length">Синхронизация сортировки...</span>
    </div>

    <div class="panes">
      <!-- ================= ЛЕВОЕ ОКНО (Невыбранные) ================= -->
      <div class="pane">
        <h3>Доступные ({{ unselected.length }} загружено)</h3>
        <input v-model="searchLeft" @input="store.onSearchLeft" placeholder="Поиск по ID..." class="search-input" />
        
        <div class="list-container">
          <div 
            v-for="id in unselected" 
            :key="'u-' + id" 
            class="list-item"
            @click="store.selectItem(id)"
          >
            {{ id }} <span class="action-icon">→</span>
          </div>
          <!-- Сенсор для инфинити-скролла -->
          <div ref="leftObserver" class="observer">Загрузка...</div>
        </div>
      </div>

      <!-- ================= ПРАВОЕ ОКНО (Выбранные + DnD) ================= -->
      <div class="pane">
        <h3>Выбранные (Drag&Drop)</h3>
        <input v-model="searchRight" @input="store.onSearchRight" placeholder="Поиск по ID..." class="search-input" />
        
        <div class="list-container">
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
          
          <!-- Сенсор для инфинити-скролла -->
          <div ref="rightObserver" class="observer">Загрузка...</div>
        </div>
      </div>
    </div>
  </div>
</template>


<style scoped>
/* Базовые стили для наглядности */
.app-container { font-family: sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
.add-bar { margin-bottom: 20px; display: flex; gap: 10px; align-items: center; }
.status { color: #666; font-size: 0.9em; }
.status.success { color: #2e7d32; }
.status.warn { color: #c62828; }
.panes { display: flex; gap: 20px; }
.pane { flex: 1; border: 1px solid #ccc; border-radius: 8px; padding: 10px; background: #fafafa; }
.search-input { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; }
.list-container { height: 400px; overflow-y: auto; border: 1px solid #eee; background: #fff; }
.list-item { padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; }
.list-item:hover { background: #f0f8ff; }
.selected-item { background: #e6ffe6; }
.selected-item:hover { background: #ccffcc; }
.drag-area { min-height: 100%; }
.observer { padding: 10px; text-align: center; color: #888; font-size: 0.9em; }
</style>