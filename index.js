const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let currentQR = '';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }) // silent to avoid noisy logs, can be changed to 'info'
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            currentQR = qr;
            console.log('Scan the QR code by visiting the /qr endpoint of your service.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            
            // reconnect if not logged out
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Logged out. Please restart the service and scan the QR code again.');
            }
        } else if (connection === 'open') {
            currentQR = '';
            console.log('WhatsApp connection opened successfully!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        // You can handle incoming messages here (e.g. Chatbot logic or forwarding to Laravel)
        // console.log(JSON.stringify(m, undefined, 2));
    });
}

// Start WhatsApp connection
connectToWhatsApp();

// API Endpoint to get QR code
app.get('/qr', async (req, res) => {
    if (!currentQR) {
        return res.status(200).send(`
            <html>
                <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5;">
                    <div style="text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h3>WhatsApp Service</h3>
                        <p>Tidak ada QR Code saat ini.</p>
                        <p>Mungkin karena sudah login, atau sedang proses loading.</p>
                    </div>
                </body>
            </html>
        `);
    }

    try {
        const QRCode = require('qrcode');
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <html>
                <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5;">
                    <div style="text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                        <h2>Scan QR Code</h2>
                        <img src="${qrImage}" alt="QR Code" style="width:300px;height:300px; margin: 1rem 0;"/>
                        <p>Buka WhatsApp > Tautkan Perangkat > Scan QR ini</p>
                    </div>
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR code');
    }
});

// API Endpoint to send a message
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ status: 'error', message: 'Phone and message are required' });
        }

        // Format phone number to JID format
        let jid = phone.replace(/\D/g, ''); // Remove non-numeric characters
        
        // Indonesian number formatting
        if (jid.startsWith('0')) {
            jid = '62' + jid.substring(1);
        }
        
        if (!jid.endsWith('@s.whatsapp.net')) {
            jid = jid + '@s.whatsapp.net';
        }

        // Check if connection is active
        if (!sock || !sock.user) {
            return res.status(503).json({ status: 'error', message: 'WhatsApp service is not connected yet.' });
        }

        // Send the message
        await sock.sendMessage(jid, { text: message });
        
        return res.status(200).json({ status: 'success', message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json({ status: 'error', message: 'Internal server error', details: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`WhatsApp Service listening on port ${PORT}`);
});
