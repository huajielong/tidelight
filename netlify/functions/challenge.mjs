import { createCloudHandler } from '../../scripts/cloud-api.mjs';

export default createCloudHandler();
export const config = {
  path: '/api/challenge',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
