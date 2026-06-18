const { makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    RichSubMessageType,
    captureUnifiedResponse,
    sendUnifiedResponse,
    encryptedStream,
    getUrlFromDirectPath,
    renderLatexToPng,
    uploadUnencryptedToWA }
    = require('../../lib/index.js');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

async function startBot() {
    const authDir = path.join(__dirname, 'auth');

    // Check if clean flag is passed to reset the session
    if (process.argv.includes('--clean')) {
        console.log('Cleaning old auth session directory...');
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('Old session cleared successfully.');
        } else {
            console.log('No existing session directory found to clean.');
        }
    }

    console.log('Initializing connection...');

    // Setup authentication state
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Check if phone number is passed as an argument for pairing code instead of QR
    const usePairingCode = process.argv.includes('--phone');
    const phoneIndex = process.argv.indexOf('--phone');
    const phoneNumber = usePairingCode && phoneIndex !== -1 ? process.argv[phoneIndex + 1] : null;

    const sock = makeWASocket({
        auth: state,
        syncFullHistory: true,
        logger: require('pino')({ level: 'silent' }),
        markOnlineOnConnect: true
    });

    const uploadToWA = async (buffer, type) => {
        // Encrypt the raw buffer using the library's built-in helper
        const encryptionResult = await encryptedStream(buffer, 'image');
        const fileEncSha256B64 = encryptionResult.fileEncSha256.toString('base64');

        // Upload the encrypted file to WhatsApp servers
        const uploadResult = await sock.waUploadToServer(encryptionResult.encFilePath, {
            mediaType: 'image',
            fileEncSha256B64
        });

        // Clean up the temp encrypted file
        try {
            await fs.promises.unlink(encryptionResult.encFilePath);
        } catch (err) {
            console.error('Failed to delete temp encrypted file:', err);
        }

        return {
            url: uploadResult.mediaUrl || getUrlFromDirectPath(uploadResult.directPath),
            directPath: uploadResult.directPath
        };
    };


    // Handle pairing code registration if requested
    if (usePairingCode && phoneNumber && !state.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
                console.log('\n======================================');
                console.log(`PAIRING CODE: ${code}`);
                console.log('======================================\n');
            } catch (err) {
                console.error('Failed to request pairing code:', err);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    // Register MEX Notification Dispatcher Event Listeners
    sock.ev.on('messaging-history.status', ({ syncType, status, explicit }) => {
        console.log(`[messaging-history.status] History sync status: ${status} (${syncType}) explicit=${explicit}`);
    });

    sock.ev.on('message-capping.update', ({ used_quota, total_quota }) => {
        console.log(`[message-capping.update] Message quota used: ${used_quota}/${total_quota}`);
    });

    sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
        console.log(`[lid-mapping.update] LID: ${lid} mapped to PN: ${pn}`);
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr, reachoutTimeLock } = update;

        if (reachoutTimeLock?.isActive) {
            console.log(`[Reachout TimeLock] Restricted until: ${reachoutTimeLock.timeEnforcementEnds}`);
        }

        if (qr && !usePairingCode) {
            console.log('Scan the QR code below to connect:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to:', lastDisconnect?.error, '. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            } else {
                console.log('Logged out. Please delete the "auth" directory and scan again.');
            }
        } else if (connection === 'open') {
            console.log('\n======================================');
            console.log('WhatsApp Bot is successfully connected!');
            console.log('======================================\n');
        }
    });

    // Listen to messages
    sock.ev.on('messages.upsert', async (update) => {
        console.log(`[messages.upsert] Event received. Type: ${update.type}, Messages count: ${update.messages?.length || 0}`);
        try {
            if (!update.messages?.length) return;

            for (const message of update.messages) {
                const isFromMe = message.key?.fromMe;
                const remoteJid = message.key?.remoteJid;
                const messageKeys = Object.keys(message.message || {});
                console.log(` -> Msg: fromMe=${isFromMe}, JID=${remoteJid}, Keys=[${messageKeys.join(', ')}]`);
            }

            if (update.type !== 'notify') return;
            const [message] = update.messages;
            if (!message || message.key?.fromMe) return;

            // 🚫 Ignore all protocol messages (history sync, security notifications, app state sync, deleted messages, etc.)
            if (message.message?.protocolMessage) return;

            const msgContent = message.message || {};
            const jid = message.key.remoteJid;
            if (!jid) return;

            // Helper to normalize JIDs (e.g., removing device sub-IDs)
            const normalizeJid = (id) => {
                if (!id) return '';
                if (id.includes(':')) {
                    const [user, host] = id.split('@');
                    const [userId] = user.split(':');
                    return `${userId}@${host}`;
                }
                return id;
            };

            const normalizedJid = normalizeJid(jid);

            const getText = () =>
                msgContent.conversation ||
                msgContent.extendedTextMessage?.text ||
                msgContent.imageMessage?.caption ||
                msgContent.videoMessage?.caption ||
                '';

            const getButtonText = () => {
                if (msgContent.listResponseMessage)
                    return msgContent.listResponseMessage.title || msgContent.listResponseMessage.description || '';
                if (msgContent.templateButtonReplyMessage)
                    return msgContent.templateButtonReplyMessage.selectedDisplayText || msgContent.templateButtonReplyMessage.selectedId || '';
                if (msgContent.buttonsResponseMessage)
                    return msgContent.buttonsResponseMessage.selectedDisplayText || msgContent.buttonsResponseMessage.selectedButtonId || '';
                if (msgContent.interactiveResponseMessage) {
                    const i = msgContent.interactiveResponseMessage;
                    return i.listResponse?.title ||
                        i.listResponse?.description ||
                        i.nativeFlowResponse?.response?.reply ||
                        i.reply ||
                        i.buttonReplyMessage?.displayText || '';
                }
                return '';
            };

            const text = (getText() || getButtonText() || '').trim();
            if (!text.startsWith('!')) return;

            const command = text.split(' ')[0].toLowerCase();
            const args = text.slice(command.length).trim();

            console.log(`[Command Received] ${command} from ${normalizedJid}`);

            switch (command) {
                case '!ping': {
                    await sock.sendMessage(normalizedJid, { text: 'pong! 🏓' }, { quoted: message });
                    break;
                }
                case '!table': {
                    await sock.sendTable(normalizedJid, 'Developer Team Metrics', ['Name', 'Role', 'Status', 'Tasks Completed'], [
                        ['Member 1', 'Frontend Lead', 'Active', '45'],
                        ['Member 2', 'Rust WASM Dev', 'Coding', '89'],
                        ['Member 3', 'QA Engineer', 'Testing', '23'],
                        ['Member 4', 'Product Owner', 'Meeting', '12']
                    ], message, {
                        headerText: 'Here is the current team status table:',
                        footer: 'Generated automatically by Innovators Baileys V2 Bot.'
                    });
                    break;
                }
                case '!list': {
                    await sock.sendList(normalizedJid, 'Interactive Help Menu', [
                        '!ping         - Simple ping test',
                        '!table        - Show a sample rich table',
                        '!list         - Show this help list',
                        '!markdown     - Show a rich markdown response',
                        '!code         - Show a code snippet in JS or Python',
                        '!lateximage   - Send a single LaTeX image',
                        '!latexinlineimage - Send LaTeX inline images (album)',
                        '!rich         - Show a mixed content message',
                        '!buttons      - Send interactive buttons',
                        '!template     - Send a template button message',
                        '!interact     - Send interactive quick replies',
                        '!sections     - Send traditional section list',
                        '!share        - Share phone number',
                        '!request      - Request phone number',
                        '!ai           - Send a message with Meta AI icon',
                        '!capture      - Capture a message text to buffer',
                        '!sendcaptured - Send all captured buffered messages'
                    ], message, {
                        headerText: 'Available commands:',
                        footer: 'Type any of these commands to test.'
                    });
                    break;
                }
                case '!code': {
                    const defaultCode = `// Fetch profile details\nconst user = await sock.findUserByUsername('user');\nif (user) {\n    console.log(\`JID: \${user.jid}\`);\n}`;
                    const pythonCode = `# Quick Python Example\ndef greet(name):\n    print(f"Hello, {name}!")\n\ngreet("User")`;

                    const language = args.toLowerCase() === 'python' ? 'python' : 'javascript';
                    const codeToSend = language === 'python' ? pythonCode : defaultCode;

                    await sock.sendCodeBlock(normalizedJid, codeToSend, message, {
                        language,
                        title: `Sample Code (${language})`,
                        footer: 'Syntax highlighted by WhatsApp Meta AI engine.'
                    });
                    break;
                }
                case '!markdown': {
                    const mdText = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n\n___\n\n> To use a horizontal line, you need to have two "\\n" above and below the "___"\n==Highlighted text==\n# By the way, ^you^ can _mix_ ==multiple markdowns== for a **richer response**\n###### Try different combinations... ';
                    await sock.sendMarkdown(normalizedJid, mdText, message);
                    break;
                }
                case '!lateximage': {
                    try {
                        const result = await sock.sendLatexImage(
                            normalizedJid,
                            message,
                            {
                                formula: 'E=mc^2',
                                caption: 'Mass-Energy Equivalence (DPI 600)'
                            }
                        );
                        //console.log('LaTeX Image Payload:', JSON.stringify(result, null, 2));
                    } catch (error) {
                        console.error('Error in !lateximage:', error);
                    }
                    break;
                }

                case '!latexinlineimage': {
                    try {
                        const result = await sock.sendLatexInlineImage(
                            normalizedJid,
                            message,
                            {
                                expressions: [
                                    { latexExpression: 'e^{i\\pi} + 1 = 0' },
                                    { latexExpression: '\\int_a^b x^2 \\, dx = \\frac{b^3 - a^3}{3}' },
                                    { latexExpression: 'f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!} (x-a)^n' }
                                ],
                                caption: true // Use each LaTeX expression as the caption for its respective image in the album
                            }
                        );
                        //console.log('LaTeX Inline Image Payload:', JSON.stringify(result, null, 2));
                    } catch (error) {
                        console.error('Error in !latexinlineimage:', error);
                    }
                    break;
                }
                case '!rich': {
                    const richLatexExpr = 'E = mc^2';
                    const richPngBuf = await renderLatexToPng(richLatexExpr);
                    const richImageUrl = (await uploadUnencryptedToWA(richPngBuf.buffer, sock.waUploadToServer)).url;

                    await sock.sendRichMessage(normalizedJid, [
                        {
                            messageType: RichSubMessageType.TEXT,
                            messageText: '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n\n___\n\n> To use a horizontal line, you need to have two "\\n" above and below the "___"\n==Highlighted text==\n# By the way, ^you^ can _mix_ ==multiple markdowns== for a **richer response**\n###### Try different combinations...'
                        },
                        {
                            messageType: RichSubMessageType.TABLE,
                            tableMetadata: {
                                title: 'Product Prices',
                                rows: [
                                    { items: ['Product', 'Price', 'Stock'], isHeading: true },
                                    { items: ['Innovators Baileys Pro', '$49.99', 'In Stock'] },
                                    { items: ['Rust WASM Plugin', '$19.99', 'Low Stock'] }
                                ]
                            }
                        },
                        {
                            messageType: RichSubMessageType.TEXT,
                            messageText: 'LaTeX Formula:'
                        },
                        {
                            messageType: RichSubMessageType.INLINE_IMAGE,
                            imageMetadata: {
                                imageUrl: {
                                    imagePreviewUrl: richImageUrl,
                                    imageHighResUrl: richImageUrl
                                },
                                imageText: richLatexExpr,
                                alignment: 2
                            }
                        },
                        {
                            messageType: RichSubMessageType.CODE,
                            codeMetadata: {
                                codeLanguage: 'javascript',
                                codeBlocks: [
                                    { highlightType: 1, codeContent: 'const ' },
                                    { highlightType: 0, codeContent: 'price = ' },
                                    { highlightType: 4, codeContent: '49.99' },
                                    { highlightType: 0, codeContent: ';\n' },
                                    { highlightType: 1, codeContent: 'if ' },
                                    { highlightType: 0, codeContent: '(price > ' },
                                    { highlightType: 4, codeContent: '20' },
                                    { highlightType: 0, codeContent: ') {\n    console.log(' },
                                    { highlightType: 3, codeContent: '"Premium tier"' },
                                    { highlightType: 0, codeContent: ');\n}' }
                                ]
                            }
                        }
                    ], message, { useMarkdown: true });
                    break;
                }
                case '!buttons': {
                    await sock.sendMessage(normalizedJid, {
                        buttons: [
                            { buttonId: 'btn1', buttonText: { displayText: 'Option 1' }, type: 1 },
                            { buttonId: 'btn2', buttonText: { displayText: 'Option 2' }, type: 1 }
                        ],
                        text: 'Pick an option:',
                        footer: 'Powered by Innovators Baileys'
                    }, { quoted: message });
                    break;
                }
                case '!template': {
                    await sock.sendMessage(normalizedJid, {
                        templateButtons: [
                            { index: 1, urlButton: { displayText: 'Visit Link', url: 'https://example.com' } },
                            { index: 2, callButton: { displayText: 'Call Support', phoneNumber: '+91XXXXXXXXXX' } },
                            { index: 3, quickReplyButton: { displayText: 'Quick Reply', id: 'id1' } }
                        ],
                        text: 'Template message body example:',
                        footer: 'Powered by Innovators Baileys'
                    }, { quoted: message });
                    break;
                }
                case '!interact': {
                    await sock.sendMessage(normalizedJid, {
                        interactiveButtons: [
                            { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Yes', id: 'yes' }) },
                            { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'No', id: 'no' }) }
                        ],
                        body: { text: 'Are you sure you want to proceed?' },
                        footer: { text: 'Innovators Baileys interactive' }
                    }, { quoted: message });
                    break;
                }
                case '!sections': {
                    await sock.sendMessage(normalizedJid, {
                        sections: [
                            {
                                title: 'Section 1',
                                rows: [
                                    { title: 'Row 1', rowId: 'r1', description: 'Description for row 1' },
                                    { title: 'Row 2', rowId: 'r2', description: 'Description for row 2' }
                                ]
                            }
                        ],
                        title: 'Interactive Sections List',
                        text: 'List body text here',
                        footer: 'Innovators Baileys footer',
                        buttonText: 'Open List Options'
                    }, { quoted: message });
                    break;
                }
                case '!share': {
                    await sock.sendMessage(normalizedJid, { sharePhoneNumber: true }, { quoted: message });
                    break;
                }
                case '!request': {
                    await sock.sendMessage(normalizedJid, { requestPhoneNumber: true }, { quoted: message });
                    break;
                }
                case '!ai': {
                    await sock.sendMessage(normalizedJid, { text: 'Hello! I am replying with the Meta AI bot icon attached.' }, { ai: true, quoted: message });
                    break;
                }
                case '!capture': {
                    if (!args) {
                        await sock.sendMessage(normalizedJid, { text: 'Please specify the message text to capture. Usage: !capture <text>' }, { quoted: message });
                        break;
                    }
                    captureUnifiedResponse(normalizedJid, { text: args }, { quoted: message });
                    await sock.sendMessage(normalizedJid, { text: `Successfully captured message: "${args}". Type !sendcaptured to broadcast all captured responses.` }, { quoted: message });
                    break;
                }
                case '!sendcaptured': {
                    await sock.sendMessage(normalizedJid, { text: 'Sending all captured responses...' }, { quoted: message });
                    await sendUnifiedResponse(sock.sendMessage.bind(sock));
                    break;
                }
            }
        } catch (err) {
            console.error(`Error processing message:`, err);
        }
    });
}

startBot().catch(err => {
    console.error('Fatal error starting the bot:', err);
});
