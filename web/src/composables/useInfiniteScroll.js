import { onMounted, onUnmounted, watch, nextTick } from 'vue';

export function useInfiniteScroll(targetRef, onLoadMore, throttleMs = 1500) {
  let observer = null;
  let lastCall = 0;

  const setupObserver = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    const el = targetRef.value;
    if (!el) return;
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && Date.now() - lastCall > throttleMs) {
        lastCall = Date.now();
        onLoadMore();
      }
    });
    observer.observe(el);
  };

  onMounted(() => {
    setupObserver();
    // Переустанавливаем observer, когда сентинел появляется/исчезает (v-if)
    watch(targetRef, async () => {
      await nextTick();
      setupObserver();
    });
  });

  onUnmounted(() => {
    if (observer) observer.disconnect();
  });
}
