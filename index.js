import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { auth } from 'express-openid-connect';
import dotenv from 'dotenv';
import { publisher, subscriber, redis } from './redis-connection.js';
import { time } from 'node:console';

dotenv.config();
 
const checkBoxSize = 1000000;
const checkBoxStateKey = 'checkbox-state';
const analyticsKey = 'checkbox-analytics:total_clicks';
 
// Rate limit: 4 clicks per 3 seconds
const MAX_CLICKS = 3;
const TIME_WINDOW = 2000; // 2  seconds

const rateLimitMessages =[
    { msg: "yo! chill out fam, wait 2 sec to continue", time: 2000 },
    { msg: "Deep Breathe in, check, deep breathe out, check, wait 2 secs to continue", time: 2000 },
    { msg: "Inhale, check, exhale, check, wait 2 secs to continue", time: 2000 },
    { msg: "There are other people who want to check this box, wait 2 secs to continue", time: 2000 },
    { msg: "By the time you read this message, you'll be able to click boxes again.", time: 2000 },
    { msg: "Error: Impatient human clicker here. Penalty for 2 seconds applied.", time: 2000 },
    { msg: "One for one, two for two, wait three seconds to continue your spree.", time: 3000 },
    { msg: "One small step for a man, Two big seconds to continue.", time: 2000 },
	{ msg: "bro really thought spamming would work, wait 2 sec", time: 2000},
	{msg: "Clicking faster won’t unlock premium features, wait 2 seconds", time: 2000},
	{msg: "Buffering....", time: 2000},
	{msg: "Great checkboxes take time. like 2 seconds.", time: 2000},
	{msg: "In cooldown, wait 2 seconds to continue clicking", time: 2000},
	{msg: "RateLimitException: chill_required (2s)", time:2000}

];

async function main() {
    const PORT = process.env.PORT || 8000;
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server); // Fixed io initialization
 
    // --- OIDC CONFIGURATION (Auth0) ---
    // Will only activate if you provide a secret in your .env file
    if (process.env.SECRET) {
        app.use(auth({
            authRequired: false, // Set to true if you want to force login
            auth0Logout: true,
            secret: process.env.SECRET,
            baseURL: process.env.BASE_URL || `http://localhost:${PORT}`,
            clientID: process.env.CLIENT_ID,
            issuerBaseURL: process.env.ISSUER_BASE_URL
        }));
    }
 
    await subscriber.subscribe('internal-server:checkbox:change');
    await subscriber.subscribe('internal-server:analytics:update');
 
    subscriber.on('message', (channel, message) => {
        if (channel === 'internal-server:checkbox:change') {
            const { index, checked } = JSON.parse(message);
            io.emit('server:checkbox:change', { index, checked });
        }
        if (channel === 'internal-server:analytics:update') {
            const { totalClicks } = JSON.parse(message);
            io.emit('server:analytics:update', { totalClicks });
        }
    });
 
    // --- SOCKET.IO HANDLERS ---
    io.on('connection', async (socket) => {

        console.log(`Socket connected: `, {id: socket.id});
        
        let yourClicks = 0;

        // Send current analytics on connect
        const currentClicks = await redis.get(analyticsKey) || 0;
        socket.emit('server:analytics:update', { totalClicks: currentClicks });
        socket.emit('server:your-clicks:update', { yourClicks });
 
        socket.on('client:checkbox:change', async (data) => {
            const now = Date.now();
            const rateLimitKey = `ratelimit:clicks:${socket.id}`;
            
            // 1. Rate Limiting Check - Sliding Window (4 clicks per 3 seconds)
            // Get all click timestamps from the last 3 seconds
            await redis.zremrangebyscore(rateLimitKey, 0, now - TIME_WINDOW);
            
            // Count clicks in the current window
            const clickCount = await redis.zcard(rateLimitKey);
            
            if (clickCount >= MAX_CLICKS) {
                const rndMsg = rateLimitMessages[Math.floor(Math.random() * rateLimitMessages.length)];
                socket.emit('server:error', { 
                    data: { error: rndMsg.msg }, 
                    revert: { index: data.index, checked: !data.checked } 
                });
                return;
            }
            
            // Add current click timestamp to sorted set
            await redis.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
            // Set expiry on the key to auto-cleanup
            await redis.expire(rateLimitKey, Math.ceil(TIME_WINDOW / 1000));
 
            // 2. Update Checkbox State
            const existingState = await redis.get(checkBoxStateKey);
            let remoteData = existingState ? JSON.parse(existingState) : new Array(checkBoxSize).fill(false);
            
            remoteData[data.index] = data.checked;
            await redis.set(checkBoxStateKey, JSON.stringify(remoteData));
            
const newTotal = await redis.incr(analyticsKey);
            yourClicks++;
 
            // 4. Publish to other instances
            publisher.publish('internal-server:checkbox:change', JSON.stringify(data));
            publisher.publish('internal-server:analytics:update', JSON.stringify({ totalClicks: newTotal }));

            // 5. Emit your clicks (only to this specific socket)
            socket.emit('server:your-clicks:update', { yourClicks });
        });
    });
    
    // --- EXPRESS HANDLERS ---
    app.use(express.static(path.resolve('./public')));
    
    app.get('/health', (req, res) => res.json({ healthy: true }));
 
    app.get('/api/user', (req, res) => {
        if (req.oidc && req.oidc.user) {
            res.json({ loggedIn: true, user: req.oidc.user });
        } else {
            res.json({ loggedIn: false });
        }
    });
 
    app.get('/checkboxes', async (req, res) => {
        const existingState = await redis.get(checkBoxStateKey);
        if (existingState) {
            return res.json({ checkboxes: JSON.parse(existingState) });
        }
        return res.json({ checkboxes: new Array(checkBoxSize).fill(false) });
    });

    // Add a signup route
    app.get('/signup', (req, res) =>
      res.oidc.login({
        returnTo: '/',
        authorizationParams: { screen_hint: 'signup' },
      })
    );

    // Update the root route to show login/logout links
    app.get('/', (req, res) => {
      if (!req.oidc.isAuthenticated()) {
        return res.type('html').send(`
          <a href="/signup">Signup</a><br>
          <a href="/login">Log in</a>
        `);
      }

      res.type('html').send(`
        <p>Logged in as ${req.oidc.user.name}</p>
        <h1>User Profile</h1>
        <pre>${JSON.stringify(req.oidc.user, null, 2)}</pre>
        <a href="/logout">Log out</a>
      `);
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}
 
main();