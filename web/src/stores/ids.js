import { defineStore } from 'pinia';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

const BATCH_INTERVAL = 10000; // 10 секунд (добавления)
const UPDATES_INTERVAL = 1000; // 1 секунда (обновления)

// --- Хелперы localStorage ---
const getStoredQueue = () => JSON.parse(localStorage.getItem('pendingAdditions') || '[]');
const setStoredQueue = (queue) => localStorage.setItem('pendingAdditions', JSON.stringify(queue));

const getStoredUpdates = () => JSON.parse(localStorage.getItem('pendingUpdates') || '[]');
const setStoredUpdates = (actions) => {
  localStorage.setItem('pendingUpdates', JSON.stringify(actions));
};

export const useIdsStore = defineStore('ids', {
  state: () => ({
    unselected: [],
    selected: [],

    isLoadingLeft: false,
    isLoadingRight: false,

    hasMoreLeft: true,
    hasMoreRight: true,

    searchLeft: '',
    searchRight: '',

    pageLeft: 1,
    pageRight: 1,

    newManualId: '',

    // --- Очереди для батчинга ---
    pendingAdditions: [],
    pendingUpdates: [],

    // --- Статус/очередь добавлений: переживают перезагрузку страницы ---
    batchStatus: localStorage.getItem('batchStatus') || 'empty',
    updatesStatus: localStorage.getItem('updatesStatus') || 'idle',

    // -- Результат последней отправки батча (для обратной связи с сервером) --
    // { added: [...], duplicates: [...] } или null, если батч ещё не отправлялся
    batchResult: null,
  }),

  getters: {
    queueLength: (state) => state.pendingAdditions.length,
    updatesLength: (state) => state.pendingUpdates.length,
  },

  actions: {
    // ==========================================
    // 1. ЗАПРОСЫ НА СЕРВЕР (ФЕТЧИНГ)
    // ==========================================
    async fetchUnselected(reset = false) {
      if (this.isLoadingLeft && !reset) return;
      if (reset) { this.pageLeft = 1; this.unselected = []; this.hasMoreLeft = true; }

      this.isLoadingLeft = true;
      try {
        const { data } = await axios.get(`${API_URL}/unselected`, {
          params: { search: this.searchLeft, page: this.pageLeft, limit: 20 }
        });
        this.unselected.push(...data.data);
        this.hasMoreLeft = data.hasMore;
      } finally {
        this.isLoadingLeft = false;
      }
    },

    async fetchSelected(reset = false) {
      if (this.isLoadingRight && !reset) return;
      if (reset) { this.pageRight = 1; this.selected = []; this.hasMoreRight = true; }

      this.isLoadingRight = true;
      try {
        const { data } = await axios.get(`${API_URL}/selected`, {
          params: { search: this.searchRight, page: this.pageRight, limit: 20 }
        });
        this.selected.push(...data.data);
        this.hasMoreRight = data.hasMore;
      } finally {
        this.isLoadingRight = false;
      }
    },

    // ==========================================
    // 1.1 БАТЧИНГ «ДОБАВЛЕНИЙ» (localStorage + 10-сек окно)
    // ==========================================
    async sendBatch() {
      const queue = getStoredQueue();
      if (!queue.length) {
        this.pendingAdditions = [];
        localStorage.setItem('batchStatus', 'empty');
        this.batchStatus = 'empty';
        return;
      }

      try {
        const { data } = await axios.post(`${API_URL}/items/add-batch`, { newIds: queue });

        // Успешно отправлено: очищаем очередь, фиксируем время и статус
        setStoredQueue([]);
        this.pendingAdditions = [];
        localStorage.setItem('lastSentTime', Date.now().toString());
        localStorage.setItem('batchStatus', 'empty');
        this.batchStatus = 'empty';

        // Сервер — авторитетный источник: он знает все 1 000 000 + добавленные ID.
        // Дубликаты, не замеченные клиентской проверкой, возвращаются сюда.
        const duplicates = data.duplicates || [];
        const added = data.added || [];

        this.batchResult = {
          added,
          duplicates,
        };
        this.scheduleBatchResultClear();

        // Добавляем подтверждённые сервером ID в колонку
        if (added.length) {
          this.unselected.push(...added);
        }

        // Откатываем оптимистичное UI-обновление: дубликаты добавлялись в список
        // в addNewId() до подтверждения сервера — теперь их нужно убрать.
        if (duplicates.length) {
          const dupSet = new Set(duplicates.map(Number));
          this.unselected = this.unselected.filter(id => !dupSet.has(id));
          this.selected = this.selected.filter(id => !dupSet.has(id));
        }
      } catch (error) {
        console.error('Ошибка отправки батча:', error);
        // Очередь остаётся в localStorage — повтор отправится при следующем addNewId/перезагрузке
      }
    },

    // Автоскрытие сообщения о результате батча через 5 секунд
    scheduleBatchResultClear() {
      if (window._batchResultTimeout) {
        clearTimeout(window._batchResultTimeout);
      }
      window._batchResultTimeout = setTimeout(() => {
        window._batchResultTimeout = null;
        this.batchResult = null;
      }, 5000);
    },

    // Планирует sendBatch через delay мс (чистит предыдущий таймер)
    scheduleBatch(delay) {
      if (window._batchTimeout) {
        clearTimeout(window._batchTimeout);
      }
      window._batchTimeout = setTimeout(async () => {
        window._batchTimeout = null;
        await this.sendBatch();
      }, delay);
    },

    addNewId() {
      if (!this.newManualId) return;
      const numId = Number(this.newManualId);

      // Быстрая предварительная проверка по уже загруженным данным:
      // очередь + левая колонка + правая колонка.
      // Она НЕ видит не загруженные страницы (ID 1-1000000 существуют на сервере),
      // поэтому итоговый ответ о дубликатах даёт сервер в sendBatch().
      const currentQueue = getStoredQueue();
      if (
        currentQueue.includes(numId) ||
        this.unselected.includes(numId) ||
        this.selected.includes(numId)
      ) {
        // Вместо alert — единое инлайн-сообщение «Дубликаты отклонены», автоскрытие 5 сек
        this.batchResult = { added: [], duplicates: [numId] };
        this.scheduleBatchResultClear();
        this.newManualId = '';
        return;
      }

      // 1. Кладём в очередь и сохраняем в localStorage
      currentQueue.push(numId);
      setStoredQueue(currentQueue);
      this.pendingAdditions = currentQueue;

      this.newManualId = '';

      // 2. Проверяем время последней отправки (10-сек окно)
      const lastSentTime = Number(localStorage.getItem('lastSentTime') || 0);
      const elapsed = Date.now() - lastSentTime;

      if (elapsed < BATCH_INTERVAL) {
        localStorage.setItem('batchStatus', 'pending');
        this.batchStatus = 'pending';
        this.scheduleBatch(BATCH_INTERVAL - elapsed);
      } else {
        this.scheduleBatch(0); // окно истекло — отправляем сразу
      }
    },

    // ==========================================
    // 1.2 БАТЧИНГ «ОБНОВЛЕНИЙ» (localStorage + 1-сек окно)
    // ==========================================
    async sendUpdates() {
      const actions = getStoredUpdates();
      if (!actions.length) {
        this.updatesStatus = 'idle';
        localStorage.setItem('updatesStatus', 'idle');
        return;
      }

      try {
        await axios.post(`${API_URL}/items/update-batch`, { actions });

        setStoredUpdates([]);
        this.pendingUpdates = [];
        localStorage.setItem('lastUpdatesSentTime', Date.now().toString());
        this.updatesStatus = 'idle';
        localStorage.setItem('updatesStatus', 'idle');
      } catch (error) {
        console.error('Ошибка отправки обновлений:', error);
        // Очередь остаётся в localStorage — повтор отправится при следующем действии/перезагрузке
      }
    },

    // Таймер на оставшуюся часть окна; повторными кликами deadline не сдвигаем
    scheduleUpdates(delay) {
      if (window._updatesTimeout) return;
      window._updatesTimeout = setTimeout(async () => {
        window._updatesTimeout = null;
        await this.sendUpdates();
      }, delay);
    },

    // Добавляет действие в очередь и решает: отправить сразу или копить до конца окна
    enqueueUpdate(action) {
      const queue = getStoredUpdates();
      queue.push(action);
      setStoredUpdates(queue);
      this.pendingUpdates = queue;

      const lastSentTime = Number(localStorage.getItem('lastUpdatesSentTime') || 0);
      const elapsed = Date.now() - lastSentTime;

      if (elapsed < UPDATES_INTERVAL) {
        this.updatesStatus = 'pending';
        localStorage.setItem('updatesStatus', 'pending');
        this.scheduleUpdates(UPDATES_INTERVAL - elapsed);
      } else {
        this.sendUpdates(); // первый запрос — отправляем сразу, не ждём 1 секунду
      }
    },

    // ==========================================
    // 2. ЛОГИКА ИНТЕРФЕЙСА (ДЕЙСТВИЯ ЮЗЕРА)
    // ==========================================
    selectItem(id) {
      // Оптимистичное UI-обновление
      this.unselected = this.unselected.filter(item => item !== id);
      this.selected.push(id);

      // Кладём в очередь
      this.enqueueUpdate({ type: 'SELECT', id });
    },

    unselectItem(id) {
      this.selected = this.selected.filter(item => item !== id);
      let lo = 0, hi = this.unselected.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.unselected[mid] < id) lo = mid + 1;
        else hi = mid;
      }
      this.unselected.splice(lo, 0, id);

      this.enqueueUpdate({ type: 'UNSELECT', id });
    },

    // Срабатывает, когда отпустили мышку после перетаскивания
    onDragEnd(event) {
      const newIndex = event.newIndex;
      // Массив selected УЖЕ обновлён vuedraggable на момент вызова @end
      const movedId = this.selected[newIndex];

      // Элемент, который теперь стоит ПОСЛЕ перетащенного
      const beforeId = newIndex + 1 < this.selected.length ? this.selected[newIndex + 1] : null;

      this.enqueueUpdate({ type: 'MOVE', id: movedId, beforeId });
    },

    // ==========================================
    // 3. ЖИЗНЕННЫЙ ЦИКЛ
    // ==========================================
    init() {
      // --- Восстановление очереди добавлений из localStorage ---
      this.pendingAdditions = getStoredQueue();

      const lastSentTime = Number(localStorage.getItem('lastSentTime') || 0);
      const elapsed = Date.now() - lastSentTime;
      const queue = getStoredQueue();

      if (queue.length > 0) {
        if (elapsed < BATCH_INTERVAL) {
          // Если время не истекло — доигрываем оставшееся до 10 сек
          localStorage.setItem('batchStatus', 'pending');
          this.batchStatus = 'pending';
          this.scheduleBatch(BATCH_INTERVAL - elapsed);
        } else {
          // Если 10 секунд уже прошли — шлём сразу
          this.sendBatch();
        }
      }

      // --- Восстановление очереди обновлений из localStorage ---
      this.pendingUpdates = getStoredUpdates();
      this.updatesStatus = localStorage.getItem('updatesStatus') || 'idle';

      const lastUpdatesSentTime = Number(localStorage.getItem('lastUpdatesSentTime') || 0);
      const updatesElapsed = Date.now() - lastUpdatesSentTime;

      if (this.pendingUpdates.length > 0) {
        if (updatesElapsed < UPDATES_INTERVAL) {
          // Секунда не истекла — доигрываем оставшееся
          this.updatesStatus = 'pending';
          this.scheduleUpdates(UPDATES_INTERVAL - updatesElapsed);
        } else {
          // Окно уже прошло — отправляем сразу
          this.sendUpdates();
        }
      }

      // --- Первичная загрузка ---
      this.fetchUnselected();
      this.fetchSelected();
    },

    dispose() {
      if (window._batchResultTimeout) {
        clearTimeout(window._batchResultTimeout);
        window._batchResultTimeout = null;
      }
      if (window._updatesTimeout) {
        clearTimeout(window._updatesTimeout);
        window._updatesTimeout = null;
      }
      if (window._batchTimeout) {
        clearTimeout(window._batchTimeout);
        window._batchTimeout = null;
      }
      clearTimeout(this._searchTimeoutLeft);
      clearTimeout(this._searchTimeoutRight);
    },

    // ==== ЗАГРУЗКА СЛЕДУЮЩЕЙ СТРАНИЦЫ (для инфинити-скролла) ====
    loadMoreLeft() {
      if (this.isLoadingLeft || !this.hasMoreLeft) return;
      this.pageLeft++;
      return this.fetchUnselected(false);
    },

    loadMoreRight() {
      if (this.isLoadingRight || !this.hasMoreRight) return;
      this.pageRight++;
      return this.fetchSelected(false);
    },

    // ==========================================
    // 4. ПОИСК И ИНФИНИТИ СКРОЛЛ
    // ==========================================
    onSearchLeft() {
      this.fetchUnselected(true)
    },

    onSearchRight() {
      this.fetchSelected(true)
    },
  },
});
