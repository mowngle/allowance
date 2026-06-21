// One-shot secret generator for a new install's .env.
// Run:  node scripts/gen-secrets.js   (or: npm run gen-secrets)
// Then paste the four lines into your .env.
//
// Generates a VAPID keypair (for parent-phone web push) and a random
// SESSION_SECRET (signs session cookies). Each household needs its own.
import webpush from 'web-push';
import { randomBytes } from 'node:crypto';

const k = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
console.log('VAPID_SUBJECT=mailto:admin@localhost');
console.log('SESSION_SECRET=' + randomBytes(32).toString('base64url'));
