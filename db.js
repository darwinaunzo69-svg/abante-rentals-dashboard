/* ============================================================
   DATABASE LAYER  (SQLite using Node's built-in "node:sqlite")
   No native package to compile. Requires Node.js 22.13 or newer.
   Creates the tables on first run and seeds demo data.
   ============================================================ */
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const crypto = require("crypto");
   require("fs").mkdirSync(path.join(__dirname, "data"), { recursive: true });

const raw = new DatabaseSync(path.join(__dirname, "data", "rentals.db"));
raw.exec("PRAGMA journal_mode = WAL");
raw.exec("PRAGMA foreign_keys = ON");

// Small wrapper so the rest of the code can use db.prepare(sql).run/get/all(...)
const db = {
    exec(sql) { raw.exec(sql); },
    prepare(sql) {
        const stmt = raw.prepare(sql);
        const names = [...sql.matchAll(/@(\w+)/g)].map(function (m) { return m[1]; });
        function bind(args) {
            // named parameters: pass only the @names used in this statement
            if (names.length && args.length === 1 && args[0] && typeof args[0] === "object") {
                const o = {};
                names.forEach(function (n) { o[n] = args[0][n] === undefined ? null : args[0][n]; });
                return [o];
            }
            return args;
        }
        return {
            run: function () { const r = stmt.run.apply(stmt, bind([].slice.call(arguments))); return { changes: Number(r.changes) }; },
            get: function () { return stmt.get.apply(stmt, bind([].slice.call(arguments))); },
            all: function () { return stmt.all.apply(stmt, bind([].slice.call(arguments))); }
        };
    }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cars (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL CHECK (length(trim(name)) > 0),
  brand               TEXT NOT NULL CHECK (length(trim(brand)) > 0),
  model               TEXT NOT NULL CHECK (length(trim(model)) > 0),
  year                INTEGER NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  price_per_day       REAL NOT NULL CHECK (price_per_day > 0),
  transmission        TEXT NOT NULL DEFAULT 'Automatic' CHECK (transmission IN ('Automatic','Manual')),
  fuel_type           TEXT NOT NULL DEFAULT 'Gasoline' CHECK (fuel_type IN ('Gasoline','Diesel','Hybrid','Electric')),
  seats               INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 20),
  engine              TEXT,
  drivetrain          TEXT,
  tire_size           TEXT,
  description         TEXT,
  image_url           TEXT,
  image_path          TEXT,
  interior_image_url  TEXT,
  interior_image_path TEXT,
  status              TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','maintenance','unavailable')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id             TEXT PRIMARY KEY,
  car_id         TEXT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  customer_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL CHECK (length(trim(customer_name)) >= 2),
  customer_email TEXT NOT NULL,
  pickup_date    TEXT NOT NULL,
  return_date    TEXT NOT NULL,
  message        TEXT CHECK (message IS NULL OR length(message) <= 500),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK (return_date >= pickup_date)
);

CREATE INDEX IF NOT EXISTS cars_status_idx ON cars(status);
CREATE INDEX IF NOT EXISTS res_car_idx ON reservations(car_id);
CREATE INDEX IF NOT EXISTS res_status_idx ON reservations(status, created_at);
`);

/* ---------- password hashing (built-in crypto, no extra package) ---------- */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return salt + ":" + hash;
}
function verifyPassword(password, stored) {
    const [salt, hash] = String(stored).split(":");
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(password, salt, 64);
    const real = Buffer.from(hash, "hex");
    return test.length === real.length && crypto.timingSafeEqual(test, real);
}

/* ---------- seed demo data (only when the tables are empty) ---------- */
function isoDay(offset) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
}

function seed() {
    const now = new Date().toISOString();
    if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0) {
        const insertUser = db.prepare("INSERT INTO users (id, full_name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)");
        insertUser.run(crypto.randomUUID(), "Admin", "admin@abante.com", hashPassword("admin123"), "admin", now);
        insertUser.run(crypto.randomUUID(), "Maria Santos", "maria@example.com", hashPassword("customer123"), "customer", now);
        insertUser.run(crypto.randomUUID(), "Juan Dela Cruz", "juan@example.com", hashPassword("customer123"), "customer", now);
    }

    if (db.prepare("SELECT COUNT(*) AS n FROM cars").get().n === 0) {
        const insertCar = db.prepare(`INSERT INTO cars
            (id, name, brand, model, year, price_per_day, transmission, fuel_type, seats, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const cars = [
            ["Toyota Vios", "Toyota", "Vios", 2023, 3800, "Automatic", "Gasoline", 5, "Comfortable and practical sedan for everyday travel.", "available"],
            ["Honda City", "Honda", "City", 2023, 4200, "Automatic", "Gasoline", 5, "Stylish, smooth, and efficient for city driving.", "available"],
            ["Toyota Corolla", "Toyota", "Corolla", 2023, 4500, "Automatic", "Gasoline", 5, "Reliable and comfortable for long-distance trips.", "available"],
            ["Mitsubishi Xpander", "Mitsubishi", "Xpander", 2023, 4800, "Automatic", "Gasoline", 7, "Spacious MPV designed for family and group trips.", "available"],
            ["Toyota Fortuner", "Toyota", "Fortuner", 2023, 5000, "Automatic", "Diesel", 7, "Powerful SUV with plenty of space for passengers.", "available"],
            ["Ford Everest", "Ford", "Everest", 2023, 5400, "Automatic", "Diesel", 7, "Premium SUV built for comfortable adventures.", "maintenance"],
            ["Hyundai Staria", "Hyundai", "Staria", 2023, 5800, "Automatic", "Diesel", 9, "Spacious premium van for larger groups.", "available"],
            ["Ford Mustang", "Ford", "Mustang", 2023, 6500, "Automatic", "Gasoline", 4, "A sporty choice for drivers who want something special.", "available"]
        ];
        const ids = [];
        cars.forEach(function (c, i) {
            const id = crypto.randomUUID(); ids.push(id);
            // stagger created_at so "Newest first" sorting is visible
            const created = new Date(Date.now() - (cars.length - i) * 3600000).toISOString();
            insertCar.run(id, ...c, created, created);
        });

        const maria = db.prepare("SELECT id FROM users WHERE email = ?").get("maria@example.com");
        const juan = db.prepare("SELECT id FROM users WHERE email = ?").get("juan@example.com");
        const insertRes = db.prepare(`INSERT INTO reservations
            (id, car_id, customer_id, customer_name, customer_email, pickup_date, return_date, message, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const demo = [
            [ids[0], maria.id, "Maria Santos", "maria@example.com", isoDay(-1), isoDay(2), "Airport pickup please.", "confirmed"],
            [ids[3], juan.id, "Juan Dela Cruz", "juan@example.com", isoDay(5), isoDay(8), "Family trip to Tagaytay.", "pending"],
            [ids[1], null, "Ana Reyes", "ana@example.com", isoDay(10), isoDay(12), null, "pending"],
            [ids[4], maria.id, "Maria Santos", "maria@example.com", isoDay(-20), isoDay(-16), null, "completed"],
            [ids[7], juan.id, "Juan Dela Cruz", "juan@example.com", isoDay(-9), isoDay(-8), "Weekend drive.", "cancelled"]
        ];
        demo.forEach(function (r, i) {
            const created = new Date(Date.now() - (demo.length - i) * 7200000).toISOString();
            insertRes.run(crypto.randomUUID(), r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], created, created);
        });
    }
}
seed();

module.exports = { db, hashPassword, verifyPassword };
