import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

let unselectedIds: number[] = Array.from({ length: 1000000 }, (_, i) => i + 1);
let selectedIds: number[] = [];
let allIdsSet: Set<number> = new Set(unselectedIds);

class RequestQueue {
    private queue: Promise<void> = Promise.resolve();

    add<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue = this.queue.then(() => {
                return operation().then(resolve).catch(reject);
            });
        });
    }
}
const stateQueue = new RequestQueue();

interface PaginatedResponse {
    data: number[];
    hasMore: boolean;
}

function getPaginatedData(
    sourceArray: number[],
    search: string,
    page: number,
    limit: number,
): PaginatedResponse {
    let result = sourceArray;

    if (search) {
        const searchStr = String(search);
        result = sourceArray.filter(id => String(id).includes(searchStr));
    }

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    return {
        data: result.slice(startIndex, endIndex),
        hasMore: endIndex < result.length,
    };
}

type SelectAction = { type: 'SELECT'; id: number };
type UnselectAction = { type: 'UNSELECT'; id: number };
type MoveAction = { type: 'MOVE'; id: number; beforeId: number };
type Action = SelectAction | UnselectAction | MoveAction;

interface ListQuery {
    page?: string;
    limit?: string;
    search?: string;
}

interface AddBatchResult {
    added: number[];
    duplicates: number[];
}

app.get('/api/unselected', (req: Request<{}, {}, {}, ListQuery>, res: Response) => {
    const page = parseInt(req.query.page || '1', 10) || 1;
    const limit = parseInt(req.query.limit || '20', 10) || 20;
    const search = req.query.search || '';

    const { data, hasMore } = getPaginatedData(unselectedIds, search, page, limit);
    res.json({ data, hasMore, page, limit });
});

app.get('/api/selected', (req: Request<{}, {}, {}, ListQuery>, res: Response) => {
    const page = parseInt(req.query.page || '1', 10) || 1;
    const limit = parseInt(req.query.limit || '20', 10) || 20;
    const search = req.query.search || '';

    const { data, hasMore } = getPaginatedData(selectedIds, search, page, limit);
    res.json({ data, hasMore, page, limit });
});

app.post('/api/items/add-batch', async (req: Request, res: Response) => {
    const { newIds } = req.body as { newIds?: unknown };

    if (!Array.isArray(newIds)) return res.status(400).send('Invalid data');

    try {
        const result = await stateQueue.add<AddBatchResult>(async () => {
            const added: number[] = [];
            const duplicates: number[] = [];

            for (const id of newIds) {
                const idStr = String(id);
                if (!/^\d{1,15}$/.test(idStr)) continue;

                const numId = Number(idStr);
                if (!allIdsSet.has(numId)) {
                    allIdsSet.add(numId);
                    unselectedIds.push(numId);
                    added.push(numId);
                } else {
                    duplicates.push(numId);
                }
            }
            if (added.length) {
                unselectedIds.sort((a, b) => a - b);
            }
            console.log(`Добавлено новых уникальных ID: ${added.length}, дубликатов: ${duplicates.length}`);
            return { added, duplicates };
        });
        res.status(201).json({ success: true, ...result });
    } catch (error) {
        console.error('Ошибка обработки add-batch:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/items/update-batch', async (req: Request, res: Response) => {
    const { actions } = req.body as { actions?: unknown };

    if (!Array.isArray(actions)) return res.status(400).send('Invalid data');

    try {
        await stateQueue.add<void>(async () => {
            const selectedSet = new Set(selectedIds);
            const unselectedSet = new Set(unselectedIds);

            for (const raw of actions) {
                const action = raw as Action;
                if (action.type === 'SELECT') {
                    unselectedIds = unselectedIds.filter(id => id !== action.id);
                    unselectedSet.delete(action.id);
                    if (!selectedSet.has(action.id)) {
                        selectedIds.push(action.id);
                        selectedSet.add(action.id);
                    }
                }
                else if (action.type === 'UNSELECT') {
                    selectedIds = selectedIds.filter(id => id !== action.id);
                    selectedSet.delete(action.id);
                    if (!unselectedSet.has(action.id)) {
                        let lo = 0, hi = unselectedIds.length;
                        while (lo < hi) {
                            const mid = (lo + hi) >>> 1;
                            if (unselectedIds[mid] < action.id) lo = mid + 1;
                            else hi = mid;
                        }
                        unselectedIds.splice(lo, 0, action.id);
                        unselectedSet.add(action.id);
                    }
                }
                else if (action.type === 'MOVE' && action.beforeId) {
                    const currentIndex = selectedIds.indexOf(action.id);
                    if (currentIndex === -1) continue;

                    selectedIds.splice(currentIndex, 1);

                    const targetIndex = selectedIds.indexOf(action.beforeId);

                    if (targetIndex === -1) {
                        selectedIds.push(action.id);
                    } else {
                        selectedIds.splice(targetIndex, 0, action.id);
                    }
                }
            }
            return Promise.resolve();
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка обработки update-batch:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.post('/api/reset', async (req: Request, res: Response) => {
    try {
        const result = await stateQueue.add<{ reset: boolean; unselectedCount: number; selectedCount: number }>(() => {
            unselectedIds = Array.from({ length: 1000000 }, (_, i) => i + 1);
            selectedIds = [];
            allIdsSet = new Set(unselectedIds);
            console.log('Состояние сброшено к начальному (1 000 000 ID в левом окне)');
            return Promise.resolve({ reset: true, unselectedCount: unselectedIds.length, selectedCount: selectedIds.length });
        });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Ошибка сброса состояния:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
