

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