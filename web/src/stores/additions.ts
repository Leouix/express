import { defineStore } from 'pinia';
import { api } from './api';
import type { AddBatchResponse, AddBatchResult } from '../types';
import { useIdsStore } from './ids';

const BATCH_INTERVAL = 10000; // 10 секунд (добавления)

// --- Таймеры (module-scope, а не window.*): не протекают в глобальный объект ---
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let batchResultTimeout: ReturnType<typeof setTimeout> | null = null;

// --- Хелперы localStorage ---
const getStoredQueue = (): number[] => JSON.parse(localStorage.getItem('pendingAdditions') || '[]');
const setStoredQueue = (queue: number[]) => localStorage.setItem('pendingAdditions', JSON.stringify(queue));

export const useAdditionsStore = defineStore('additions', {
  state: () => ({
    newManualId: '',

    // --- Очередь для батчинга ---
    pendingAdditions: [] as number[],

    // --- Статус/очередь добавлений: переживают перезагрузку страницы ---
    batchStatus: localStorage.getItem('batchStatus') || 'empty',

    // -- Результат последней отправки батча (для обратной связи с сервером) --
    // { added: [...], duplicates: [...] } или null, если батч ещё не отправлялся
    batchResult: null as AddBatchResult | null,
  }),

  getters: {
    queueLength: (state) => state.pendingAdditions.length,
  },

  actions: {
    async sendBatch() {
      const queue = getStoredQueue();
      if (!queue.length) {
        this.pendingAdditions = [];
        localStorage.setItem('batchStatus', 'empty');
        this.batchStatus = 'empty';
        return;
      }

      try {
        const { data } = await api.post<AddBatchResponse>('/items/add-batch', { newIds: queue });

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

        const idsStore = useIdsStore();
        // Добавляем подтверждённые сервером ID в колонку
        if (added.length) {
          idsStore.appendUnselected(added);
        }

        // Откатываем оптимистичное UI-обновление: дубликаты добавлялись в список
        // в addNewId() до подтверждения сервера — теперь их нужно убрать.
        if (duplicates.length) {
          idsStore.removeIds(duplicates);
        }
      } catch (error) {
        console.error('Ошибка отправки батча:', error);
        // Очередь остаётся в localStorage — повтор отправится при следующем addNewId/перезагрузке
      }
    },

    // Автоскрытие сообщения о результате батча через 5 секунд
    scheduleBatchResultClear() {
      if (batchResultTimeout) {
        clearTimeout(batchResultTimeout);
      }
      batchResultTimeout = setTimeout(() => {
        batchResultTimeout = null;
        this.batchResult = null;
      }, 5000);
    },

    // Планирует sendBatch через delay мс (чистит предыдущий таймер)
    scheduleBatch(delay: number) {
      if (batchTimeout) {
        clearTimeout(batchTimeout);
      }
      batchTimeout = setTimeout(async () => {
        batchTimeout = null;
        await this.sendBatch();
      }, delay);
    },

    addNewId() {
      if (!this.newManualId) return;
      const numId = Number(this.newManualId);

      const idsStore = useIdsStore();

      // Быстрая предварительная проверка по уже загруженным данным:
      // очередь + левая колонка + правая колонка.
      // Она НЕ видит не загруженные страницы (ID 1-1000000 существуют на сервере),
      // поэтому итоговый ответ о дубликатах даёт сервер в sendBatch().
      const currentQueue = getStoredQueue();
      if (
        currentQueue.includes(numId) ||
        idsStore.unselected.includes(numId) ||
        idsStore.selected.includes(numId)
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
        this.sendBatch(); // окно истекло — отправляем сразу
      }
    },

    restoreFromStorage() {
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
    },

    clear() {
      setStoredQueue([]);
      this.pendingAdditions = [];
      localStorage.setItem('batchStatus', 'empty');
      this.batchStatus = 'empty';
      this.batchResult = null;
      this.newManualId = '';
    },

    dispose() {
      if (batchResultTimeout) {
        clearTimeout(batchResultTimeout);
        batchResultTimeout = null;
      }
      if (batchTimeout) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
      }
    },
  },
});