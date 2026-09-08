import { defineStore } from 'pinia';
import { api } from './api';
import type { UpdateAction } from '../types';

const UPDATES_INTERVAL = 1000; // 1 секунда (обновления)

let updatesTimeout: ReturnType<typeof setTimeout> | null = null;

const getStoredUpdates = (): UpdateAction[] => JSON.parse(localStorage.getItem('pendingUpdates') || '[]');
const setStoredUpdates = (actions: UpdateAction[]) => {
  localStorage.setItem('pendingUpdates', JSON.stringify(actions));
};

export const useUpdatesStore = defineStore('updates', {
  state: () => ({
    pendingUpdates: [] as UpdateAction[],
    updatesStatus: localStorage.getItem('updatesStatus') || 'idle',
  }),

  getters: {
    updatesLength: (state) => state.pendingUpdates.length,
  },

  actions: {
    async sendUpdates() {
      const actions = getStoredUpdates();
      if (!actions.length) {
        this.updatesStatus = 'idle';
        localStorage.setItem('updatesStatus', 'idle');
        return;
      }

      try {
        await api.post('/items/update-batch', { actions });

        setStoredUpdates([]);
        this.pendingUpdates = [];
        localStorage.setItem('lastUpdatesSentTime', Date.now().toString());
        this.updatesStatus = 'idle';
        localStorage.setItem('updatesStatus', 'idle');
      } catch (error) {
        console.error('Ошибка отправки обновлений:', error);
      }
    },

    scheduleUpdates(delay: number) {
      if (updatesTimeout) return;
      updatesTimeout = setTimeout(async () => {
        updatesTimeout = null;
        await this.sendUpdates();
      }, delay);
    },

    enqueueUpdate(action: UpdateAction) {
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
        this.sendUpdates();
      }
    },

    restoreFromStorage() {
      this.pendingUpdates = getStoredUpdates();
      this.updatesStatus = localStorage.getItem('updatesStatus') || 'idle';

      const lastUpdatesSentTime = Number(localStorage.getItem('lastUpdatesSentTime') || 0);
      const updatesElapsed = Date.now() - lastUpdatesSentTime;

      if (this.pendingUpdates.length > 0) {
        if (updatesElapsed < UPDATES_INTERVAL) {
          this.updatesStatus = 'pending';
          this.scheduleUpdates(UPDATES_INTERVAL - updatesElapsed);
        } else {
          this.sendUpdates();
        }
      }
    },

    clear() {
      setStoredUpdates([]);
      this.pendingUpdates = [];
      localStorage.setItem('updatesStatus', 'idle');
      this.updatesStatus = 'idle';
    },

    dispose() {
      if (updatesTimeout) {
        clearTimeout(updatesTimeout);
        updatesTimeout = null;
      }
    },
  },
});