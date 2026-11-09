/* ============================================================
   Abante Rentals Admin Dashboard (front-end)
   Talks to the Express.js REST API (/api/...). Security is enforced
   on the server (session + admin check); hiding buttons is NOT security.
   ============================================================ */

// DATA STRUCTURE: ARRAY - car and reservation records retrieved from the Express API
let cars = [];
let reservations = [];
let users = [];
let currentAdminId = "";

// DATA STRUCTURE: QUEUE - pending reservations, oldest at the front (FIFO)
let reservationQueue = new Queue();

// DATA STRUCTURE: STACK - admin action history, newest on top (LIFO)
const actionStack = new Stack();

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function $(id) { return document.getElementById(id); }
function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
function peso(v) { return "₱" + Number(v).toLocaleString("en-PH"); }
function toast(text) { const t = $("toast"); t.textContent = text; t.style.display = "block"; setTimeout(function () { t.style.display = "none"; }, 2500); }
function showMsg(id, text, ok) { const m = $(id); m.textContent = text; m.className = "msg" + (text ? " show" : "") + (ok ? " ok" : ""); }

// One small helper for every call to the Express API
async function api(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin"
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) { const err = new Error((data && data.error) || res.statusText); err.status = res.status; throw err; }
    return data;
}
// Read a chosen image file as a data URL so it can be sent as JSON
function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error("Could not read the image file.")); };
        reader.readAsDataURL(file);
    });
}


/* ================= AUTH ================= */

async function adminLogin(e) {
    e.preventDefault();
    const email = $("loginEmail").value.trim(), password = $("loginPassword").value;
    if (!email || !password) return showMsg("loginMsg", "Email and password are required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showMsg("loginMsg", "Enter a valid email address.");
    try {
        await api("POST", "/api/login", { email, password });
        await enterApp();
    } catch (err) {
        showMsg("loginMsg", "Login failed: " + err.message);
    }
}

async function enterApp() {
    let me;
    try { me = await api("GET", "/api/me"); } catch (err) { return; }   // not signed in -> stay on login
    currentAdminId = me.id;
    $("setEmail").value = me.email;
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    await refreshAll();
}

async function adminLogout() {
    try { await api("POST", "/api/logout"); } catch (err) { /* ignore */ }
    location.reload();
}


/* ================= TABS ================= */

document.querySelectorAll(".side-btn[data-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
        document.querySelectorAll(".side-btn").forEach(function (t) { t.classList.remove("active"); });
        btn.classList.add("active");
        ["dashboard", "cars", "reservations", "users", "maintenance", "reports", "settings"].forEach(function (n) {
            $("tab-" + n).classList.toggle("hidden", n !== btn.dataset.tab);
        });
    });
});


/* ================= LOAD DATA ================= */

async function refreshAll() {
    try {
        // READ: load everything from the API
        const all = await Promise.all([api("GET", "/api/cars"), api("GET", "/api/reservations"), api("GET", "/api/users")]);
        cars = all[0]; reservations = all[1]; users = all[2];
    } catch (err) {
        if (err.status === 401) return location.reload();
        return toast("Load error: " + err.message);
    }
    renderCars();
    renderReservations();
    renderUsers();
    loadQueue();
    renderActions();
    renderDashboard();
    renderMaintenance();
    renderReports();
}


/* ================= USERS ================= */

function renderUsers() {
    const term = $("userSearch").value.trim().toLowerCase();
    const matchingUsers = term ? users.filter(function (user) {
        return [user.full_name, user.email, user.role].join(" ").toLowerCase().indexOf(term) !== -1;
    }) : users;
    const adminCount = users.filter(function (user) { return user.role === "admin"; }).length;

    $("userTotal").textContent = users.length;
    $("userCustomers").textContent = users.filter(function (user) { return user.role === "customer"; }).length;
    $("userAdmins").textContent = adminCount;
    $("userRows").innerHTML = matchingUsers.length ? matchingUsers.map(function (user) {
        const joined = user.created_at ? new Date(user.created_at).toLocaleDateString() : "-";
        const bookingCount = reservations.filter(function (reservation) { return reservation.customer_id === user.id; }).length;
        const locked = user.id === currentAdminId || (user.role === "admin" && adminCount <= 1);
        const roleOptions = ["customer", "admin"].map(function (role) {
            return '<option value="' + role + '" ' + (user.role === role ? "selected" : "") + '>' + role + '</option>';
        }).join("");
        return "<tr><td><strong>" + esc(user.full_name || "Unnamed user") + "</strong>" +
            (user.id === currentAdminId ? " <small>(you)</small>" : "") + "</td><td>" + esc(user.email) +
            "</td><td>" + esc(joined) + "</td><td>" + bookingCount + "</td>" +
            '<td><select aria-label="Role for ' + esc(user.email) + '" onchange="changeUserRole(\'' + esc(user.id) + '\', this.value)" ' +
            (locked ? "disabled" : "") + ">" + roleOptions + "</select></td></tr>";
    }).join("") : '<tr><td colspan="5">No users found.</td></tr>';
}

async function changeUserRole(id, role) {
    const user = users.find(function (item) { return item.id === id; });
    if (!user || !["customer", "admin"].includes(role) || user.role === role) return;
    if (id === currentAdminId) return toast("You cannot change your own role.");
    const adminCount = users.filter(function (item) { return item.role === "admin"; }).length;
    if (user.role === "admin" && role !== "admin" && adminCount <= 1) {
        return toast("At least one administrator must remain.");
    }

    try { await api("PUT", "/api/users/" + id + "/role", { role }); }
    catch (err) {
        toast("Role update failed: " + err.message);
        return refreshAll();
    }
    logAction("Changed user role", (user.full_name || user.email) + ": " + user.role + " -> " + role);
    toast("User role updated");
    await refreshAll();
}


/* ================= CARS: SEARCH + SORT + DISPLAY ================= */

function carComparator(mode) {
    return {
        "price-asc": function (a, b) { return a.price_per_day - b.price_per_day; },
        "price-desc": function (a, b) { return b.price_per_day - a.price_per_day; },
        "name-asc": function (a, b) { return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1; },
        "name-desc": function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? 1 : -1; },
        "new": function (a, b) { return new Date(b.created_at) - new Date(a.created_at); },
        "old": function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }
    }[mode];
}

function searchCars(list, term, mode) {
    if (!term) return list;
    const t = term.toLowerCase();
    if (mode === "name") {
        // DATA STRUCTURE: BST + prefix search on car name
        return BST.fromCars(list).searchPrefix(t);
    }
    if (mode === "price") {
        const price = Number(term);
        if (isNaN(price)) return [];
        // ALGORITHMS: sort first, then BINARY SEARCH for that exact price
        const sorted = bubbleSort(list, carComparator("price-asc"));
        return binarySearchRange(sorted, price, price, function (c) { return Number(c.price_per_day); });
    }
    if (mode === "status") {
        return linearSearch(list, function (c) { return c.status.indexOf(t) === 0; });
    }
    // ALGORITHM: LINEAR SEARCH across name, brand, model, availability
    return linearSearch(list, function (c) {
        return [c.name, c.brand, c.model, c.status].join(" ").toLowerCase().indexOf(t) !== -1;
    });
}

function renderCars() {
    const term = $("carSearch").value.trim();
    let list = searchCars(cars, term, $("carSearchMode").value);
    list = bubbleSort(list, carComparator($("carSort").value));   // ALGORITHM: BUBBLE SORT

    $("carRows").innerHTML = list.length ? list.map(function (c) {
        const img = c.image_url ? '<img src="' + esc(c.image_url) + '" alt="">' : '<div class="noimg">No Image</div>';
        const opts = ["available", "reserved", "maintenance", "unavailable"].map(function (s) {
            return '<option ' + (s === c.status ? "selected" : "") + '>' + s + '</option>';
        }).join("");
        return '<tr><td>' + img + '</td><td><strong>' + esc(c.name) + '</strong><br><small>' + esc(c.brand) + ' ' + esc(c.model) + ' (' + c.year + ')</small></td>' +
            '<td><small>' + c.seats + ' seats<br>' + esc(c.transmission) + ' / ' + esc(c.fuel_type) + '</small></td>' +
            '<td>' + peso(c.price_per_day) + '</td>' +
            '<td><select onchange="changeCarStatus(\'' + c.id + '\', this.value)">' + opts + '</select></td>' +
            '<td><button class="btn small light" onclick="openCarModal(\'' + c.id + '\')">Edit</button> ' +
            '<button class="btn small danger" onclick="deleteCar(\'' + c.id + '\')">Delete</button></td></tr>';
    }).join("") : '<tr><td colspan="6">No cars found.</td></tr>';
}

async function changeCarStatus(id, status) {
    const car = cars.find(function (c) { return c.id === id; });
    try { await api("PUT", "/api/cars/" + id, { status }); }
    catch (err) { return toast("Failed: " + err.message); }
    logAction("Car availability", car.name + " -> " + status);
    toast("Availability updated");
    refreshAll();
}


/* ================= CARS: ADD / EDIT / IMAGE ================= */

function openCarModal(id) {
    const car = id ? cars.find(function (c) { return c.id === id; }) : null;
    showMsg("carMsg", "");
    $("carModalTitle").textContent = car ? "Edit Car" : "Add Car";
    $("carId").value = car ? car.id : "";
    $("carImage").value = "";
    $("interiorImage").value = "";
    $("carName").value = car ? car.name : "";
    $("carBrand").value = car ? car.brand : "";
    $("carModel").value = car ? car.model : "";
    $("carYear").value = car ? car.year : new Date().getFullYear();
    $("carPrice").value = car ? car.price_per_day : "";
    $("carSeats").value = car ? car.seats : 5;
    $("carStatus").value = car ? car.status : "available";
    $("carTrans").value = car ? car.transmission : "Automatic";
    $("carFuel").value = car ? car.fuel_type : "Gasoline";
    $("carEngine").value = car ? (car.engine || "") : "";
    $("carDrivetrain").value = car ? (car.drivetrain || "") : "";
    $("carTireSize").value = car ? (car.tire_size || "") : "";
    $("carDesc").value = car ? (car.description || "") : "";
    const p = $("carPreview");
    p.classList.toggle("hidden", !(car && car.image_url));
    if (car && car.image_url) p.src = car.image_url;
    const interiorPreview = $("interiorPreview");
    interiorPreview.classList.toggle("hidden", !(car && car.interior_image_url));
    if (car && car.interior_image_url) interiorPreview.src = car.interior_image_url;
    $("carModal").classList.add("show");
}
function closeCarModal() { $("carModal").classList.remove("show"); }

function checkImage(file) {
    if (!IMAGE_TYPES.includes(file.type)) return "Image must be JPG, PNG or WEBP.";
    if (file.size > MAX_IMAGE_BYTES) return "Image must be 2 MB or smaller.";
    return "";
}

function previewImage() {
    const file = $("carImage").files[0];
    if (!file) return;
    const err = checkImage(file);
    if (err) { $("carImage").value = ""; return showMsg("carMsg", err); }
    showMsg("carMsg", "");
    $("carPreview").src = URL.createObjectURL(file);
    $("carPreview").classList.remove("hidden");
}

function previewInteriorImage() {
    const file = $("interiorImage").files[0];
    if (!file) return;
    const err = checkImage(file);
    if (err) { $("interiorImage").value = ""; return showMsg("carMsg", err); }
    showMsg("carMsg", "");
    $("interiorPreview").src = URL.createObjectURL(file);
    $("interiorPreview").classList.remove("hidden");
}

async function saveCar(e) {
    e.preventDefault();
    const id = $("carId").value;
    const old = id ? cars.find(function (c) { return c.id === id; }) : null;
    const file = $("carImage").files[0];
    const interiorFile = $("interiorImage").files[0];
    const year = Number($("carYear").value), price = Number($("carPrice").value), seats = Number($("carSeats").value);

    // ----- VALIDATION -----
    const f = { name: $("carName").value.trim(), brand: $("carBrand").value.trim(), model: $("carModel").value.trim() };
    if (!f.name || !f.brand || !f.model) return showMsg("carMsg", "Name, brand and model are required.");
    if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) return showMsg("carMsg", "Enter a valid year (1990 - next year).");
    if (!($("carPrice").value !== "" && price > 0 && price < 1000000)) return showMsg("carMsg", "Price must be a positive number.");
    if (!Number.isInteger(seats) || seats < 1 || seats > 20) return showMsg("carMsg", "Seats must be a whole number from 1 to 20.");
    if (file) { const err = checkImage(file); if (err) return showMsg("carMsg", err); }
    if (interiorFile) { const err = checkImage(interiorFile); if (err) return showMsg("carMsg", err); }

    $("carSaveBtn").disabled = true;
    try {
        const row = Object.assign(f, {
            year, price_per_day: price, seats,
            transmission: $("carTrans").value, fuel_type: $("carFuel").value,
            engine: $("carEngine").value.trim(),
            drivetrain: $("carDrivetrain").value.trim(),
            tire_size: $("carTireSize").value.trim(),
            status: $("carStatus").value, description: $("carDesc").value.trim()
        });
        if (file) row.image_data = await readFileAsDataUrl(file);
        if (interiorFile) row.interior_image_data = await readFileAsDataUrl(interiorFile);
        // CREATE (POST) or UPDATE (PUT)
        if (id) await api("PUT", "/api/cars/" + id, row); else await api("POST", "/api/cars", row);

        logAction(id ? "Edited car" : "Added car", f.name);
        closeCarModal();
        toast("Car saved");
        refreshAll();
    } catch (err) {
        showMsg("carMsg", "Save failed: " + err.message);
    }
    $("carSaveBtn").disabled = false;
}

async function deleteCar(id) {
    const car = cars.find(function (c) { return c.id === id; });
    if (!confirm('Delete "' + car.name + '"? Its reservations will also be deleted.')) return;
    try { await api("DELETE", "/api/cars/" + id); }
    catch (err) { return toast("Delete failed: " + err.message); }
    logAction("Deleted car", car.name);
    toast("Car deleted");
    refreshAll();
}


/* ================= RESERVATIONS ================= */

function renderReservations() {
    const t = $("resSearch").value.trim().toLowerCase();
    // ALGORITHM: LINEAR SEARCH
    let list = t ? linearSearch(reservations, function (r) {
        return [r.customer_name, r.customer_email, r.cars ? r.cars.name : "", r.status].join(" ").toLowerCase().indexOf(t) !== -1;
    }) : reservations;

    const cmp = {
        "new": function (a, b) { return new Date(b.created_at) - new Date(a.created_at); },
        "old": function (a, b) { return new Date(a.created_at) - new Date(b.created_at); },
        "pickup": function (a, b) { return a.pickup_date > b.pickup_date ? 1 : -1; },
        "name-asc": function (a, b) { return a.customer_name.toLowerCase() > b.customer_name.toLowerCase() ? 1 : -1; },
        "name-desc": function (a, b) { return a.customer_name.toLowerCase() < b.customer_name.toLowerCase() ? 1 : -1; }
    }[$("resSort").value];
    list = bubbleSort(list, cmp);   // ALGORITHM: BUBBLE SORT

    $("resRows").innerHTML = list.length ? list.map(function (r) {
        const opts = ["pending", "confirmed", "completed", "cancelled"].map(function (s) {
            return '<option ' + (s === r.status ? "selected" : "") + '>' + s + '</option>';
        }).join("");
        return '<tr><td><strong>' + esc(r.customer_name) + '</strong><br><small>' + esc(r.customer_email) + '</small></td>' +
            '<td>' + esc(r.cars ? r.cars.name : "(deleted)") + '</td><td>' + r.pickup_date + '</td><td>' + r.return_date + '</td>' +
            '<td><small>' + esc(r.message || "-") + '</small></td>' +
            '<td><select onchange="changeReservationStatus(\'' + r.id + '\', this.value)">' + opts + '</select></td>' +
            '<td><button class="btn small light" onclick="openResModal(\'' + r.id + '\')">Edit</button> <button class="btn small danger" onclick="deleteReservation(\'' + r.id + '\')">Delete</button></td></tr>';
    }).join("") : '<tr><td colspan="7">No reservations found.</td></tr>';
}

async function changeReservationStatus(id, status, skipLog) {
    const r = reservations.find(function (x) { return x.id === id; });
    const prev = r.status;
    if (prev === status) return;
    try { await api("PUT", "/api/reservations/" + id, { status }); }
    catch (err) {
        toast(err.status === 409 ? "Cannot: dates overlap another active reservation." : "Failed: " + err.message);
        return refreshAll();
    }
    if (!skipLog) logAction("Reservation status", r.customer_name + ": " + prev + " -> " + status, { id, prev, next: status });
    await refreshAll();
}

async function deleteReservation(id) {
    const r = reservations.find(function (x) { return x.id === id; });
    if (!confirm("Delete this reservation for " + r.customer_name + "?")) return;
    try { await api("DELETE", "/api/reservations/" + id); }
    catch (err) { return toast("Delete failed: " + err.message); }
    logAction("Deleted reservation", r.customer_name);
    refreshAll();
}


/* ---------- BOOKING: ADD / EDIT ---------- */

function openResModal(id) {
    const r = id ? reservations.find(function (x) { return x.id === id; }) : null;
    showMsg("resMsg", "");
    $("resModalTitle").textContent = r ? "Edit Booking" : "Add Booking";
    $("resId").value = r ? r.id : "";
    $("resCar").innerHTML = cars.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + " (" + peso(c.price_per_day) + "/day)</option>";
    }).join("");
    if (r) $("resCar").value = r.car_id;
    $("resName").value = r ? r.customer_name : "";
    $("resEmail").value = r ? r.customer_email : "";
    $("resPickup").value = r ? r.pickup_date : "";
    $("resReturn").value = r ? r.return_date : "";
    $("resStatus").value = r ? r.status : "pending";
    $("resMessage").value = r ? (r.message || "") : "";
    $("resModal").classList.add("show");
}
function closeResModal() { $("resModal").classList.remove("show"); }

async function saveReservation(e) {
    e.preventDefault();
    const id = $("resId").value;
    const row = {
        car_id: $("resCar").value, customer_name: $("resName").value.trim(), customer_email: $("resEmail").value.trim(),
        pickup_date: $("resPickup").value, return_date: $("resReturn").value,
        status: $("resStatus").value, message: $("resMessage").value.trim()
    };
    if (!row.car_id) return showMsg("resMsg", "Add a car first.");
    if (row.customer_name.length < 2) return showMsg("resMsg", "Customer name must be at least 2 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.customer_email)) return showMsg("resMsg", "Enter a valid customer email.");
    if (!row.pickup_date || !row.return_date) return showMsg("resMsg", "Pickup and return dates are required.");
    if (row.return_date < row.pickup_date) return showMsg("resMsg", "Return date cannot be before the pickup date.");

    $("resSaveBtn").disabled = true;
    try {
        // CREATE (POST) or UPDATE (PUT)
        if (id) await api("PUT", "/api/reservations/" + id, row); else await api("POST", "/api/reservations", row);
        logAction(id ? "Edited booking" : "Added booking", row.customer_name);
        closeResModal();
        toast("Booking saved");
        refreshAll();
    } catch (err) {
        showMsg("resMsg", "Save failed: " + err.message);
    }
    $("resSaveBtn").disabled = false;
}


/* ================= QUEUE: pending reservations, FIFO ================= */

function loadQueue() {
    reservationQueue = new Queue();
    const pending = linearSearch(reservations, function (r) { return r.status === "pending"; });
    // oldest booking first, then enqueue in that order
    bubbleSort(pending, function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })
        .forEach(function (r) { reservationQueue.enqueue(r); });

    $("stPending").textContent = reservationQueue.size();
    $("queueList").innerHTML = reservationQueue.isEmpty() ? "<li>No pending reservations.</li>" :
        reservationQueue.toArray().map(function (r, i) {
            return "<li>#" + (i + 1) + " " + esc(r.customer_name) + " - " + esc(r.cars ? r.cars.name : "") +
                "<small>" + r.pickup_date + " to " + r.return_date + "</small></li>";
        }).join("");
}

async function processNextReservation() {
    if (reservationQueue.isEmpty()) return toast("Queue is empty.");
    // ALGORITHM: FIFO QUEUE PROCESSING - confirm the oldest pending reservation
    const done = await processQueueFIFO(reservationQueue, function (r) {
        return changeReservationStatus(r.id, "confirmed");
    }, 1);
    if (done.length) toast("Confirmed " + done[0].customer_name);
}


/* ================= STACK: admin action history ================= */

function logAction(type, detail, undo) {
    actionStack.push({ type, detail, undo: undo || null, time: new Date().toLocaleTimeString() });
    renderActions();
}

function renderActions() {
    const items = actionStack.toArray();
    $("actionList").innerHTML = items.length ? items.map(function (a) {
        return "<li>" + esc(a.type) + "<small>" + esc(a.detail) + " (" + a.time + ")</small></li>";
    }).join("") : "<li>No actions yet.</li>";
}

async function undoLastStatusChange() {
    const top = actionStack.peek();
    if (!top) return toast("No actions to undo.");
    if (!top.undo) return toast("Latest action (" + top.type + ") cannot be undone.");
    actionStack.pop();   // STACK: pop the most recent action
    await changeReservationStatus(top.undo.id, top.undo.prev, true);
    logAction("Undo", top.detail);
}


/* ================= DASHBOARD / MAINTENANCE / REPORTS ================= */

function rentalDays(r) { return Math.round((new Date(r.return_date) - new Date(r.pickup_date)) / 86400000) + 1; }
function resAmount(r) { return rentalDays(r) * Number(r.cars ? r.cars.price_per_day : 0); }
function isRevenue(r) { return r.status === "confirmed" || r.status === "completed"; }
function badge(status) {
    const cls = { pending: "warn", confirmed: "ok", completed: "ok", cancelled: "bad" }[status] || "ok";
    return '<span class="badge ' + cls + '">' + esc(status) + '</span>';
}

function renderDashboard() {
    const today = new Date().toISOString().split("T")[0];
    const revenue = linearSearch(reservations, isRevenue).reduce(function (s, r) { return s + resAmount(r); }, 0);
    const active = linearSearch(reservations, function (r) { return r.status === "confirmed" && r.pickup_date <= today && r.return_date >= today; }).length;
    $("stRevenue").textContent = peso(revenue);
    $("stActive").textContent = active;
    $("stActiveSub").textContent = "of " + cars.length + " vehicles";
    $("stMaint").textContent = linearSearch(cars, function (c) { return c.status === "maintenance"; }).length;

    const recent = bubbleSort(reservations, function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }).slice(0, 5);
    $("recentList").innerHTML = recent.length ? recent.map(function (r) {
        return "<li><strong>" + esc(r.cars ? r.cars.name : "(deleted)") + "</strong> " + badge(r.status) +
            "<small>" + esc(r.customer_name) + " | " + r.pickup_date + " to " + r.return_date + "</small></li>";
    }).join("") : "<li>No reservations yet.</li>";

    const colors = { available: "#2ea05a", reserved: "#0a7fd6", maintenance: "#e0a030", unavailable: "#b23a3a" };
    $("fleetBars").innerHTML = ["available", "reserved", "maintenance", "unavailable"].map(function (s) {
        const n = linearSearch(cars, function (c) { return c.status === s; }).length;
        const pct = cars.length ? Math.round(n / cars.length * 100) : 0;
        return '<div class="bar-row"><div><span>' + s + '</span><b>' + n + "/" + cars.length + '</b></div>' +
            '<div class="bar"><div style="width:' + pct + '%;background:' + colors[s] + '"></div></div></div>';
    }).join("");
}

function renderMaintenance() {
    const list = linearSearch(cars, function (c) { return c.status === "maintenance"; });
    $("maintRows").innerHTML = list.length ? list.map(function (c) {
        return "<tr><td><strong>" + esc(c.name) + "</strong></td><td><small>" + esc(c.brand) + " " + esc(c.model) + " (" + c.year + ")</small></td>" +
            '<td><span class="badge warn">maintenance</span></td>' +
            '<td><button class="btn small" onclick="changeCarStatus(\'' + c.id + '\', \'available\')">Mark available</button></td></tr>';
    }).join("") : '<tr><td colspan="4">No cars in maintenance.</td></tr>';
}

function renderReports() {
    const byMonth = {};
    linearSearch(reservations, isRevenue).forEach(function (r) {
        const m = r.pickup_date.slice(0, 7);
        byMonth[m] = (byMonth[m] || 0) + resAmount(r);
    });
    const months = Object.keys(byMonth).sort().reverse();
    const statuses = ["pending", "confirmed", "completed", "cancelled"];
    const today = new Date().toISOString().split("T")[0];
    const inUse = linearSearch(reservations, function (r) { return r.status === "confirmed" && r.pickup_date <= today && r.return_date >= today; }).length;
    const util = cars.length ? Math.round(inUse / cars.length * 100) : 0;

    $("reportCards").innerHTML =
        '<div class="panel"><h3>Revenue Report</h3><ul class="list">' + (months.length ? months.map(function (m) {
            return "<li>" + m + "<small>" + peso(byMonth[m]) + "</small></li>";
        }).join("") : "<li>No revenue yet.</li>") + '</ul></div>' +
        '<div class="panel"><h3>Fleet Utilization</h3><div class="stat" style="border:0;box-shadow:none;padding:0"><strong>' + util + '%</strong><span>' +
        inUse + " of " + cars.length + " cars rented today</span></div></div>" +
        '<div class="panel"><h3>Booking Analytics</h3><ul class="list">' + statuses.map(function (s) {
            return "<li>" + badge(s) + "<small>" + linearSearch(reservations, function (r) { return r.status === s; }).length + " reservations</small></li>";
        }).join("") + "</ul></div>";
}


/* ================= START ================= */

document.addEventListener("DOMContentLoaded", function () { enterApp(); });
