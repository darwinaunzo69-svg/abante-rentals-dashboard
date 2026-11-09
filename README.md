# Abante Rentals – Admin Dashboard (CRUD)

A car-rental admin dashboard built with **Express.js** (backend) and **SQLite** (database).
It manages **Cars**, **Bookings (reservations)** and **Users** with full Create / Read / Update / Delete.

## Features
- **Create / Read / Update / Delete** for cars (with exterior + interior photo upload) and bookings
- Dashboard with live stats: revenue, active rentals, pending approvals, maintenance queue, fleet status
- Admin login (session cookie, passwords hashed with scrypt) – every API route is protected on the server
- Server-side validation + double-booking protection (overlapping dates are rejected with HTTP 409)
- Search, sort, reports, maintenance list, user role management
- Data-structure/algorithm layer (`public/dsa.js`): Queue (FIFO pending bookings), Stack (action history + undo),
  Binary Search Tree (car name search), Linear/Binary Search, Bubble/Selection Sort

## Tech stack
| Part | Tool |
|------|------|
| Backend | Node.js + Express.js |
| Database | SQLite (Node's built-in `node:sqlite`), file created automatically at `data/rentals.db` |
| Frontend | HTML, CSS, vanilla JavaScript (served by Express from `/public`) |

## Run it
Requires **Node.js 22.13 or newer** (the built-in SQLite module is used, so there is nothing to compile).

```bash
npm install
npm start
```

Open **http://localhost:3000** and sign in:

| Email | Password |
|-------|----------|
| `admin@abante.com` | `admin123` |

The database and demo data (8 cars, 3 users, 5 bookings) are created automatically on the first run.
To reset everything, stop the server and delete `data/rentals.db`.

## REST API
All routes except `POST /api/login` require an admin session.

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/login` · `/api/logout` | Sign in / out |
| GET | `/api/me` | Current admin |
| GET · POST | `/api/cars` | List / **create** car |
| PUT · DELETE | `/api/cars/:id` | **Update** / **delete** car |
| GET · POST | `/api/reservations` | List / **create** booking |
| PUT · DELETE | `/api/reservations/:id` | **Update** / **delete** booking |
| GET | `/api/users` | List users |
| PUT | `/api/users/:id/role` | Change a user's role |

## Project structure
```
server.js        Express app + REST API
db.js            SQLite schema, seed data, password hashing
public/
  index.html     Dashboard page (login + app)
  app.js         Front-end logic (calls the API with fetch)
  dsa.js         Queue, Stack, BST, search and sort algorithms
  style.css      Styles
  uploads/       Uploaded car photos
```
