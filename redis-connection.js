import Redis from "ioredis";
import 'dotenv/config';

function createRedisConnection() {
	return new Redis({
        host: process.env.REDIS_URL,
        port: process.env.PORT || '6379',
	});
}

export const redis = createRedisConnection();
export const publisher = createRedisConnection();
export const subscriber = createRedisConnection(); 