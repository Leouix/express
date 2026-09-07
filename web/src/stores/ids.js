import { defineStore } from 'pinia';
import { api } from './api';
import { useUpdatesStore } from './updates';

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
  }),

  actions: {
    // ==========================================
    // 1. ЗАПРОСЫ НА СЕРВЕР (ФЕТЧИНГ)
    // ==========================================
    async fetchUnselected(reset = false) {
      if (this.isLoadingLeft && !reset) return;
      if (reset) { this.pageLeft = 1; this.unselected = []; this.hasMoreLeft = true; }

      this.isLoadingLeft = true;
      try {
        const { data } = await api.get('/unselected', {
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
        const { data } = await api.get('/selected', {
          params: { search: this.searchRight, page: this.pageRight, limit: 20 }
        });
        this.selected.push(...data.data);
        this.hasMoreRight = data.hasMore;
      } finally {
        this.isLoadingRight = false;
      }
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
    // 2. ПОИСК
    // ==========================================
    onSearchLeft() {
      this.fetchUnselected(true);
    },

    onSearchRight() {
      this.fetchSelected(true);
    },

    // ==========================================
    // 3. ДЕЙСТВИЯ ЮЗЕРА (списки + очередь обновлений)
    // ==========================================
    selectItem(id) {
      // Оптимистичное UI-обновление
      this.unselected = this.unselected.filter(item => item !== id);
      this.selected.push(id);

      // Кладём в очередь
      useUpdatesStore().enqueueUpdate({ type: 'SELECT', id });
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

      useUpdatesStore().enqueueUpdate({ type: 'UNSELECT', id });
    },

    // Срабатывает, когда отпустили мышку после перетаскивания
    onDragEnd(event) {
      const newIndex = event.newIndex;
      // Массив selected УЖЕ обновлён vuedraggable на момент вызова @end
      const movedId = this.selected[newIndex];

      // Элемент, который теперь стоит ПОСЛЕ перетащенного
      const beforeId = newIndex + 1 < this.selected.length ? this.selected[newIndex + 1] : null;

      useUpdatesStore().enqueueUpdate({ type: 'MOVE', id: movedId, beforeId });
    },

    // ==========================================
    // 4. ВСПОМОГАТЕЛЬНЫЕ ДЕЙСТВИЯ (для batch-стора)
    // ==========================================

    // Добавляет подтверждённые сервером ID в невыбранную колонку
    appendUnselected(ids) {
      this.unselected.push(...ids);
      // Держим массив отсортированным: бинарный поиск в unselectItem
      // предполагает отсортированную последовательность.
      this.unselected.sort((a, b) => a - b);
    },

    // Убирает дубликаты из левой колонки после ответа сервера.
    // Никогда не трогаем selected: ID мог быть перемещён в правое окно
    // до того, как сервер подтвердил дубликат добавления.
    removeIds(ids) {
      const dupSet = new Set(ids.map(Number));
      this.unselected = this.unselected.filter(id => !dupSet.has(id));
    },

    // Сбрасывает пагинацию и состояние списков (используется при resetAll)
    resetLists() {
      this.searchLeft = '';
      this.searchRight = '';
      this.pageLeft = 1;
      this.pageRight = 1;
      this.hasMoreLeft = true;
      this.hasMoreRight = true;
      this.unselected = [];
      this.selected = [];
    },
  },
});
