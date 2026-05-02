import Redis from "ioredis";

function createRedisConnection() {
	return new Redis({
	host: '0.0.0.0',
	port: '6379',
	})
}

export const redis = createRedisConnection();
export const publisher = createRedisConnection();
export const subcriber = createRedisConnection();