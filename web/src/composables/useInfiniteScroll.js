import { onMounted, onUnmounted } from 'vue';

export function useInfiniteScroll(containerRef, onLoadMore, {
  threshold = 50,
  intervalMs = 2000,
} = {}) {
  let busy = false;
  let timer = null;

  const check = () => {
    const el = containerRef.value;
    if (!el || busy) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= threshold) {
      busy = true;
      Promise.resolve(onLoadMore()).finally(() => {
        busy = false;
      });
    }
  };

  const onScroll = () => check();

  const startTimer = () => {
    stopTimer();
    timer = setInterval(check, intervalMs);
  };

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  onMounted(() => {
    check();
    const el = containerRef.value;
    if (el) el.addEventListener('scroll', onScroll, { passive: true });
    startTimer();
  });

  onUnmounted(() => {
    stopTimer();
    const el = containerRef.value;
    if (el) el.removeEventListener('scroll', onScroll);
  });
}
