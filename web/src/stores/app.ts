import { defineStore } from 'pinia';
import { api } from './api';
import { useIdsStore } from './ids';
import { useAdditionsStore } from './additions';
import { useUpdatesStore } from './updates';

export const useAppStore = defineStore('app', {
  actions: {
    init() {
      useAdditionsStore().restoreFromStorage();
      useUpdatesStore().restoreFromStorage();

      const idsStore = useIdsStore();
      idsStore.fetchUnselected();
      idsStore.fetchSelected();
    },

    async resetAll() {
      try {
        await api.post('/reset');
      } catch (error) {
        console.error('Ошибка сброса состояния:', error);
        return;
      }

      useAdditionsStore().clear();
      useUpdatesStore().clear();
      useIdsStore().resetLists();

      this.refresh();
    },

    refresh() {
      const idsStore = useIdsStore();
      idsStore.fetchUnselected();
      idsStore.fetchSelected();
    },

    dispose() {
      useAdditionsStore().dispose();
      useUpdatesStore().dispose();
    },
  },
});