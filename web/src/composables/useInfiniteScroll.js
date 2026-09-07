import { onMounted, onUnmounted } from 'vue';

export function useInfiniteScroll(targetRef, onLoadMore, throttleMs = 1500) {
  let observer = null;
  let lastCall = 0;

  onMounted(() => {
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && Date.now() - lastCall > throttleMs) {
        lastCall = Date.now();
        onLoadMore();
      }
    });
    if (targetRef.value) observer.observe(targetRef.value);
  });

  onUnmounted(() => {
    if (observer) observer.disconnect();
  });
}
