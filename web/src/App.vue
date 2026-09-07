<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import draggable from 'vuedraggable';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

// --- Состояние данных ---
const unselected = ref([]);
const selected = ref([]);

const searchLeft = ref('');
const searchRight = ref('');

const pageLeft = ref(1);
const pageRight = ref(1);

const newManualId = ref('');

// --- Очереди для батчинга ---
const pendingAdditions = ref([]);
const pendingUpdates = ref([]);

// --- Статус/очередь добавлений: переживают перезагрузку страницы ---
// Сам таймер (setTimeout) в localStorage сохранить нельзя — хранится lastSentTime,
// а при onMounted по нему доигрывается оставшееся окно (или шлётся сразу).
const batchStatus = ref(localStorage.getItem('batchStatus') || 'empty');
const BATCH_INTERVAL = 10000; // 10 секунд

const getStoredQueue = () => JSON.parse(localStorage.getItem('pendingAdditions') || '[]');
const setStoredQueue = (queue) => localStorage.setItem('pendingAdditions', JSON.stringify(queue));

// ==========================================
// 1. ЗАПРОСЫ НА СЕРВЕР (ФЕТЧИНГ)
// ==========================================
const fetchUnselected = async (reset = false) => {
  if (reset) { pageLeft.value = 1; unselected.value = []; }
  
  const { data } = await axios.get(`${API_URL}/unselected`, {
    params: { search: searchLeft.value, page: pageLeft.value, limit: 20 }
  });
  unselected.value.push(...data.data);
};

const fetchSelected = async (reset = false) => {
  if (reset) { pageRight.value = 1; selected.value = []; }
  
  const { data } = await axios.get(`${API_URL}/selected`, {
    params: { search: searchRight.value, page: pageRight.value, limit: 20 }
  });
  selected.value.push(...data.data);
};

// ==========================================
// 1.1 БАТЧИНГ «ДОБАВЛЕНИЙ» (localStorage + 10-сек окно)
// ==========================================
const sendBatch = async () => {
  const queue = getStoredQueue();
  if (!queue.length) {
    pendingAdditions.value = [];
    localStorage.setItem('batchStatus', 'empty');
    batchStatus.value = 'empty';
    return;
  }

  try {
    await axios.post(`${API_URL}/items/add-batch`, { newIds: queue });

    // Успешно отправлено: очищаем очередь, фиксируем время и статус
    setStoredQueue([]);
    pendingAdditions.value = [];
    localStorage.setItem('lastSentTime', Date.now().toString());
    localStorage.setItem('batchStatus', 'empty');
    batchStatus.value = 'empty';
  } catch (error) {
    console.error('Ошибка отправки батча:', error);
    // Очередь остаётся в localStorage — повтор отправится при следующем addNewId/перезагрузке
  }
};

// Планирует sendBatch через delay мс (чистит предыдущий таймер)
const scheduleBatch = (delay) => {
  if (window._batchTimeout) {
    clearTimeout(window._batchTimeout);
  }
  window._batchTimeout = setTimeout(async () => {
    window._batchTimeout = null;
    await sendBatch();
  }, delay);
};

// ==========================================
// 2. ЛОГИКА ИНТЕРФЕЙСА (ДЕЙСТВИЯ ЮЗЕРА)
// ==========================================
const addNewId = () => {
  if (!newManualId.value) return;
  const numId = Number(newManualId.value);

  // 1. Кладём в очередь и сохраняем в localStorage
  const currentQueue = getStoredQueue();
  currentQueue.push(numId);
  setStoredQueue(currentQueue);
  pendingAdditions.value = currentQueue;

  // Оптимистичное обновление UI слева
  if (String(numId).includes(searchLeft.value)) {
    unselected.value.unshift(numId);
  }
  newManualId.value = '';

  // 2. Проверяем время последней отправки (10-сек окно)
  const lastSentTime = Number(localStorage.getItem('lastSentTime') || 0);
  const elapsed = Date.now() - lastSentTime;

  if (elapsed < BATCH_INTERVAL) {
    localStorage.setItem('batchStatus', 'pending');
    batchStatus.value = 'pending';
    scheduleBatch(BATCH_INTERVAL - elapsed);
  } else {
    scheduleBatch(0); // окно истекло — отправляем сразу
  }
};

const selectItem = (id) => {
  // Оптимистичное UI-обновление
  unselected.value = unselected.value.filter(item => item !== id);
  selected.value.push(id);

  // Кладём в очередь
  pendingUpdates.value.push({ type: 'SELECT', id });
};

const unselectItem = (id) => {
  selected.value = selected.value.filter(item => item !== id);
  unselected.value.push(id);

  pendingUpdates.value.push({ type: 'UNSELECT', id });
};

// Срабатывает, когда отпустили мышку после перетаскивания
const onDragEnd = (event) => {
  const newIndex = event.newIndex;
  // Массив selected УЖЕ обновлён vuedraggable на момент вызова @end
  const movedId = selected.value[newIndex];

  // Элемент, который теперь стоит ПОСЛЕ перетащенного
  const beforeId = newIndex + 1 < selected.value.length ? selected.value[newIndex + 1] : null;

  pendingUpdates.value.push({ type: 'MOVE', id: movedId, beforeId });
};

// ==========================================
// 3. ЖИЗНЕННЫЙ ЦИКЛ
// ==========================================
let updatesInterval;

onMounted(() => {
  // --- Восстановление очереди добавлений из localStorage ---
  pendingAdditions.value = getStoredQueue();

  const lastSentTime = Number(localStorage.getItem('lastSentTime') || 0);
  const elapsed = Date.now() - lastSentTime;
  const queue = getStoredQueue();

  if (queue.length > 0) {
    if (elapsed < BATCH_INTERVAL) {
      // Если время не истекло — доигрываем оставшееся до 10 сек
      localStorage.setItem('batchStatus', 'pending');
      batchStatus.value = 'pending';
      scheduleBatch(BATCH_INTERVAL - elapsed);
    } else {
      // Если 10 секунд уже прошли — шлём сразу
      sendBatch();
    }
  }

  // --- Синхронизация выбора/сортировки: раз в 1 секунду ---
  updatesInterval = setInterval(async () => {
    if (!pendingUpdates.value.length) return;

    const actionsToSend = [...pendingUpdates.value];
    pendingUpdates.value = [];

    try {
      await axios.post(`${API_URL}/items/update-batch`, { actions: actionsToSend });
    } catch (error) {
      // При ошибке возвращаем действия обратно в очередь
      pendingUpdates.value.unshift(...actionsToSend);
    }
  }, 1000);

  // --- Первичная загрузка ---
  fetchUnselected();
  fetchSelected();

  // --- Подключаем обсерверы инфинити-скролла ---
  setTimeout(() => {
    setupIntersectionObserver(leftObserver, () => fetchUnselected(false), pageLeft);
    setupIntersectionObserver(rightObserver, () => fetchSelected(false), pageRight);
  }, 500);
});

onUnmounted(() => {
  clearInterval(updatesInterval);
  if (window._batchTimeout) {
    clearTimeout(window._batchTimeout);
    window._batchTimeout = null;
  }
});

// ==========================================
// 4. ПОИСК И ИНФИНИТИ СКРОЛЛ
// ==========================================
let searchTimeout;
const onSearchLeft = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchUnselected(true), 300); // Дебаунс 300мс
};

const onSearchRight = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchSelected(true), 300);
};

// Настройка Intersection Observer для бесконечной прокрутки
const leftObserver = ref(null);
const rightObserver = ref(null);

const setupIntersectionObserver = (targetRef, fetchCallback, pageRef) => {
  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      pageRef.value++;
      fetchCallback();
    }
  });
  if (targetRef.value) observer.observe(targetRef.value);
};
</script>


<template>
  <div class="app-container">
    <!-- Блок добавления новых элементов -->
    <div class="add-bar">
      <input v-model="newManualId" type="number" placeholder="Введите новый ID" />
      <button @click="addNewId">Добавить в очередь</button>
      <span class="status" v-if="pendingAdditions.length">В очереди на добавление: {{ pendingAdditions.length }}</span>
      <span class="status" v-if="pendingUpdates.length">Синхронизация сортировки...</span>
    </div>

    <div class="panes">
      <!-- ================= ЛЕВОЕ ОКНО (Невыбранные) ================= -->
      <div class="pane">
        <h3>Доступные ({{ unselected.length }} загружено)</h3>
        <input v-model="searchLeft" @input="onSearchLeft" placeholder="Поиск по ID..." class="search-input" />
        
        <div class="list-container">
          <div 
            v-for="id in unselected" 
            :key="'u-' + id" 
            class="list-item"
            @click="selectItem(id)"
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
        <input v-model="searchRight" @input="onSearchRight" placeholder="Поиск по ID..." class="search-input" />
        
        <div class="list-container">
          <!-- 
             vuedraggable сам обновляет массив selected при перетаскивании. 
             @end срабатывает, когда мы отпустили элемент.
          -->
          <draggable 
            v-model="selected" 
            :item-key="el => el"
            @end="onDragEnd"
            class="drag-area"
          >
            <template #item="{ element }">
              <div class="list-item selected-item" @click="unselectItem(element)">
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