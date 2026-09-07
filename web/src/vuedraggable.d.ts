declare module 'vuedraggable' {
  import { DefineComponent } from 'vue';

  interface DragEvent {
    newIndex: number;
    oldIndex: number;
  }

  type Draggable = DefineComponent<{
    modelValue?: unknown[];
    itemKey?: (item: unknown) => string | number | unknown;
    list?: unknown[];
    tag?: string;
    group?: string | Record<string, unknown>;
    ghostClass?: string;
    chosenClass?: string;
    dragClass?: string;
    animation?: number;
  }, {}, {}, {}, {}, {}, {}, {
    change: (evt: { added?: { element: unknown; newIndex: number }; removed?: { element: unknown; oldIndex: number }; moved?: { element: unknown; oldIndex: number; newIndex: number } }) => void;
    start: (evt: DragEvent) => void;
    end: (evt: DragEvent) => void;
    add: (evt: DragEvent) => void;
    remove: (evt: DragEvent) => void;
    update: (evt: DragEvent) => void;
  }>;

  const draggable: Draggable;
  export default draggable;
}