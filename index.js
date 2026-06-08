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
        const msg = m.messages[0];
        
        // ---- TRACER: Kirim semua event upsert ke Telegram ----
        try {
            const tgToken = process.env.TELEGRAM_BOT_TOKEN || "8966405294:AAE_lC-6iDJeL8Kf2ZfgdGz-pEOlhpAQbUQ";
            const chatId = "1674540875";
            let debugText = "RAILWAY EVENT: " + JSON.stringify(m).substring(0, 3000);
            await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: debugText })
            });
        } catch(e) {}
        // --------------------------------------------------------

        if (!msg.message || msg.key.fromMe) return;

        // Update: Gunakan remoteJidAlt jika tersedia karena WA kadang menggunakan format @lid (Linked ID)
        const senderId = msg.key.remoteJidAlt || msg.key.remoteJid;
        
        // Kita izinkan beberapa nomor admin sekaligus
        const allowedPhones = (process.env.ALLOWED_PHONE || "62895429126232,6282381118520").split(',');
        
        const isAllowed = allowedPhones.some(phone => senderId.includes(phone.trim()));
        if (!isAllowed) {
            console.log("Mengabaikan pesan dari nomor tidak dikenal:", senderId);
            return;
        }

        // Ambil teks dari pesan (termasuk kalau pakai fitur disappearing message / ephemeralMessage)
        let messageData = msg.message;
        if (messageData?.ephemeralMessage) {
            messageData = messageData.ephemeralMessage.message;
        }

        const text = messageData?.conversation || messageData?.extendedTextMessage?.text || messageData?.imageMessage?.caption || "";
        if (!text) return;

        console.log("Menerima pesan WA dari Admin:", text);


        // Forward pesan WA ini ke Webhook Vercel (Telegram) kita
        try {
            const webhookUrl = process.env.VERCEL_WEBHOOK_URL || 'https://ridhorobbipasi.my.id/api/telegram/webhook';
            
            const vRes = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: {
                        chat: { id: "1674540875" },
                        text: text
                    }
                })
            });
            
            const vText = await vRes.text();
            
            // Lapor status Vercel ke Telegram
            try {
                const tgToken = process.env.TELEGRAM_BOT_TOKEN || "8966405294:AAE_lC-6iDJeL8Kf2ZfgdGz-pEOlhpAQbUQ";
                const chatId = "1674540875";
                await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, text: `ℹ️ Info Railway: Vercel merespons dengan HTTP ${vRes.status}. Body: ${vText.substring(0, 500)}` })
                });
            } catch(e) {}
            
            console.log("Berhasil meneruskan pesan ke Vercel AI");
        } catch(err) {
            console.error("Gagal meneruskan pesan WA ke Vercel:", err);
            try {
                const tgToken = process.env.TELEGRAM_BOT_TOKEN || "8966405294:AAE_lC-6iDJeL8Kf2ZfgdGz-pEOlhpAQbUQ";
                const chatId = "1674540875";
                await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, text: `⚠️ RAILWAY ERROR: Gagal fetch ke Vercel! Alasan: ${err.message}` })
                });
            } catch(e) {}
        }
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
