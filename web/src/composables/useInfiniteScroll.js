import { onMounted, onUnmounted } from 'vue';

export function useInfiniteScroll(targetRef, onLoadMore) {
  let observer = null;

  onMounted(() => {
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        onLoadMore();
      }
    });
    if (targetRef.value) observer.observe(targetRef.value);
  });

  onUnmounted(() => {
    if (observer) observer.disconnect();
  });
}
