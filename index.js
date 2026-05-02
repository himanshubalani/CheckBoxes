import http from 'node:http'
import path from 'node:path'

import express from 'express'
import { Server } from 'socket.io';

import { publisher, subcriber, redis} from './redis-connection.js';
import { json } from 'node:stream/consumers';

const checkBoxSize = 100;
const checkBoxStateKey = 'checkbox-state:v2';

const rateLimitHashMap = new Map();

async function main() {
	const PORT = process.env.PORT ?? 8000;

	const app = express();
	const server = http.createServer(app);
	const io = new Server();
	io.attach(server);

	await subcriber.subscribe('internal-server:checkbox:change')
	subcriber.on('message', (channel, message) => {
		if (channel === 'internal-server:checkbox:change') {
			const { index, checked} = JSON.parse(message)			
			io.emit('server:checkbox:change', {index, checked});
		}
	});
	//SOCKET IO
	io.on('connection', (socket) => {
		console.log(`Socket connected: `, {id: socket.id});

		socket.on('client:checkbox:change', async (data) => {  // Add 'async' here
			console.log(`[Socket: ${socket.id}]`, data);

			const lastOperationTime = await redis.get(`ratelimiting: ${socket.id}`);
			if (lastOperationTime){
				const timeElapsed = Date.now() - lastOperationTime;
				if (timeElapsed < 1.5 * 1000) {
					socket.emit('server:error', { data: {error: `Please wait`}});
					return ;
				}

			} 
			await redis.set(`ratelimiting: ${socket.id}`, Date.now());

			const existingState = await redis.get(checkBoxStateKey);

			if (existingState) {
				const remoteData = JSON.parse(existingState)
				remoteData[data.index] = data.checked;
				await redis.set(checkBoxStateKey, JSON.stringify(remoteData))
			} else {
				await redis.set(checkBoxStateKey, JSON.stringify(new Array(checkBoxSize).fill(false)))
			}
			
			publisher.publish('internal-server:checkbox:change', JSON.stringify(data));
		});
	});
	
	//EXPRESS HANDLERS
	app.use(express.static(path.resolve('./public')));
	app.get('/health' , (req, res) => res.json({healthy: true}));

	app.get('/checkboxes', async (req, res) => {
		const existingState = await redis.get(checkBoxStateKey);
		if (existingState) {
				const remoteData = JSON.parse(existingState);
				return res.json({ checkboxes: remoteData});
		}
		return res.json({ checkboxes: []});
	});

	server.listen(PORT, '0.0.0.0', () => {
		console.log(`Server is running on http://localhost:${PORT}`);

	});
}

main();