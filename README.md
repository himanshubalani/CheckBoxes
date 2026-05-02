# 1 Million Checkboxes - Web Dev Cohort 2026

A highly scalable, real-time web application where users can interact with a massive grid of 1 Million checkboxes synchronously. Inspired by the "1 Million Checkboxes" concept.

** Live Demo:** To be Added
** Video Demo:** To be Added

## Tech Stack
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla, optimized with DocumentFragments)
- **Backend:** Node.js, Express.js
- **Real-Time:** Socket.io (WebSockets)
- **Database/Cache:** Redis (Using advanced Bitfields for compact storage)
- **Authentication:** OIDC via Auth0 (express-openid-connect)

## Core Features
1. **Real-time Synchronization:** Socket.io ensures immediate UI updates across all clients.
2. **Highly Compact State (Scale):** Checkbox states are stored in Redis using `SETBIT`. 10,00,000 booleans take up less than 150 Kilobytes of memory!
3. **Custom Rate Limiting:** Implemented completely manually via Redis counters and expiries (`INCR`, `EXPIRE`) to prevent spamming. Limits apply uniquely to users/IPs.
4. **OIDC Authentication:** Users can log in to claim their identities, but anonymous users can interact too.
5. **Global clicks tracker.**

## Run Locally

### Prerequisites
- Node.js (v18+)
- pnpm
- Redis (Running locally or via Docker)
 ```yml
 ///docker-compose.yml
services:
  valkey:
    image: valkey/valkey
    ports:
      - 6379:6379
```

### Installation
1. Clone the repository
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env` and fill in your Auth0 and Redis credentials.
4. Start a local Redis server (e.g., `docker-compose up -d`)
5. Start the application: `node index.js` or `node --watch index.js` for live updates.
6. Visit `http://localhost:8000`

## 🧠 Design Decisions & Flow
- **WebSocket Flow:** When a client clicks a box, `client:checkbox:change` is emitted. Server catches it, checks Rate Limits, updates the Redis Bitfield, increments total analytics, and broadcasts a Pub/Sub message. Other server instances (if scaled horizontally) hear this and emit `server:checkbox:change` to their connected clients.
- **Rate Limiter Logic:** Implemented using a sliding window approximation via Redis. If a socket ID triggers > 3 clicks in 2 seconds, the server halts processing and emits a funny `server:error` event, rendering a custom message on the frontend. No `express-rate-limit` package was used.