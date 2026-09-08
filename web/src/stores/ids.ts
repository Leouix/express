import { defineStore } from 'pinia';
import { api } from './api';
import type { PaginatedResponse, UpdateAction } from '../types';
import { useUpdatesStore } from './updates';

export const useIdsStore = defineStore('ids', {
  state: () => ({
    unselected: [] as number[],
    selected: [] as number[],

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
    async fetchUnselected(reset = false) {
      if (this.isLoadingLeft && !reset) return;
      if (reset) { this.pageLeft = 1; this.unselected = []; this.hasMoreLeft = true; }

      this.isLoadingLeft = true;
      try {
        const { data } = await api.get<PaginatedResponse>('/unselected', {
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
        const { data } = await api.get<PaginatedResponse>('/selected', {
          params: { search: this.searchRight, page: this.pageRight, limit: 20 }
        });
        this.selected.push(...data.data);
        this.hasMoreRight = data.hasMore;
      } finally {
        this.isLoadingRight = false;
      }
    },

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

    onSearchLeft() {
      this.fetchUnselected(true);
    },

    onSearchRight() {
      this.fetchSelected(true);
    },

    selectItem(id: number) {
      this.unselected = this.unselected.filter(item => item !== id);
      this.selected.push(id);

      useUpdatesStore().enqueueUpdate({ type: 'SELECT', id });
    },

    unselectItem(id: number) {
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

    onDragEnd(event: { newIndex: number }) {
      const newIndex = event.newIndex;
      const movedId = this.selected[newIndex];

      const beforeId = newIndex + 1 < this.selected.length ? this.selected[newIndex + 1] : null;

      const action: UpdateAction = { type: 'MOVE', id: movedId, beforeId };
      useUpdatesStore().enqueueUpdate(action);
    },

    appendUnselected(ids: number[]) {
      this.unselected.push(...ids);
      this.unselected.sort((a, b) => a - b);
    },

    removeIds(ids: number[]) {
      const dupSet = new Set(ids.map(Number));
      this.unselected = this.unselected.filter(id => !dupSet.has(id));
    },

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