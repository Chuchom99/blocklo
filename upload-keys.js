require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const querystring = require('querystring');

class WhatsAppKeyUploader {
  constructor() {
    this.wabaId = '1896313210962141'; // Hardcoded from your logs (add to .env if dynamic)
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    this.apiVersion = 'v20.0'; // Matches your request
    this.endpoint = `https://graph.facebook.com/${this.apiVersion}/${this.wabaId}/whatsapp_business_encryption`;

    if (!this.accessToken) {
      throw new Error('Missing WHATSAPP_ACCESS_TOKEN in .env');
    }
  }

  async validateWaba() {
    try {
      const response = await axios.get(
        `https://graph.facebook.com/${this.apiVersion}/${this.wabaId}`,
        { headers: { Authorization: `Bearer ${this.accessToken}` }, params: { fields: 'name' } }
      );
      console.log('✅ WABA valid! Name:', response.data.name);
    } catch (err) {
      throw new Error(`WABA validation failed: ${err.response?.data?.error?.message}`);
    }
    console.log('📍 Endpoint:', this.endpoint);
  }

  async readAndEncodePublicKey(keyPath = './business_public_key.pem') {
    const publicKey = fs.readFileSync(keyPath, 'utf8').trim(); // Trim whitespace
    console.log('✅ Public key loaded (length:', publicKey.length, ')');
    console.log('Preview:', publicKey.substring(0, 100) + '...');

    // Validate format
    if (!publicKey.includes('-----BEGIN PUBLIC KEY-----') || !publicKey.includes('-----END PUBLIC KEY-----')) {
      throw new Error('Invalid PEM: Missing BEGIN/END headers');
    }

    // URL-encode (critical for newlines)
    const encoded = querystring.escape(publicKey);
    console.log('✅ Encoded (first 100 chars):', encoded.substring(0, 100) + '...');
    return encoded;
  }

  async uploadKey(encodedKey) {
    const body = `business_public_key=${encodedKey}`; // Correct param
    console.log('📤 Uploading...');

    try {
      const response = await axios.post(this.endpoint, body, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded', // CRITICAL: Not JSON
        },
        timeout: 10000,
      });

      console.log('✅ Upload successful!');
      console.log('Response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (err) {
      console.error('❌ Upload failed:');
      console.error('Status:', err.response?.status);
      console.error('Error:', JSON.stringify(err.response?.data, null, 2));
      if (err.response?.data?.error_data?.details === 'Business public key is invalid') {
        console.log('💡 Fix: Regenerate key (ensure 2048-bit RSA) and URL-encode properly.');
      }
      throw err;
    }
  }

  async run() {
    try {
      await this.validateWaba();
      const encodedKey = await this.readAndEncodePublicKey();
      await this.uploadKey(encodedKey);
      console.log('\n🎉 Done! Test your Flow in Meta Builder.');
    } catch (err) {
      console.error('Script failed:', err.message);
      process.exit(1);
    }
  }
}

new WhatsAppKeyUploader().run();