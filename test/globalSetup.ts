import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createServer } from 'node:net';
import type { TestProject } from 'vitest/node';

const getAvailablePort = async () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to get available port')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

export default async function setup(project: TestProject) {
  const port = await getAvailablePort();
  const replset = await MongoMemoryReplSet.create({
    instanceOpts: [{ port, ip: '127.0.0.1' }],
    replSet: { count: 1 }
  });
  const uri = replset.getUri();
  project.provide('MONGODB_URI', uri);

  return async () => {
    await replset.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    MONGODB_URI: string;
  }
}
