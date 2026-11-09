/* ============================================================
    DSA LAYER - shared by the customer page and /admin/ dashboard
   4 Data Structures : Array, Queue, Stack, Binary Search Tree
   4+ Algorithms     : Linear Search, Binary Search,
                       Bubble Sort, Selection Sort,
                       FIFO Queue Processing
   ============================================================ */


/* ---------- DATA STRUCTURE: QUEUE (FIFO) ----------
   PURPOSE: Holds PENDING reservations in the order they were made.
   USED IN: admin.js -> loadQueue() / processNextReservation()  */
class Queue {
    constructor() { this.items = []; }
    enqueue(item) { this.items.push(item); }                  // add to the back
    dequeue() { return this.items.length ? this.items.shift() : null; } // remove from the front
    peek() { return this.items.length ? this.items[0] : null; }
    isEmpty() { return this.items.length === 0; }
    size() { return this.items.length; }
    toArray() { return [...this.items]; }
}


/* ---------- DATA STRUCTURE: STACK (LIFO) ----------
   PURPOSE: Admin action history; the most recent action is read first.
   USED IN: admin.js -> logAction() / undoLastStatusChange()    */
class Stack {
    constructor() { this.items = []; }
    push(item) { this.items.push(item); }                     // add to the top
    pop() { return this.items.length ? this.items.pop() : null; } // remove from the top
    peek() { return this.items.length ? this.items[this.items.length - 1] : null; }
    isEmpty() { return this.items.length === 0; }
    toArray() { return [...this.items].reverse(); }           // newest first
}


/* ---------- DATA STRUCTURE: BINARY SEARCH TREE ----------
   PURPOSE: Stores cars ordered by name (lowercase) so a name can be found
            without checking every car.
   USED IN: admin.js -> "Name (BST)" search; script.js -> customer search hint */
class BSTNode {
    constructor(key, value) { this.key = key; this.values = [value]; this.left = null; this.right = null; }
}
class BST {
    constructor() { this.root = null; }

    insert(key, value) {
        key = String(key).toLowerCase();
        const node = new BSTNode(key, value);
        if (!this.root) { this.root = node; return; }
        let cur = this.root;
        while (true) {
            if (key === cur.key) { cur.values.push(value); return; }   // duplicate name -> same node
            if (key < cur.key) {
                if (!cur.left) { cur.left = node; return; }
                cur = cur.left;
            } else {
                if (!cur.right) { cur.right = node; return; }
                cur = cur.right;
            }
        }
    }

    // Exact search: goes left or right at each node (O(log n) on a balanced tree)
    search(key) {
        key = String(key).toLowerCase();
        let cur = this.root;
        while (cur) {
            if (key === cur.key) return cur.values;
            cur = key < cur.key ? cur.left : cur.right;
        }
        return [];
    }

    // Prefix search: only visits branches that can still contain the prefix
    searchPrefix(prefix) {
        prefix = String(prefix).toLowerCase();
        const results = [];
        (function walk(node) {
            if (!node) return;
            if (node.key.startsWith(prefix)) results.push(...node.values);
            if (prefix <= node.key) walk(node.left);
            if (node.key.slice(0, prefix.length) <= prefix) walk(node.right);
        })(this.root);
        return results;
    }

    static fromCars(cars) {
        const tree = new BST();
        cars.forEach(function (car) { tree.insert(car.name, car); });
        return tree;
    }
}


/* ---------- ALGORITHM: LINEAR SEARCH ----------
   HOW: checks every item one by one from index 0 to the end.
   USED IN: customer search box, admin "All fields" search, reservation search */
function linearSearch(array, predicate) {
    const found = [];
    for (let i = 0; i < array.length; i++) {
        if (predicate(array[i])) found.push(array[i]);
    }
    return found;
}


/* ---------- ALGORITHM: BINARY SEARCH ----------
   HOW: on a SORTED array, compare with the middle item and throw away half
        each step. lowerBound = first index with value >= target,
        upperBound = first index with value > target.
   USED IN: customer price filter, admin "Price (Binary)" search       */
function lowerBound(sorted, target, getKey) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (getKey(sorted[mid]) < target) lo = mid + 1; else hi = mid;
    }
    return lo;
}
function upperBound(sorted, target, getKey) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (getKey(sorted[mid]) <= target) lo = mid + 1; else hi = mid;
    }
    return lo;
}
// Returns every item whose key is between min and max (array must be sorted by key)
function binarySearchRange(sorted, min, max, getKey) {
    return sorted.slice(lowerBound(sorted, min, getKey), upperBound(sorted, max, getKey));
}


/* ---------- ALGORITHM: BUBBLE SORT ----------
   HOW: repeatedly swaps neighbouring items that are in the wrong order,
        so large values "bubble" to the end.
   USED IN: admin car and reservation sorting                          */
function bubbleSort(array, compare) {
    const a = [...array];
    for (let i = 0; i < a.length - 1; i++) {
        let swapped = false;
        for (let j = 0; j < a.length - 1 - i; j++) {
            if (compare(a[j], a[j + 1]) > 0) {
                const tmp = a[j]; a[j] = a[j + 1]; a[j + 1] = tmp;
                swapped = true;
            }
        }
        if (!swapped) break;
    }
    return a;
}


/* ---------- ALGORITHM: SELECTION SORT ----------
   HOW: finds the smallest remaining item and puts it in the next position.
   USED IN: customer price filter (sort by price before binary search)  */
function selectionSort(array, compare) {
    const a = [...array];
    for (let i = 0; i < a.length - 1; i++) {
        let min = i;
        for (let j = i + 1; j < a.length; j++) {
            if (compare(a[j], a[min]) < 0) min = j;
        }
        if (min !== i) { const tmp = a[i]; a[i] = a[min]; a[min] = tmp; }
    }
    return a;
}


/* ---------- ALGORITHM: FIFO QUEUE PROCESSING ----------
   HOW: repeatedly dequeue the front (oldest) reservation and hand it to
        a handler, so requests are served in the order they arrived.
   USED IN: admin.js -> processNextReservation()                        */
async function processQueueFIFO(queue, handler, count) {
    const processed = [];
    for (let i = 0; i < count && !queue.isEmpty(); i++) {
        const item = queue.dequeue();
        await handler(item);
        processed.push(item);
    }
    return processed;
}