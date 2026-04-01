const API_KEY = "xai-mSwIiLYFV3E2tQ8YSblSIRaVdBQmNOOw4fWCYVFTBIgxyDI0qhTHTHv5mb259pbpeTQ3f1pd1GlnySD3";
const MODEL = "grok-4-1-fast-non-reasoning";

async function test() {
    console.log(`Testing model: ${MODEL}`);
    
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: 'Retorne apenas JSON válido.' },
                { role: 'user', content: 'Retorne exatamente: [{"id":1,"score":95,"reason":"teste"}]' }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        })
    });
    
    console.log('Status:', response.status, response.statusText);
    const data = await response.json();
    
    if (response.ok) {
        console.log('✅ API FUNCIONANDO!');
        console.log('Modelo:', data.model);
        console.log('Resposta:', data.choices[0].message.content);
        console.log('Tokens:', JSON.stringify(data.usage));
    } else {
        console.log('❌ ERRO:', JSON.stringify(data, null, 2).substring(0, 500));
    }
}

test().catch(e => console.error('Fatal:', e));
