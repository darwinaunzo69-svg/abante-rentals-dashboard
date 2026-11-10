/* ============================================================
   Abante Rentals Admin Dashboard - Express.js backend
   REST API (CRUD) on top of SQLite. Serves the dashboard from /public.
   ============================================================ */
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { db, verifyPassword } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

app.use(express.json({ limit: "10mb" }));

/* ---------------- helpers ---------------- */
class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const nowIso = () => new Date().toISOString();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));

/* ---------------- sessions (in memory, cookie based) ---------------- */
const sessions = new Map();   // token -> { id, email, full_name, role }

function readCookie(req, name) {
    const header = req.headers.cookie || "";
    for (const part of header.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k === name) return decodeURIComponent(v.join("="));
    }
    return null;
}
function requireAdmin(req, res, next) {
    const token = readCookie(req, "sid");
    const user = token && sessions.get(token);
    if (!user) return res.status(401).json({ error: "Please sign in." });
    req.user = user;
    next();
}

/* ================= AUTH ================= */
app.post("/api/login", wrap((req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) throw new HttpError(400, "Email and password are required.");
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, "Invalid email or password.");
    if (user.role !== "admin") throw new HttpError(403, "This account is not an administrator.");
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { id: user.id, email: user.email, full_name: user.full_name, role: user.role });
    res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
    res.json({ id: user.id, email: user.email, full_name: user.full_name });
}));

app.get("/api/me", requireAdmin, (req, res) => res.json(req.user));

app.post("/api/logout", (req, res) => {
    const token = readCookie(req, "sid");
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ ok: true });
});

// everything below this line needs an admin session
app.use("/api", requireAdmin);

/* ================= IMAGE HELPERS ================= */
function saveImage(dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
    if (!m) throw new HttpError(400, "Image must be JPG, PNG or WEBP.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(400, "Image must be 2 MB or smaller.");
    const file = crypto.randomUUID() + "." + IMAGE_EXT[m[1]];
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    return { path: file, url: "/uploads/" + file };
}
function removeImage(file) {
    if (!file) return;
    const full = path.join(UPLOAD_DIR, path.basename(file));   // basename blocks path traversal
    fs.unlink(full, () => {});
}

/* ================= CARS (CRUD) ================= */
const CAR_STATUS = ["available", "reserved", "maintenance", "unavailable"];

function validateCar(c) {
    const text = (v) => String(v == null ? "" : v).trim();
    if (!text(c.name) || !text(c.brand) || !text(c.model)) throw new HttpError(400, "Name, brand and model are required.");
    if (!Number.isInteger(c.year) || c.year < 1990 || c.year > new Date().getFullYear() + 1) throw new HttpError(400, "Enter a valid year (1990 - next year).");
    if (!(typeof c.price_per_day === "number" && c.price_per_day > 0 && c.price_per_day < 1000000)) throw new HttpError(400, "Price must be a positive number.");
    if (!Number.isInteger(c.seats) || c.seats < 1 || c.seats > 20) throw new HttpError(400, "Seats must be a whole number from 1 to 20.");
    if (!["Automatic", "Manual"].includes(c.transmission)) throw new HttpError(400, "Invalid transmission.");
    if (!["Gasoline", "Diesel", "Hybrid", "Electric"].includes(c.fuel_type)) throw new HttpError(400, "Invalid fuel type.");
    if (!CAR_STATUS.includes(c.status)) throw new HttpError(400, "Invalid availability status.");
}

// READ all
app.get("/api/cars", wrap((req, res) => {
    res.json(db.prepare("SELECT * FROM cars ORDER BY created_at DESC").all());
}));

// CREATE
app.post("/api/cars", wrap((req, res) => {
    const b = req.body;
    const car = {
        name: String(b.name || "").trim(), brand: String(b.brand || "").trim(), model: String(b.model || "").trim(),
        year: Number(b.year), price_per_day: Number(b.price_per_day), seats: Number(b.seats),
        transmission: b.transmission || "Automatic", fuel_type: b.fuel_type || "Gasoline",
        engine: String(b.engine || "").trim() || null, drivetrain: String(b.drivetrain || "").trim() || null,
        tire_size: String(b.tire_size || "").trim() || null, description: String(b.description || "").trim().slice(0, 300) || null,
        status: b.status || "available"
    };
    validateCar(car);
    const saved = [];
    try {
        if (b.image_data) { const up = saveImage(b.image_data); saved.push(up.path); car.image_url = up.url; car.image_path = up.path; }
        if (b.interior_image_data) { const up = saveImage(b.interior_image_data); saved.push(up.path); car.interior_image_url = up.url; car.interior_image_path = up.path; }
    } catch (e) { saved.forEach(removeImage); throw e; }

    const id = crypto.randomUUID(), now = nowIso();
    db.prepare(`INSERT INTO cars (id, name, brand, model, year, price_per_day, transmission, fuel_type, seats, engine, drivetrain,
                tire_size, description, image_url, image_path, interior_image_url, interior_image_path, status, created_at, updated_at)
                VALUES (@id, @name, @brand, @model, @year, @price_per_day, @transmission, @fuel_type, @seats, @engine, @drivetrain,
                @tire_size, @description, @image_url, @image_path, @interior_image_url, @interior_image_path, @status, @now, @now)`)
        .run({ image_url: null, image_path: null, interior_image_url: null, interior_image_path: null, ...car, id, now });
    res.status(201).json(db.prepare("SELECT * FROM cars WHERE id = ?").get(id));
}));

// UPDATE (send only the fields that change, e.g. { status: "maintenance" })
app.put("/api/cars/:id", wrap((req, res) => {
    const old = db.prepare("SELECT * FROM cars WHERE id = ?").get(req.params.id);
    if (!old) throw new HttpError(404, "Car not found.");
    const b = req.body;
    const car = { ...old };
    ["name", "brand", "model", "transmission", "fuel_type", "status"].forEach((k) => { if (b[k] !== undefined) car[k] = String(b[k]).trim(); });
    ["year", "price_per_day", "seats"].forEach((k) => { if (b[k] !== undefined) car[k] = Number(b[k]); });
    ["engine", "drivetrain", "tire_size", "description"].forEach((k) => { if (b[k] !== undefined) car[k] = String(b[k] || "").trim() || null; });
    validateCar(car);

    const saved = [], toDelete = [];
    try {
        if (b.image_data) { const up = saveImage(b.image_data); saved.push(up.path); toDelete.push(old.image_path); car.image_url = up.url; car.image_path = up.path; }
        if (b.interior_image_data) { const up = saveImage(b.interior_image_data); saved.push(up.path); toDelete.push(old.interior_image_path); car.interior_image_url = up.url; car.interior_image_path = up.path; }
    } catch (e) { saved.forEach(removeImage); throw e; }

    db.prepare(`UPDATE cars SET name=@name, brand=@brand, model=@model, year=@year, price_per_day=@price_per_day,
                transmission=@transmission, fuel_type=@fuel_type, seats=@seats, engine=@engine, drivetrain=@drivetrain,
                tire_size=@tire_size, description=@description, image_url=@image_url, image_path=@image_path,
                interior_image_url=@interior_image_url, interior_image_path=@interior_image_path, status=@status,
                updated_at=@now WHERE id=@id`).run({ ...car, now: nowIso() });
    toDelete.forEach(removeImage);
    res.json(db.prepare("SELECT * FROM cars WHERE id = ?").get(old.id));
}));

// DELETE (reservations of the car are removed by ON DELETE CASCADE)
app.delete("/api/cars/:id", wrap((req, res) => {
    const car = db.prepare("SELECT * FROM cars WHERE id = ?").get(req.params.id);
    if (!car) throw new HttpError(404, "Car not found.");
    db.prepare("DELETE FROM cars WHERE id = ?").run(car.id);
    removeImage(car.image_path); removeImage(car.interior_image_path);
    res.json({ ok: true });
}));

/* ================= RESERVATIONS (CRUD) ================= */
const RES_STATUS = ["pending", "confirmed", "completed", "cancelled"];
const RES_SELECT = `SELECT r.*, json_object('name', c.name, 'price_per_day', c.price_per_day) AS car_json
                    FROM reservations r LEFT JOIN cars c ON c.id = r.car_id`;

function shapeReservation(row) {
    const { car_json, ...r } = row;
    r.cars = r.car_id && car_json ? JSON.parse(car_json) : null;
    if (r.cars && r.cars.name == null) r.cars = null;
    return r;
}

function validateReservation(r, ignoreId) {
    if (String(r.customer_name || "").trim().length < 2) throw new HttpError(400, "Customer name must be at least 2 characters.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(r.customer_email || "")) throw new HttpError(400, "Enter a valid customer email.");
    if (!db.prepare("SELECT 1 FROM cars WHERE id = ?").get(r.car_id)) throw new HttpError(400, "Selected car does not exist.");
    if (!isDate(r.pickup_date) || !isDate(r.return_date)) throw new HttpError(400, "Pickup and return dates are required.");
    if (r.return_date < r.pickup_date) throw new HttpError(400, "Return date cannot be before the pickup date.");
    if (!RES_STATUS.includes(r.status)) throw new HttpError(400, "Invalid reservation status.");
    if (r.message && r.message.length > 500) throw new HttpError(400, "Message must be 500 characters or less.");
    // double-booking protection (only pending/confirmed reservations block a car)
    if (r.status === "pending" || r.status === "confirmed") {
        const clash = db.prepare(`SELECT 1 FROM reservations WHERE car_id = ? AND id != ? AND status IN ('pending','confirmed')
                                  AND pickup_date <= ? AND return_date >= ?`).get(r.car_id, ignoreId || "", r.return_date, r.pickup_date);
        if (clash) throw new HttpError(409, "Dates overlap another active reservation for this car.");
    }
}

// READ all
app.get("/api/reservations", wrap((req, res) => {
    res.json(db.prepare(RES_SELECT + " ORDER BY r.created_at DESC").all().map(shapeReservation));
}));

// CREATE
app.post("/api/reservations", wrap((req, res) => {
    const b = req.body;
    const r = {
        car_id: b.car_id, customer_id: null,
        customer_name: String(b.customer_name || "").trim(), customer_email: String(b.customer_email || "").trim(),
        pickup_date: b.pickup_date, return_date: b.return_date,
        message: String(b.message || "").trim() || null, status: b.status || "pending"
    };
    validateReservation(r);
    const known = db.prepare("SELECT id FROM users WHERE email = ?").get(r.customer_email.toLowerCase());
    if (known) r.customer_id = known.id;
    const id = crypto.randomUUID(), now = nowIso();
    db.prepare(`INSERT INTO reservations (id, car_id, customer_id, customer_name, customer_email, pickup_date, return_date,
                message, status, created_at, updated_at)
                VALUES (@id, @car_id, @customer_id, @customer_name, @customer_email, @pickup_date, @return_date,
                @message, @status, @now, @now)`).run({ ...r, id, now });
    res.status(201).json(shapeReservation(db.prepare(RES_SELECT + " WHERE r.id = ?").get(id)));
}));

// UPDATE (full edit, or just { status })
app.put("/api/reservations/:id", wrap((req, res) => {
    const old = db.prepare("SELECT * FROM reservations WHERE id = ?").get(req.params.id);
    if (!old) throw new HttpError(404, "Reservation not found.");
    const b = req.body;
    const r = { ...old };
    ["car_id", "customer_name", "customer_email", "pickup_date", "return_date", "status"].forEach((k) => { if (b[k] !== undefined) r[k] = String(b[k]).trim(); });
    if (b.message !== undefined) r.message = String(b.message || "").trim() || null;
    validateReservation(r, old.id);
    db.prepare(`UPDATE reservations SET car_id=@car_id, customer_name=@customer_name, customer_email=@customer_email,
                pickup_date=@pickup_date, return_date=@return_date, message=@message, status=@status, updated_at=@now
                WHERE id=@id`).run({ ...r, now: nowIso() });
    res.json(shapeReservation(db.prepare(RES_SELECT + " WHERE r.id = ?").get(old.id)));
}));

// DELETE
app.delete("/api/reservations/:id", wrap((req, res) => {
    const info = db.prepare("DELETE FROM reservations WHERE id = ?").run(req.params.id);
    if (!info.changes) throw new HttpError(404, "Reservation not found.");
    res.json({ ok: true });
}));

/* ================= USERS ================= */
app.get("/api/users", wrap((req, res) => {
    res.json(db.prepare("SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at").all());
}));

app.put("/api/users/:id/role", wrap((req, res) => {
    const role = req.body.role;
    if (!["customer", "admin"].includes(role)) throw new HttpError(400, "Invalid role.");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!user) throw new HttpError(404, "User not found.");
    if (user.id === req.user.id) throw new HttpError(400, "You cannot change your own role.");
    if (user.role === "admin" && role !== "admin" &&
        db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n <= 1) {
        throw new HttpError(400, "At least one administrator must remain.");
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, user.id);
    // keep active sessions in sync with the new role
    sessions.forEach((s) => { if (s.id === user.id) s.role = role; });
    res.json({ id: user.id, role });
}));

/* ---------------- static files + error handling ---------------- */
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Upload is too large." });
    if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: "Invalid JSON." });
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Server error." });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Abante Rentals dashboard running at http://localhost:${PORT}`);
        console.log("Admin login: admin@abante.com / admin123");
    });
}
module.exports = app;

