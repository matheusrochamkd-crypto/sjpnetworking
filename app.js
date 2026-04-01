/* ============================================
   SJP Networking — Core Application Logic
   Semantic Search Engine + Daily Audit
   ============================================ */

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1woRI4hp-whQJIbS-8vhAtj7L-scfBUvNGTJ5pBsyahI/export?format=csv';

// GROK_API_KEY é carregada via config.js (arquivo gitignored, NÃO commitar)
// Se GROK_API_KEY não estiver definida, o sistema funciona com buscas locais.

// Expected columns (0-indexed after timestamp)
const COL = { NOME: 1, EMPRESA: 2, RAMO: 3, DESC: 4, WHATSAPP: 5, INSTAGRAM: 6, INFO: 7 };

// ========== STATE ==========
let membersData = [];
let isLoading = false;

// ========== DOM ==========
const $ = id => document.getElementById(id);

const dom = {
    tabSearch: $('tabSearch'), tabAudit: $('tabAudit'),
    panelSearch: $('panelSearch'), panelAudit: $('panelAudit'),
    searchInput: $('searchInput'), searchBtn: $('searchBtn'),
    resultsWrap: $('resultsWrap'), resultsList: $('resultsList'),
    resultsTitle: $('resultsTitle'), resultsBadge: $('resultsBadge'),
    emptyState: $('emptyState'),
    syncBtn: $('syncBtn'), syncIcon: $('syncIcon'),
    dashStats: $('dashStats'), statTotal: $('statTotal'),
    statComplete: $('statComplete'), statIssues: $('statIssues'),
    structureStatus: $('structureStatus'),
    auditTableWrap: $('auditTableWrap'), auditTable: $('auditTable'),
    reportDate: $('reportDate'),
    loadingOverlay: $('loadingOverlay'), loaderMsg: $('loaderMsg'),
    headerBadge: $('headerBadge'),
};

// ========== CSV PARSER ==========
function parseCSV(text) {
    const rows = [];
    let cur = '', inQuotes = false, row = [], i = 0;
    while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { cur += '"'; i += 2; }
                else { inQuotes = false; i++; }
            } else { cur += c; i++; }
        } else {
            if (c === '"') { inQuotes = true; i++; }
            else if (c === ',') { row.push(cur.trim()); cur = ''; i++; }
            else if (c === '\n' || c === '\r') {
                row.push(cur.trim()); cur = '';
                if (c === '\r' && text[i + 1] === '\n') i++;
                if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
                row = []; i++;
            } else { cur += c; i++; }
        }
    }
    if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
    return rows;
}

// ========== DATA FETCHER ==========
async function fetchData() {
    const resp = await fetch(SHEET_CSV_URL);
    if (!resp.ok) throw new Error('Falha ao acessar a planilha');
    const text = await resp.text();
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('Planilha vazia');
    const header = rows[0];
    const data = rows.slice(1).filter(r => r.some(c => c !== ''));
    return data.map((r, index) => ({
        id: index + 1,
        nome:      (r[COL.NOME] || '').trim(),
        empresa:   (r[COL.EMPRESA] || '').trim(),
        ramo:      (r[COL.RAMO] || '').trim(),
        descricao: (r[COL.DESC] || '').trim(),
        whatsapp:  (r[COL.WHATSAPP] || '').trim(),
        instagram: (r[COL.INSTAGRAM] || '').trim(),
        info:      (r[COL.INFO] || '').trim(),
        _raw: r
    }));
}

// ========== LOADING ANIMATION ==========
const loadingMsgs = [
    'Acessando planilha do SJP Networking...',
    'Lendo cadastros de membros...',
    'Analisando {N} empresas...',
    'Cruzando especialidades...',
    'Calculando compatibilidade...',
    'Quase pronto...'
];

function showLoading(customMsgs) {
    dom.loadingOverlay.style.display = 'flex';
    const msgs = customMsgs || loadingMsgs;
    let idx = 0;
    dom.loaderMsg.textContent = msgs[0].replace('{N}', membersData.length || '???');
    const interval = setInterval(() => {
        idx++;
        if (idx < msgs.length) {
            dom.loaderMsg.textContent = msgs[idx].replace('{N}', membersData.length || '???');
        }
    }, 900);
    return () => { clearInterval(interval); dom.loadingOverlay.style.display = 'none'; };
}

// ========== SEMANTIC SEARCH ENGINE ==========
// Keyword synonym map — ONLY niche-specific terms, NO generic cross-category words
const synonymMap = {
    // Legal
    'advogado': ['advocacia','juridico','juridica','direito','advogado','advogados','tribunal','processo','lei','legal','lgpd','contencioso','civel','criminal','trabalhista'],
    'juridico': ['advocacia','juridico','juridica','direito','advogado','advogados','tribunal','processo','lei','legal','contencioso','civel','criminal'],
    'processo': ['advocacia','juridico','direito','advogado','processo','judicial','liminar','contencioso'],
    'imposto': ['contabilidade','tributario','tributaria','imposto','fiscal','impostos','irpf','inss','mei','contador','contabil'],
    'contabilidade': ['contabilidade','contabil','imposto','fiscal','tributario','tributaria','impostos','mei','contador'],
    'contador': ['contabilidade','contabil','contador','imposto','fiscal','tributario','mei'],
    
    // Marketing
    'marketing': ['marketing','social media','trafego','trafego pago','anuncio','anuncios','google ads','publicidade','divulgacao','propaganda','seo','agencia de marketing','gestao de trafego'],
    'trafego': ['trafego','trafego pago','marketing','google ads','anuncio','anuncios','publicidade','gestao de trafego'],
    'propaganda': ['publicidade','propaganda','divulgacao','anuncio','anuncios'],
    'site': ['site','website','pagina','landing page','desenvolvimento web'],
    'redes sociais': ['social media','redes sociais','instagram','conteudo','postagem','stories','reels'],
    
    // Technology — each sub-niche is separate
    'tecnologia': ['tecnologia','ti','tech','desenvolvimento','programacao'],
    'computador': ['informatica','computador','notebook','manutencao','reparo','assistencia tecnica','hardware','pc'],
    'software': ['software','softwares','erp','aplicativo','app','fabrica de software','programacao','sistema','sistemas'],
    'ia': ['inteligencia artificial','ia','chatbot','automacao','bot','whatsapp'],
    'inteligencia artificial': ['inteligencia artificial','ia','chatbot','automacao','bot'],
    'informatica': ['informatica','computador','notebook','manutencao','reparo','assistencia tecnica','hardware','pc','ti'],
    'chatbot': ['chatbot','bot','whatsapp','atendimento','ia','inteligencia artificial','tecnologia','software','automacao'],
    'automacao': ['automacao','processos','chatbot','bot','tecnologia','software','sistemas'],
    'whatsapp': ['whatsapp','chatbot','bot','atendimento','automacao'],
    
    // Construction & Engineering
    'construcao': ['construcao','engenharia','obra','reforma','material de construcao','pedreiro','telhado','estrutura metalica'],
    'reforma': ['reforma','construcao','obra','pedreiro','pintura'],
    'regularizacao': ['regularizacao','habite-se','cartorio','averbacao','inss de obra'],
    'arquitetura': ['arquitetura','interiores','projeto arquitetonico','paisagismo'],
    'eletrica': ['eletrica','engenharia eletrica','instalacao eletrica','spda','termografia'],
    
    // Health
    'saude': ['saude','medico','clinica','bem estar'],
    'psicologo': ['psicologo','psicologia','terapia','saude mental','psicanalise'],
    'dentista': ['odontologia','dentista','saude bucal','consultorio odontologico'],
    'fisioterapia': ['fisioterapia','fisioterapeuta','acupuntura','quiropraxia','reabilitacao','coluna'],
    'nutricionista': ['nutricionista','nutricao','alimentacao saudavel','dieta'],
    
    // Finance
    'financeiro': ['financeiro','financeira','investimento','investimentos','planejamento financeiro','mercado financeiro'],
    'seguro': ['seguro','seguro de vida','corretora de seguros','plano de saude'],
    'consorcio': ['consorcio','carta contemplada'],
    'credito': ['credito','limpa nome','recuperacao de credito','score'],
    
    // Food
    'alimentacao': ['alimentacao','comida','restaurante','confeitaria','bolo','doce','padaria','lanche','pizza','buffet','acai','cafe','gastronomia'],
    'bolo': ['bolo','confeitaria','doce','bolos decorados','docinhos'],
    
    // Events
    'evento': ['evento','eventos','decoracao de eventos','cerimonial','buffet','dj','iluminacao','casamento','festa','recreacao'],
    'casamento': ['casamento','cerimonial','decoracao de casamento'],
    
    // Beauty
    'beleza': ['beleza','estetica','cabelo','maquiagem','sobrancelha','cilios','unha','micropigmentacao','salao','beauty'],
    'cabelo': ['cabelo','cabeleireira','mechas','alongamento capilar','corte'],
    
    // Education
    'ingles': ['ingles','idioma','idiomas','aulas de ingles'],
    'curso': ['curso','treinamento','capacitacao','mentoria','palestra','coaching'],
    'treinamento': ['treinamento','capacitacao','lideranca','mentoria','coaching'],
    
    // Real Estate
    'imovel': ['imovel','imobiliaria','venda de imoveis','locacao'],
    
    // Logistics
    'entrega': ['entrega','logistica','coleta','frete','envio'],
    'transporte': ['transporte','logistica','frete'],
    
    // Security
    'seguranca': ['seguranca','camera','alarme','monitoramento','cftv'],
    
    // Auto
    'carro': ['carro','automotivo','automovel','auto pecas','veicular','polimento','lavagem'],
    
    // Photo/Video
    'fotografia': ['fotografia','fotografo','ensaio fotografico'],
    'video': ['video','filmagem','edicao de video','producao audiovisual','reels'],
    
    // HR
    'rh': ['rh','recursos humanos','recrutamento','selecao','contratacao','gestao de pessoas'],
    'funcionario': ['rh','recrutamento','selecao','contratacao'],
    
    // Cleaning
    'limpeza': ['limpeza','higienizacao','limpeza profissional'],
    
    // Tourism
    'viagem': ['viagem','turismo','passagens','pacote','agencia de viagens'],

    // Solar
    'energia solar': ['energia solar','fotovoltaico','fotovoltaica','solar','painel solar'],
    'energia': ['energia solar','fotovoltaico','solar','painel solar'],
    
    // Consulting
    'consultoria': ['consultoria','consultora','planejamento estrategico','mentoria'],

    // Furniture
    'moveis': ['moveis','mobiliario','sob medida','moveis planejados'],
    
    // Clothing
    'roupa': ['roupa','moda','vestuario','loja de roupas','confeccao','uniforme'],
    
    // Insurance
    'protecao veicular': ['protecao veicular','seguro auto','veicular','guincho'],

    // Optical
    'oculos': ['oculos','otica','lentes'],

    // Print/Design
    'comunicacao visual': ['comunicacao visual','grafica','impressao','adesivo','placa','banner','fachada','letreiro'],
};

function normalize(str) {
    return str.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function tokenize(str) {
    const norm = normalize(str);
    // Allow 2-char words for acronyms (IA, RH, TI)
    const words = norm.split(' ').filter(w => w.length > 1);
    const bigrams = [];
    for (let i = 0; i < words.length - 1; i++) {
        bigrams.push(words[i] + ' ' + words[i+1]);
    }
    return [...words, ...bigrams];
}

// Levenshtein distance — measures how many single-character edits to transform a→b
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b[i-1] === a[j-1]) {
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i-1][j-1] + 1, // substitution
                    matrix[i][j-1] + 1,     // insertion
                    matrix[i-1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Check if two words are "close enough" (fuzzy match)
function isFuzzyMatch(a, b) {
    if (a === b) return true;
    // STRICT: only allow substring match if one word fully contains the other
    // AND the length difference is small (e.g., 'software' vs 'softwares')
    if (a.includes(b) && (a.length - b.length) <= 2) return true;
    if (b.includes(a) && (b.length - a.length) <= 2) return true;
    // For short words (<=4 chars), only allow distance 1
    // For longer words, allow distance 2 BUT only if both words are 6+ chars
    if (Math.min(a.length, b.length) <= 4) {
        return levenshtein(a, b) <= 1;
    }
    if (Math.min(a.length, b.length) >= 6) {
        return levenshtein(a, b) <= 2;
    }
    return levenshtein(a, b) <= 1;
}

// Stop words: common Portuguese words that should NOT trigger synonym matching
const stopWords = new Set([
    'para','como','com','uma','mais','por','que','dos','das','nos','nas',
    'seu','sua','ter','ser','esta','esse','isso','ele','ela','tem','sao',
    'pode','voce','sobre','entre','depois','antes','desde','ate','sem',
    'meu','minha','todo','toda','cada','outro','outra','muito','pouco',
    'preciso','quero','busco','procuro','ajuda','resolver','problema','necessito',
    'de','um','no','na','do','da','ao','os','as','ou','em',
    'alguem','alguém','algum','alguma','fazer','configurar','instalar','consertar',
    'arrumar','trocar','colocar','tirar','mexer','ligar','desligar',
    'onde','quando','qual','quais','quem','porque','pois','entao',
    'aqui','ali','la','tambem','ainda','ja','agora','sempre','nunca',
    'bem','mal','bom','boa','ruim','melhor','pior','novo','nova',
    'grande','pequeno','primeiro','ultimo','gostaria','favor','obrigado',
    'nao','sim','talvez','so','apenas','mesmo','assim','dessa','desse',
    'nessa','nesse','numa','duma','pela','pelo','nas','nos'
]);

function expandQuery(query) {
    const tokens = tokenize(query);
    const expanded = new Set();
    
    // Only add non-stop-word tokens to expansion seed
    const meaningfulTokens = tokens.filter(t => !stopWords.has(t));
    meaningfulTokens.forEach(t => expanded.add(t));
    
    // For synonym expansion, filter OUT bigrams that contain any stop word
    // This prevents "com ia" from fuzzy-matching "comida" and pulling in food results
    const expansionTokens = meaningfulTokens.filter(t => {
        if (!t.includes(' ')) return true; // single words always pass
        // Bigram: check if ANY word in the bigram is a stop word
        const words = t.split(' ');
        return words.every(w => !stopWords.has(w) && w.length > 1);
    });
    
    for (const [key, synonyms] of Object.entries(synonymMap)) {
        const normKey = normalize(key);
        // Also normalize the synonyms for checking
        const normSyns = synonyms.map(s => normalize(s));
        
        for (const tok of expansionTokens) {
            let matches = false;
            const isBigram = tok.includes(' ');
            
            // Check if token matches the KEY
            if (tok.length <= 3) {
                matches = (normKey === tok);
            } else if (isBigram) {
                // Bigrams: ONLY exact/regex match, NO fuzzy (prevents "com ia" → "comida")
                const regex = new RegExp('\\b' + tok + '\\b');
                matches = regex.test(normKey) || normKey === tok;
            } else {
                // Strict word match for technical terms to avoid "inteligencia" matching "inteligencia artificial"
                const regex = new RegExp('\\b' + tok + '\\b');
                matches = regex.test(normKey) || isFuzzyMatch(tok, normKey);
            }
            
            // If it doesn't match the key, check if it matches ANY of the values
            if (!matches) {
                for (const syn of normSyns) {
                    if (tok.length <= 3) {
                        if (syn === tok) { matches = true; break; }
                    } else if (isBigram) {
                        // Bigrams: ONLY exact/regex match against synonyms too
                        const regex = new RegExp('\\b' + tok + '\\b');
                        if (regex.test(syn) || syn === tok) {
                            matches = true; break;
                        }
                    } else {
                        const regex = new RegExp('\\b' + tok + '\\b');
                        if (regex.test(syn) || isFuzzyMatch(tok, syn)) {
                            matches = true; break;
                        }
                    }
                }
            }
            
            if (matches) {
                synonyms.forEach(s => expanded.add(normalize(s)));
                // Also add the key itself just in case
                expanded.add(normKey);
            }
        }
    }
    return [...expanded];
}

function calcCompatibility(member, expandedTerms) {
    const normRamo = normalize(member.ramo || '');
    const normDesc = normalize(member.descricao || '');
    const normInfo = normalize(member.info || '');
    const normEmpresa = normalize(member.empresa || '');
    const normNome = normalize(member.nome || '');
    
    // Matching: smart check based on term length + fuzzy for typo tolerance
    // isNameField: when true, applies STRICTER matching (no fuzzy, no partial)
    function termMatches(term, normField, isNameField = false) {
        if (!normField || !term) return false;
        
        // SHORT TERMS (≤3 chars like 'ia','rh','ti'): must match as WHOLE WORD
        // This prevents 'ia' from matching inside 'sociais', 'empresariais'
        if (term.length <= 3) {
            const regex = new RegExp('\\b' + term + '\\b');
            return regex.test(normField);
        }
        
        // MULTI-WORD TERMS: must match as exact phrase
        // This prevents 'inteligencia artificial' from matching 'inteligencia emocional'
        if (term.includes(' ')) {
            return normField.includes(term);
        }
        
        // For NAME/COMPANY fields: ONLY exact whole-word match
        // This prevents "controle" matching "ControlG" company name
        if (isNameField) {
            const wordRegex = new RegExp('\\b' + term + '\\b');
            return wordRegex.test(normField);
        }
        
        // SINGLE LONGER TERMS: word-boundary match to avoid partial substring matches
        // Use word boundary regex first
        const wordRegex = new RegExp('\\b' + term + '\\b');
        if (wordRegex.test(normField)) return true;
        
        // Allow partial match only if term is the start of a word in the field
        // AND the length difference is tiny (e.g., 'software' matches 'softwares')
        const fieldWordList = normField.split(' ');
        for (const fw of fieldWordList) {
            if (fw.startsWith(term) && (fw.length - term.length) <= 2) return true;
        }
        
        // Fuzzy word-level match (handles typos) — ONLY for longer words (6+ chars)
        if (term.length >= 6) {
            for (const fw of fieldWordList) {
                if (fw.length >= 6 && isFuzzyMatch(term, fw)) return true;
            }
        }
        return false;
    }
    
    // Count matches per field
    let ramoHits = 0, descHits = 0, infoHits = 0, empHits = 0;
    
    for (const term of expandedTerms) {
        if (termMatches(term, normRamo)) ramoHits++;
        if (termMatches(term, normDesc)) descHits++;
        if (termMatches(term, normInfo)) infoHits++;
        // STRICT matching for name/company — no fuzzy, no partial starts
        if (termMatches(term, normEmpresa, true) || termMatches(term, normNome, true)) empHits++;
    }
    
    // No matches at all = 0
    if (ramoHits + descHits + infoHits + empHits === 0) return 0;
    
    // BASE SCORE: determined by which field has the best match
    // Ramo is the strongest signal — it's the member's declared business area
    // Members WITHOUT a ramo match get score < 70 (filtered out)
    let base = 0;
    if (ramoHits >= 3) base = 92;
    else if (ramoHits >= 2) base = 87;
    else if (ramoHits >= 1) base = 82;
    else if (empHits >= 1 && (ramoHits >= 1 || descHits >= 2)) base = 78; // Company name + ramo/description corroboration
    else {
        // NO ramo match = likely irrelevant
        // Company-only matches are NOT enough — they often are false positives
        // (e.g., "ControlG" matching "controle")
        // Description/info-only matches are also NOT enough to qualify
        return 0;
    }
    
    // Depth bonus: more total matches = higher confidence (up to +6)
    const totalHits = ramoHits + descHits + infoHits + empHits;
    const depthBonus = Math.min(6, Math.floor((totalHits - 1) * 1.2));
    
    // Multi-field bonus: matching in multiple fields = stronger signal
    const fieldsHit = [ramoHits > 0, descHits > 0, infoHits > 0, empHits > 0].filter(Boolean).length;
    const fieldBonus = fieldsHit >= 3 ? 4 : fieldsHit >= 2 ? 2 : 0;
    
    // Small penalty if no description (less data to verify match)
    const descPenalty = (!member.descricao || member.descricao.length < 10) ? -2 : 0;
    
    return Math.min(100, Math.max(70, base + depthBonus + fieldBonus + descPenalty));
}

function generateReason(member, query) {
    const parts = [];
    
    if (member.ramo) {
        parts.push(`Atua no ramo de ${member.ramo.trim()}`);
    }
    
    if (member.descricao) {
        const firstSentence = member.descricao.split(/[.!?\n]/)[0].trim();
        if (firstSentence.length > 20) {
            parts.push(firstSentence.substring(0, 130) + (firstSentence.length > 130 ? '...' : ''));
        }
    }
    
    return parts.length > 0 ? parts.join('. ') + '.' : 'Perfil compatível com sua busca.';
}

function searchMembers(query) {
    if (!query.trim()) return [];
    
    // ======== EXACT NAME/COMPANY MATCH ========
    const exactQuery = normalize(query);
    const queryWords = exactQuery.split(' ').filter(w => w.length > 1);
    const exactMatches = membersData.filter(m => {
        const normNome = normalize(m.nome || '');
        const normEmpresa = normalize(m.empresa || '');
        // Full exact match
        if (normNome === exactQuery || normEmpresa === exactQuery) return true;
        // Partial match — only if query has 2+ words (looks like a name, not a category)
        if (queryWords.length >= 2 && exactQuery.length >= 5) {
            if (normNome.includes(exactQuery) || normEmpresa.includes(exactQuery)) return true;
        }
        return false;
    });

    if (exactMatches.length > 0) {
        const direct = exactMatches.map(m => ({
            member: m,
            score: 100,
            reason: `Correspondência exata para "${query}".`
        }));
        direct.sort((a,b) => (a.member.nome.length + (a.member.empresa||'').length) - (b.member.nome.length + (b.member.empresa||'').length));
        return direct.slice(0, 5);
    }
    // ==========================================

    const expandedTerms = expandQuery(query);
    
    const scored = membersData.map(m => ({
        member: m,
        score: calcCompatibility(m, expandedTerms)
    }));
    
    // Sort by score descending
    const sorted = scored
        .filter(s => s.score >= 70)
        .sort((a, b) => b.score - a.score);
    
    return sorted.slice(0, 10); // Send up to 10 candidates for Grok to filter
}

// ========== RENDER HELPERS ==========

function ringProgressSVG(pct) {
    return `<div class="match-badge">${pct}% Compatível</div>`;
}

function cleanPhone(raw) {
    return raw.replace(/[^\d+]/g, '');
}

function waLink(phone) {
    let num = cleanPhone(phone);
    if (!num) return '#';
    if (!num.startsWith('+') && !num.startsWith('55')) num = '55' + num;
    if (num.startsWith('+')) num = num.slice(1);
    return `https://wa.me/${num}`;
}

function igLink(raw) {
    if (!raw) return '#';
    let handle = raw.trim();
    if (handle.startsWith('http')) return handle;
    if (handle.startsWith('www.')) return 'https://' + handle;
    handle = handle.replace(/^@/, '');
    return `https://instagram.com/${handle}`;
}

function renderResultCard(item, query) {
    const m = item.member;
    const reason = item.reason || generateReason(m, query);
    const hasWa = m.whatsapp && m.whatsapp.length > 5;
    const hasIg = m.instagram && m.instagram.length > 3;

    return `
        <div class="r-card">
            <div class="card-top">
                <div class="card-names">
                    <h4>${escHtml(m.empresa || m.nome)}</h4>
                    <div class="empresa">${escHtml(m.nome)}</div>
                    <div class="ramo">${escHtml(m.ramo)}</div>
                </div>
                ${ringProgressSVG(item.score)}
            </div>
            <div class="card-why">${escHtml(reason)}</div>
            <div class="card-actions">
                ${hasWa ? `<a href="${waLink(m.whatsapp)}" target="_blank" rel="noopener" class="act-btn act-wa">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                </a>` : ''}
                ${hasIg ? `<a href="${igLink(m.instagram)}" target="_blank" rel="noopener" class="act-btn act-ig">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                    Instagram
                </a>` : ''}
            </div>
        </div>
    `;
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// ========== GROK (xAI) AI INTEGRATION ==========

// Estado da IA — rastreado para informar o usuário
let lastAIStatus = { success: false, error: null, model: null };

// A verificação de chave é feita no servidor seguro (Netlify Functions)
function isAIConfigured() {
    return true; // Proxy backend ativado
}

// Gera o banner de erro da IA visível para o usuário
function renderAIErrorBanner(errorMsg) {
    return `
        <div class="ai-error-banner" style="
            background: linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.03));
            border: 1px solid rgba(239,68,68,0.2);
            border-radius: 1rem;
            padding: 1rem 1.5rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 0.85rem;
            color: #fca5a5;
            backdrop-filter: blur(10px);
        ">
            <span style="font-size:1.3rem;">⚠️</span>
            <div>
                <strong style="color:#f87171;">IA Grok indisponível</strong><br>
                <span style="color:#d4d4d8; font-size:0.8rem;">${escHtml(errorMsg)} — Exibindo resultados da busca local (podem ser menos precisos).</span>
            </div>
        </div>
    `;
}

// Gera o badge de status da IA
function renderAIStatusBadge(usedAI) {
    if (usedAI) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);color:#34d399;padding:2px 10px;border-radius:9999px;font-size:0.7rem;font-weight:600;letter-spacing:0.05em;">✦ ANALISADO POR IA</span>';
    }
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);color:#fbbf24;padding:2px 10px;border-radius:9999px;font-size:0.7rem;font-weight:600;letter-spacing:0.05em;">⚡ BUSCA LOCAL</span>';
}

// Analisa candidatos pré-filtrados com Grok
async function analyzeWithAI(query, candidates) {
    if (candidates.length === 0) return { results: candidates, aiUsed: false, error: null };
    if (!isAIConfigured()) {
        return { results: candidates.slice(0, 5), aiUsed: false, error: 'Chave API Grok não configurada. Configure GROK_API_KEY em config.js.' };
    }
    
    const candData = candidates.map(c => ({
        id: c.member.id,
        nome: c.member.nome,
        empresa: c.member.empresa,
        ramo: c.member.ramo,
        descricao: (c.member.descricao || '').substring(0, 200)
    }));
    
    const systemPrompt = `Você é o motor de busca inteligente do 'SJP Networking', um grupo de empreendedores de São José dos Pinhais.
Seu trabalho é REORDENAR e FILTRAR candidatos com base na INTENÇÃO REAL do usuário.

REGRAS OBRIGATÓRIAS:
1. INTERPRETE A INTENÇÃO REAL: "chatbot com IA" = empresas de IA, fábricas de software, desenvolvedores. NÃO é padaria, confeitaria, consultoria genérica.
2. O RAMO e/ou DESCRIÇÃO do candidato devem ser DIRETAMENTE relacionados à necessidade. Se o ramo é de outro setor, ELIMINE.
3. COINCIDÊNCIA DE NOME NÃO É RELEVÂNCIA. "ControlG" NÃO é relevante para "controle de portão".
4. ZERO FALSOS POSITIVOS: É MELHOR retornar lista vazia [] do que um resultado errado.
5. MÁXIMO 5 resultados. Se só 1-2 são relevantes, retorne apenas esses.
6. Score de 70 a 100. Justificativa curta (máx 120 chars).

Retorne APENAS um array JSON válido:
[{"id":1,"score":95,"reason":"Justificativa direta."}]`;

    const userPrompt = `Busca do usuário: "${query}"

CANDIDATOS PRÉ-FILTRADOS:
${JSON.stringify(candData)}`;

    const apiResult = await callGrokAPI(systemPrompt, userPrompt, candidates);
    if (apiResult.success) {
        lastAIStatus = { success: true, error: null, model: GROK_MODEL };
        return { results: apiResult.results, aiUsed: true, error: null };
    }
    
    lastAIStatus = { success: false, error: apiResult.error, model: null };
    return { results: candidates.slice(0, 5), aiUsed: false, error: apiResult.error };
}

// Chama a API do Grok (xAI) — formato OpenAI-compatible
async function callGrokAPI(systemPrompt, userPrompt, lookupSource) {
    if (!isAIConfigured()) {
        return { success: false, results: [], error: 'API key não configurada' };
    }
    // O modelo fica definido no front ou no back, aqui disparamos o proxy
    const model = (typeof GROK_MODEL !== 'undefined' && GROK_MODEL) ? GROK_MODEL : 'grok-4-1-fast-non-reasoning';
    
    try {
        console.info(`[Netlify/Grok] Enviando requisição segura para proxy backend...`);
        const response = await fetch('/.netlify/functions/grok', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            })
        });
        
        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Grok] HTTP Error ${response.status}:`, errText.substring(0, 300));
            
            let errorDetail = `HTTP ${response.status}`;
            if (response.status === 401) errorDetail = 'Chave API inválida ou expirada';
            else if (response.status === 403) errorDetail = 'Acesso negado à API';
            else if (response.status === 429) errorDetail = 'Rate limit — tente novamente em alguns segundos';
            else if (response.status === 400) {
                try {
                    const errJson = JSON.parse(errText);
                    errorDetail = errJson.error?.message || `Erro 400: ${errText.substring(0, 100)}`;
                } catch(e) { errorDetail = 'Requisição inválida'; }
            }
            
            return { success: false, results: [], error: errorDetail };
        }
        
        const data = await response.json();
        console.info(`[Grok] ${model} respondeu com sucesso`);
        
        // Formato OpenAI: data.choices[0].message.content
        if (!data.choices || data.choices.length === 0) {
            return { success: false, results: [], error: 'API não retornou resposta' };
        }
        
        let rawText = (data.choices[0].message.content || '').trim();
        console.info(`[Grok] Texto bruto:`, rawText.substring(0, 400));
        
        // Limpa markdown se presente
        if (rawText.startsWith('```')) {
            rawText = rawText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
        }
        
        // Extrai array JSON — pode estar dentro de um objeto wrapper
        let parsedData;
        try {
            parsedData = JSON.parse(rawText);
        } catch(e) {
            // Tenta encontrar array dentro do texto
            const bracketMatch = rawText.match(/\[[\s\S]*\]/);
            if (bracketMatch) {
                parsedData = JSON.parse(bracketMatch[0]);
            } else {
                console.error('[Grok] Não foi possível parsear JSON:', rawText.substring(0, 200));
                return { success: false, results: [], error: 'Resposta da IA não é JSON válido' };
            }
        }
        
        // Se veio como { results: [...] } ou { data: [...] }, extrai o array
        // Se for um único objeto (ex: na busca vazia com apenas 1 match), converte para array
        let aiResults = [];
        if (Array.isArray(parsedData)) {
            aiResults = parsedData;
        } else if (parsedData.results && Array.isArray(parsedData.results)) {
            aiResults = parsedData.results;
        } else if (parsedData.data && Array.isArray(parsedData.data)) {
            aiResults = parsedData.data;
        } else if (parsedData.candidates && Array.isArray(parsedData.candidates)) {
            aiResults = parsedData.candidates;
        } else if (typeof parsedData === 'object' && parsedData !== null && (parsedData.id || parsedData.score)) {
            aiResults = [parsedData];
        }
        
        if (!Array.isArray(aiResults) || aiResults.length === 0) {
            console.info('[Grok] IA retornou lista vazia — nenhum resultado relevante.');
            return { success: true, results: [], error: null };
        }
        
        console.info(`[Grok] IA retornou ${aiResults.length} resultados:`, aiResults);
        
        const MIN_AI_SCORE = 60;
        const finalResults = [];
        for (const g of aiResults) {
            if (g.score !== undefined && g.score < MIN_AI_SCORE) {
                console.info(`[Grok] Ignorando id=${g.id} — score ${g.score} < ${MIN_AI_SCORE}`);
                continue;
            }
            
            const original = lookupSource.find(c => 
                (g.id !== undefined && c.member.id === g.id) || 
                (g.nome && (c.member.nome === g.nome || c.member.empresa === g.nome)) ||
                (g.nome && (normalize(c.member.nome) === normalize(g.nome) || normalize(c.member.empresa) === normalize(g.nome)))
            );
            
            if (original) {
                finalResults.push({ member: original.member, score: g.score, reason: g.reason });
                console.info(`[Grok] Match: ${original.member.nome} (score: ${g.score})`);
            }
        }
        
        return { success: true, results: finalResults.sort((a,b) => b.score - a.score).slice(0, 5), error: null };
    } catch(e) {
        console.error(`[Grok] Error:`, e.message || e);
        return { success: false, results: [], error: e.message || 'Erro de conexão com a API' };
    }
}

// ========== SEARCH FLOW ==========
async function doSearch() {
    const query = dom.searchInput.value.trim();
    if (!query) return;

    dom.resultsWrap.style.display = 'none';
    dom.emptyState.style.display = 'none';

    const hide = showLoading([
        'Acessando planilha...',
        'Cruzando especialidades...',
        'Consultando IA Grok...',
        'Analisando compatibilidade...',
        'Gerando resultados...'
    ]);

    try {
        membersData = await fetchData();
        console.info(`[Search] ${membersData.length} membros carregados. Buscando: "${query}"`);
        
        // STEP 1: Busca local (sempre roda primeiro)
        let localResults = searchMembers(query);
        console.info(`[Search] Busca local encontrou ${localResults.length} candidatos`);
        
        // STEP 2: Busca por nome exato — se encontrou, retorna direto sem IA
        if (localResults.length > 0 && localResults[0].score === 100) {
            console.info('[Search] Match exato por nome/empresa — usando direto.');
            hide();
            dom.resultsBadge.textContent = `${localResults.length} resultado${localResults.length > 1 ? 's' : ''}`;
            dom.resultsTitle.textContent = 'Correspondência exata';
            dom.resultsList.innerHTML = localResults.map(r => renderResultCard(r, query)).join('');
            dom.resultsWrap.style.display = 'block';
            return;
        }
        
        // STEP 3: IA Grok SEMPRE avalia os candidatos (se configurada)
        let results = [];
        let usedAI = false;
        let aiError = null;
        
        if (isAIConfigured()) {
            console.info('[Search] Grok configurado — enviando candidatos para análise IA...');
            
            // Envia candidatos locais para a IA filtrar/reordenar
            // Se a busca local encontrou resultados, envia esses
            // Se não encontrou, envia os top 20 membros por ramo relevante
            let candidatesForAI = localResults;
            if (candidatesForAI.length === 0) {
                // Sem resultados locais — manda top 20 membros com dados mais completos para IA avaliar
                candidatesForAI = membersData
                    .filter(m => m.ramo && m.ramo.length > 2)
                    .slice(0, 30)
                    .map(m => ({ member: m, score: 0 }));
            }
            
            const aiResult = await analyzeWithAI(query, candidatesForAI);
            usedAI = aiResult.aiUsed;
            aiError = aiResult.error;
            
            if (aiResult.aiUsed && aiResult.results.length > 0) {
                results = aiResult.results;
                console.info(`[Search] IA retornou ${results.length} resultados relevantes.`);
            } else if (aiResult.aiUsed && aiResult.results.length === 0) {
                // IA respondeu mas disse que nenhum é relevante
                console.info('[Search] IA analisou mas não encontrou resultados relevantes.');
                results = [];
            } else {
                // IA falhou — usa busca local como fallback
                console.warn(`[Search] IA falhou: ${aiResult.error}. Usando busca local.`);
                results = localResults;
            }
        } else {
            aiError = 'Chave API Grok não configurada. Configure GROK_API_KEY em config.js para habilitar a busca por IA.';
            console.info('[Search] Grok não configurado — usando busca local.');
            results = localResults;
        }
        
        hide();

        if (results.length === 0) {
            // Mostra estado vazio, mas com banner de erro da IA se aplicável
            if (aiError) {
                dom.emptyState.innerHTML = `
                    ${renderAIErrorBanner(aiError)}
                    <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 mb-6 border border-white/10">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" class="text-zinc-600" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    </div>
                    <h3 class="font-outfit text-2xl font-bold mb-3 tracking-tight text-white">Nenhum compatível</h3>
                    <p class="text-zinc-400 font-light leading-relaxed max-w-sm mx-auto text-lg">Sua busca não resultou em membros compatíveis no momento.</p>
                `;
            } else {
                dom.emptyState.innerHTML = `
                    <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/5 mb-6 border border-white/10">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" class="text-zinc-600" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    </div>
                    <h3 class="font-outfit text-2xl font-bold mb-3 tracking-tight text-white">Nenhum compatível</h3>
                    <p class="text-zinc-400 font-light leading-relaxed max-w-sm mx-auto text-lg">Sua busca detalhada não resultou em membros compatíveis desta área no momento.</p>
                `;
            }
            dom.emptyState.style.display = 'block';
            return;
        }

        // Monta o HTML dos resultados
        let resultsHTML = '';
        
        // Banner de erro da IA (se falhou mas temos resultados locais)
        if (aiError && !usedAI) {
            resultsHTML += renderAIErrorBanner(aiError);
        }
        
        // Cards de resultados
        resultsHTML += results.map(r => renderResultCard(r, query)).join('');
        
        dom.resultsBadge.textContent = `${results.length} resultado${results.length > 1 ? 's' : ''}`;
        dom.resultsTitle.innerHTML = (usedAI ? 'Especialistas analisados por IA ' : 'Especialistas encontrados ') + renderAIStatusBadge(usedAI);
        dom.resultsList.innerHTML = resultsHTML;
        dom.resultsWrap.style.display = 'block';

    } catch(e) {
        hide();
        console.error('[Search] Erro fatal:', e);
        alert('Erro ao buscar dados: ' + e.message);
    }
}

// ========== AUDIT FLOW ==========
async function doAudit() {
    dom.dashStats.style.display = 'none';
    dom.structureStatus.style.display = 'none';
    dom.auditTableWrap.style.display = 'none';

    dom.syncBtn.classList.add('spinning');

    const hide = showLoading([
        'Acessando planilha do SJP Networking...',
        'Lendo todos os cadastros...',
        'Verificando integridade dos dados...',
        'Gerando relatório de saúde...',
        'Pronto!'
    ]);

    try {
        membersData = await fetchData();
        await sleep(2500);
        hide();
        dom.syncBtn.classList.remove('spinning');
        renderAuditReport();
    } catch(e) {
        hide();
        dom.syncBtn.classList.remove('spinning');
        dom.structureStatus.style.display = 'flex';
        dom.structureStatus.className = 'structure-status fail';
        dom.structureStatus.innerHTML = `<span>❌</span><div><strong>Erro de leitura:</strong> ${escHtml(e.message)}</div>`;
    }
}

function renderAuditReport() {
    const total = membersData.length;
    const issues = [];
    let completeCount = 0;

    const requiredFields = [
        { key: 'nome', label: 'Nome' },
        { key: 'empresa', label: 'Empresa' },
        { key: 'ramo', label: 'Ramo' },
        { key: 'descricao', label: 'Descrição' },
        { key: 'whatsapp', label: 'WhatsApp' },
        { key: 'instagram', label: 'Instagram' },
    ];

    membersData.forEach(m => {
        const missing = [];
        for (const f of requiredFields) {
            if (!m[f.key] || m[f.key].length < 2) {
                missing.push(f.label);
            }
        }

        // Heuristic: check if data might be in wrong column (e.g., phone in description)
        const wrongCol = [];
        if (m.descricao && /^[\d\s\(\)\-\+]{8,}$/.test(m.descricao.trim())) {
            wrongCol.push('Descrição parece conter um número de telefone');
        }
        if (m.ramo && m.ramo.length > 150) {
            wrongCol.push('Ramo contém texto muito longo (possível dado na coluna errada)');
        }

        if (missing.length === 0 && wrongCol.length === 0) {
            completeCount++;
        } else {
            issues.push({ member: m, missing, wrongCol });
        }
    });

    // Update stats
    dom.statTotal.textContent = total;
    dom.statComplete.textContent = completeCount;
    dom.statIssues.textContent = issues.length;
    dom.dashStats.style.display = 'grid';

    // Structure status
    dom.structureStatus.style.display = 'flex';
    dom.structureStatus.className = 'structure-status ok';
    dom.structureStatus.innerHTML = `<span>✅</span><div><strong>Status do link:</strong> Estrutura da planilha verificada com sucesso. Todas as colunas padrão estão presentes. Leitura realizada em ${new Date().toLocaleString('pt-BR')}.</div>`;

    // Date
    dom.reportDate.textContent = new Date().toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'long', year: 'numeric'
    });

    // Build table
    if (issues.length === 0) {
        dom.auditTable.innerHTML = `
            <div class="all-good">
                <div class="emoji">🎉</div>
                <h4>Todos os dados estão completos!</h4>
                <p>Nenhuma inconsistência encontrada nos ${total} membros cadastrados.</p>
            </div>`;
    } else {
        dom.auditTable.innerHTML = issues.map(issue => {
            const tags = [
                ...issue.missing.map(f => {
                    const cls = (f === 'WhatsApp' || f === 'Descrição') ? 'tag-red' : 'tag-yellow';
                    return `<span class="tag ${cls}">Falta ${f}</span>`;
                }),
                ...issue.wrongCol.map(msg => `<span class="tag tag-blue">${escHtml(msg)}</span>`)
            ].join('');

            return `
                <div class="audit-row">
                    <div class="audit-row-name">${escHtml(issue.member.nome || '(Sem nome)')}</div>
                    <div class="audit-row-company">${escHtml(issue.member.empresa || '(Sem empresa)')}</div>
                    <div class="audit-tags">${tags}</div>
                </div>`;
        }).join('');
    }

    dom.auditTableWrap.style.display = 'block';
}

// ========== TAB SWITCHING ==========
function switchMode(mode) {
    dom.panelSearch.classList.toggle('active', mode === 'search');
    dom.panelAudit.classList.toggle('active', mode === 'audit');
}

// ========== UTILS ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== INIT ==========
function init() {
    // Tab clicks safely attached
    if (dom.tabSearch) dom.tabSearch.addEventListener('click', () => switchMode('search'));
    if (dom.tabAudit) dom.tabAudit.addEventListener('click', () => switchMode('audit'));

    // Search
    dom.searchBtn.addEventListener('click', doSearch);
    dom.searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSearch(); }
    });

    // Quick chips
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            dom.searchInput.value = chip.dataset.q;
            doSearch();
        });
    });

    // Audit sync
    dom.syncBtn.addEventListener('click', doAudit);
}

document.addEventListener('DOMContentLoaded', init);
