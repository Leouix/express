import { onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

interface InfiniteScrollOptions {
  threshold?: number;
  intervalMs?: number;
}

export function useInfiniteScroll(
  containerRef: Ref<HTMLElement | null>,
  onLoadMore: () => void | Promise<void>,
  { threshold = 50, intervalMs = 2000 }: InfiniteScrollOptions = {},
) {
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

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