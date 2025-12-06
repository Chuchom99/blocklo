
// import crypto from 'crypto';
// // generate-signature.js


// // -------------------------------------------------
// // 1.  <-- EDIT THESE VALUES ONLY -->
// const BVN          = '22222222222';                     // test BVN
// const API_KEY      = 'BLOCKLO_TEST_FSILIT6GhDXlxwxyOR4T';             // from .env
// const SECRET_KEY   = 'oKityqjw296PPHpkP0JwytHYFKq1xkh3kRwDzGmM';         // from .env
// // -------------------------------------------------

// // 2. Build payload that is **signed** (timestamp is required for the HMAC)
// const timestamp   = new Date().toISOString();
// const signPayload = { bvn: BVN, timestamp };

// // 3. Sort keys alphabetically (9PSB requirement)
// const sorted = Object.keys(signPayload)
//   .sort()
//   .reduce((obj, k) => ({ ...obj, [k]: signPayload[k] }), {});

// // 4. Stringify → HMAC-SHA256
// const data      = JSON.stringify(sorted);
// const signature = crypto
//   .createHmac('sha256', SECRET_KEY)
//   .update(data)
//   .digest('hex');

// console.log('=== 9PSB BVN SIGNATURE ===');
// console.log('Timestamp   :', timestamp);
// console.log('Signed JSON :', data);
// console.log('X-Signature :', signature);
// console.log('\n--- cURL test (copy-paste) ---');
// console.log(`curl -X POST https://api.9psb.com.ng/vas/kyc/verify-bvn \\
//   -H "Authorization: Bearer ${API_KEY}" \\
//   -H "X-Signature: ${signature}" \\
//   -H "Content-Type: application/json" \\
//   -d '{"bvn":"${BVN}"}'`);



// scripts/set-all-to-level1.js
// import prisma from "./config/prisma.js";

// async function main() {
//   const result = await prisma.user.updateMany({
//     data: {
//       kycLevel: 1,
//     },
//   });

//   console.log(`Updated ${result.count} users to KYC Level 1 (Tier 1)`);
// }

// main()
//   .catch(e => console.error(e))
//   .finally(() => prisma.$disconnect());


import crypto from 'crypto';
import fs from 'fs';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048, // Required for Meta
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc', // Optional encryption
    passphrase: 'your-passphrase-here' // Change this; add to .env later
  }
});

// Save files
fs.writeFileSync('business_public_key.pem', publicKey);
fs.writeFileSync('business_private_key.pem', privateKey);

console.log('✅ Keys generated!');
console.log('Public Key Preview:\n', publicKey.substring(0, 200) + '...');