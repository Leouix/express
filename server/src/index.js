const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ==========================================
// 1. ХРАНИЛИЩЕ ДАННЫХ (IN-MEMORY)
// ==========================================
let unselectedIds = Array.from({ length: 1000000 }, (_, i) => i + 1);
let selectedIds = [];
const allIdsSet = new Set(unselectedIds);

// ==========================================
// 2. ПРОСТАЯ ОЧЕРЕДЬ ЗАПРОСОВ (QUEUE)
// ==========================================
// Гарантирует, что запросы на изменение данных обрабатываются строго по одному
class RequestQueue {
    constructor() {
        this.queue = Promise.resolve();
    }

    add(operation) {
        return new Promise((resolve, reject) => {
            this.queue = this.queue.then(() => {
                return operation().then(resolve).catch(reject);
            });
        });
    }
}
const stateQueue = new RequestQueue();

// ==========================================
// 3. ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ПАГИНАЦИИ И ПОИСКА
// ==========================================
function getPaginatedData(sourceArray, search, page, limit) {
    let result = sourceArray;

    // Фильтрация (поиск подстроки)
    if (search) {
        const searchStr = String(search);
        // ВНИМАНИЕ: filter миллиона элементов займет ~10-20 мс.
        // На реальном highload это выносят в Worker Threads, но для ТЗ in-memory это норма.
        result = sourceArray.filter(id => String(id).includes(searchStr));
    }

    // Пагинация
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    return {
        data: result.slice(startIndex, endIndex),
        // Есть ли ещё элементы после этой страницы
        hasMore: endIndex < result.length,
    };
}

// ==========================================
// 4. МАРШРУТЫ (РОУТЫ)
// ==========================================

// GET: Получить элементы левого окна (Невыбранные)
app.get('/api/unselected', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';

    const { data, hasMore } = getPaginatedData(unselectedIds, search, page, limit);
    res.json({ data, hasMore, page, limit });
});

// GET: Получить элементы правого окна (Выбранные)
app.get('/api/selected', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';

    const { data, hasMore } = getPaginatedData(selectedIds, search, page, limit);
    res.json({ data, hasMore, page, limit });
});

// POST: Батч добавления новых элементов (раз в 10 сек с фронта)
app.post('/api/items/add-batch', async (req, res) => {
    const { newIds } = req.body; // Ожидаем массив [1000001, 1000002, 5]

    if (!Array.isArray(newIds)) return res.status(400).send('Invalid data');

    // Ставим операцию в очередь
    await stateQueue.add(async () => {
        const added = [];
        const duplicates = [];
        
        for (const id of newIds) {
            const numId = Number(id);
            // Дедупликация: проверяем, нет ли уже такого ID за O(1)
            if (!allIdsSet.has(numId) && !isNaN(numId)) {
                allIdsSet.add(numId);
                unselectedIds.push(numId); // Добавляем в конец левого списка
                added.push(numId);
            } else if (!isNaN(numId)) {
                duplicates.push(numId);
            }
        }
        console.log(`Добавлено новых уникальных ID: ${added.length}, дубликатов: ${duplicates.length}`);
        return { added, duplicates };
    }).then((result) => {
        res.status(201).json({ success: true, ...result });
    });
});

// POST: Батч обновлений состояния (перенос и сортировка DnD раз в 1 сек)
app.post('/api/items/update-batch', async (req, res) => {
    // actions - массив действий пользователя, собранный за 1 секунду
    // Пример: [{ type: 'SELECT', id: 12 }, { type: 'MOVE', id: 12, beforeId: 100 }]
    const { actions } = req.body;

    if (!Array.isArray(actions)) return res.status(400).send('Invalid data');

    await stateQueue.add(async () => {
        // Пересоздаём Set'ы заново перед обработкой батча:
        // проверки наличия через Set работают за O(1), а не за O(n) как Array.includes
        const selectedSet = new Set(selectedIds);
        const unselectedSet = new Set(unselectedIds);

        for (const action of actions) {
            if (action.type === 'SELECT') {
                // Перенос из левого в правое
                unselectedIds = unselectedIds.filter(id => id !== action.id);
                unselectedSet.delete(action.id);
                if (!selectedSet.has(action.id)) {
                    selectedIds.push(action.id);
                    selectedSet.add(action.id);
                }
            } 
            else if (action.type === 'UNSELECT') {
                // Возврат в левое окно
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
                // Логика Drag & Drop сортировки в правом окне
                const currentIndex = selectedIds.indexOf(action.id);
                if (currentIndex === -1) continue;
                
                // Удаляем элемент с текущей позиции
                selectedIds.splice(currentIndex, 1);
                
                // Находим индекс элемента, ПЕРЕД которым нужно вставить
                const targetIndex = selectedIds.indexOf(action.beforeId);
                
                // Если targetIndex -1 (элемент beforeId не найден), ставим в конец
                if (targetIndex === -1) {
                    selectedIds.push(action.id);
                } else {
                    // Вставляем на нужную позицию
                    selectedIds.splice(targetIndex, 0, action.id);
                }
            }
        }
    });

    res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});