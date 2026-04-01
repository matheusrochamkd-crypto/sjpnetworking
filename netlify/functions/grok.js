exports.handler = async function (event, context) {
    // Permitir preflight CORS (OPCIONAL se rodar o mesmo domínio, mas seguro deixar)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: 'Method Not Allowed' 
        };
    }

    // Puxa a chave oculta do painel do Netlify
    const GROK_API_KEY = process.env.GROK_API_KEY;

    if (!GROK_API_KEY) {
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'ERRO DO SERVIDOR: A chave GROK_API_KEY não foi cadastrada no painel do Netlify (Environment Variables).' }),
        };
    }

    try {
        const payload = JSON.parse(event.body);

        // Comunica de forma oculta e segura com a xAI (Grok)
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROK_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        return {
            statusCode: response.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(data)
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message })
        };
    }
};
