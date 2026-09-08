import { defineStore } from 'pinia';
import { api } from './api';
import type { AddBatchResponse, AddBatchResult } from '../types';
import { useIdsStore } from './ids';

const BATCH_INTERVAL = 10000; // 10 секунд (добавления)
const MAX_ID_LENGTH = 15; // 2^53-1 => максимум 15 цифр (без потери точности в number)

let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let batchResultTimeout: ReturnType<typeof setTimeout> | null = null;
let errorTimeout: ReturnType<typeof setTimeout> | null = null;

const getStoredQueue = (): number[] => JSON.parse(localStorage.getItem('pendingAdditions') || '[]');
const setStoredQueue = (queue: number[]) => localStorage.setItem('pendingAdditions', JSON.stringify(queue));

export const useAdditionsStore = defineStore('additions', {
  state: () => ({
    newManualId: '',

    pendingAdditions: [] as number[],

    batchStatus: localStorage.getItem('batchStatus') || 'empty',

    batchResult: null as AddBatchResult | null,

    inputError: '',
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

        setStoredQueue([]);
        this.pendingAdditions = [];
        localStorage.setItem('lastSentTime', Date.now().toString());
        localStorage.setItem('batchStatus', 'empty');
        this.batchStatus = 'empty';

        const duplicates = data.duplicates || [];
        const added = data.added || [];

        this.batchResult = {
          added,
          duplicates,
        };
        this.scheduleBatchResultClear();

        const idsStore = useIdsStore();
        if (added.length) {
          idsStore.appendUnselected(added);
        }

        if (duplicates.length) {
          idsStore.removeIds(duplicates);
        }
      } catch (error) {
        console.error('Ошибка отправки батча:', error);
      }
    },

    scheduleBatchResultClear() {
      if (batchResultTimeout) {
        clearTimeout(batchResultTimeout);
      }
      batchResultTimeout = setTimeout(() => {
        batchResultTimeout = null;
        this.batchResult = null;
      }, 5000);
    },

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
      const raw = this.newManualId.trim();
      if (!raw) return;

      if (!/^\d{1,15}$/.test(raw)) {
        this.inputError = `Максимум ${MAX_ID_LENGTH} цифр`;
        if (errorTimeout) {
          clearTimeout(errorTimeout);
        }
        errorTimeout = setTimeout(() => {
          errorTimeout = null;
          this.inputError = '';
        }, 5000);
        this.newManualId = '';
        return;
      }

      const numId = Number(raw);

      const idsStore = useIdsStore();

      const currentQueue = getStoredQueue();
      if (
        currentQueue.includes(numId) ||
        idsStore.unselected.includes(numId) ||
        idsStore.selected.includes(numId)
      ) {
        this.batchResult = { added: [], duplicates: [numId] };
        this.scheduleBatchResultClear();
        this.newManualId = '';
        return;
      }

      currentQueue.push(numId);
      setStoredQueue(currentQueue);
      this.pendingAdditions = currentQueue;

      this.newManualId = '';

      const lastSentTime = Number(localStorage.getItem('lastSentTime') || 0);
      const elapsed = Date.now() - lastSentTime;

      if (elapsed < BATCH_INTERVAL) {
        localStorage.setItem('batchStatus', 'pending');
        this.batchStatus = 'pending';
        this.scheduleBatch(BATCH_INTERVAL - elapsed);
      } else {
        this.sendBatch();
      }
    },

    restoreFromStorage() {
      this.pendingAdditions = getStoredQueue();

      const lastSentTime = Number(localStorage.getItem('lastSentTime') || 0);
      const elapsed = Date.now() - lastSentTime;
      const queue = getStoredQueue();

      if (queue.length > 0) {
        if (elapsed < BATCH_INTERVAL) {
          localStorage.setItem('batchStatus', 'pending');
          this.batchStatus = 'pending';
          this.scheduleBatch(BATCH_INTERVAL - elapsed);
        } else {
          this.sendBatch();
        }
      }
    },

    clear() {
      this.inputError = '';
      setStoredQueue([]);
      this.pendingAdditions = [];
      localStorage.setItem('batchStatus', 'empty');
      this.batchStatus = 'empty';
      this.batchResult = null;
      this.newManualId = '';
    },

    dispose() {
      if (errorTimeout) {
        clearTimeout(errorTimeout);
        errorTimeout = null;
      }
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