import { randomBytes } from 'node:crypto';

// Print once; store the value as a secret and distribute it securely.
console.log(`sports_${randomBytes(32).toString('base64url')}`);
