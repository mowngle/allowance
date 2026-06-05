// One-shot VAPID keypair generator. Run with: node scripts/generate-vapid.js
// Then paste the values into .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
import webpush from 'web-push';
const k = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
console.log('VAPID_SUBJECT=mailto:mowngle@gmail.com');
