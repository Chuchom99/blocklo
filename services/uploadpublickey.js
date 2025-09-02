const axios = require('axios');
const fs = require('fs');

static async uploadPublicKey() {
  try {
    const publicKey = fs.readFileSync('public_key.pem', 'utf8');
    const response = await axios.post(
      'https://graph.facebook.com/v20.0/settings/business/whatsapp_business_encryption',
      new URLSearchParams({ public_key: publicKey }),
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    console.log('[WhatsApp] Public key uploaded:', response.data);
    return response.data;
  } catch (error) {
    console.error('[WhatsApp] Failed to upload public key:', error.response?.data || error.message);
    throw new Error('Failed to upload public key');
  }
}