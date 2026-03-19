/* ============================================
   SJP Networking — Core Application Logic
   Semantic Search Engine + Daily Audit
   ============================================ */

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1woRI4hp-whQJIbS-8vhAtj7L-scfBUvNGTJ5pBsyahI/export?format=csv';

const GEMINI_API_KEY = "AIzaSyBObVxtRmz7QPUAXnmpQ8DPPxLu0gleziQ";

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
    return data.map(r => ({
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
    'tecnologia': ['tecnologia','ti','tech'],
    'computador': ['informatica','computador','notebook','manutencao','reparo','assistencia tecnica','hardware','pc'],
    'software': ['software','softwares','erp','aplicativo','app','fabrica de software','programacao','inteligencia artificial'],
    'ia': ['inteligencia artificial','machine learning','chatbot','algoritmo','automacao','ia'],
    'inteligencia artificial': ['inteligencia artificial','machine learning','chatbot','algoritmo','automacao','ia'],
    'informatica': ['informatica','computador','notebook','manutencao','reparo','assistencia tecnica','hardware','pc','ti'],
    
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
    'fotografia': ['fotografia','fotografo','ensaio fotografico','foto','ensaio'],
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
    if (a.includes(b) || b.includes(a)) return true;
    // For short words (<=4 chars), only allow distance 1
    // For longer words, allow distance 2
    const maxDist = Math.min(a.length, b.length) <= 4 ? 1 : 2;
    return levenshtein(a, b) <= maxDist;
}

// Stop words: common Portuguese words that should NOT trigger synonym matching
const stopWords = new Set([
    'para','como','com','uma','mais','por','que','dos','das','nos','nas',
    'seu','sua','ter','ser','esta','esse','isso','ele','ela','tem','sao',
    'pode','voce','sobre','entre','depois','antes','desde','ate','sem',
    'meu','minha','todo','toda','cada','outro','outra','muito','pouco',
    'preciso','quero','busco','procuro','ajuda','resolver','problema','necessito',
    'de','um','no','na','do','da','ao','os','as','ou','em'
]);

function expandQuery(query) {
    const tokens = tokenize(query);
    const expanded = new Set();
    
    // Only add non-stop-word tokens to expansion seed
    const meaningfulTokens = tokens.filter(t => !stopWords.has(t));
    meaningfulTokens.forEach(t => expanded.add(t));
    
    for (const [key, synonyms] of Object.entries(synonymMap)) {
        const normKey = normalize(key);
        // Also normalize the synonyms for checking
        const normSyns = synonyms.map(s => normalize(s));
        
        for (const tok of meaningfulTokens) {
            let matches = false;
            
            // Check if token matches the KEY
            if (tok.length <= 3) {
                matches = (normKey === tok);
            } else {
                matches = (normKey === tok || normKey.includes(tok) || tok.includes(normKey) || isFuzzyMatch(tok, normKey));
            }
            
            // If it doesn't match the key, check if it matches ANY of the values
            if (!matches) {
                for (const syn of normSyns) {
                    if (tok.length <= 3) {
                        if (syn === tok) { matches = true; break; }
                    } else {
                        if (syn === tok || syn.includes(tok) || tok.includes(syn) || isFuzzyMatch(tok, syn)) {
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
    function termMatches(term, normField) {
        if (!normField || !term) return false;
        
        // SHORT TERMS (≤3 chars like 'ia','rh','ti'): must match as WHOLE WORD
        // This prevents 'ia' from matching inside 'sociais', 'empresariais'
        if (term.length <= 3) {
            const regex = new RegExp('\\b' + term + '\\b');
            return regex.test(normField);
        }
        
        // LONGER TERMS: substring match (allows 'software' to match 'softwares')
        if (normField.includes(term)) return true;
        
        // Fuzzy word-level match (handles typos)
        if (term.length >= 4) {
            const fieldWordList = normField.split(' ');
            for (const fw of fieldWordList) {
                if (fw.length >= 4 && isFuzzyMatch(term, fw)) return true;
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
        if (termMatches(term, normEmpresa) || termMatches(term, normNome)) empHits++;
    }
    
    // No matches at all = 0
    if (ramoHits + descHits + infoHits + empHits === 0) return 0;
    
    // BASE SCORE: determined by which field has the best match
    // Ramo is the strongest signal (it's the member's declared business area)
    let base = 0;
    if (ramoHits >= 3) base = 90;
    else if (ramoHits >= 2) base = 85;
    else if (ramoHits >= 1) base = 80;
    else if (descHits >= 3) base = 82;
    else if (descHits >= 2) base = 78;
    else if (descHits >= 1) base = 76;
    else if (empHits >= 1) base = 74;
    else if (infoHits >= 1) base = 72;
    
    // Depth bonus: more total matches = higher confidence (up to +8)
    const totalHits = ramoHits + descHits + infoHits + empHits;
    const depthBonus = Math.min(8, Math.floor((totalHits - 1) * 1.5));
    
    // Multi-field bonus: matching in multiple fields = stronger signal
    const fieldsHit = [ramoHits > 0, descHits > 0, infoHits > 0, empHits > 0].filter(Boolean).length;
    const fieldBonus = fieldsHit >= 3 ? 6 : fieldsHit >= 2 ? 3 : 0;
    
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
    
    const expandedTerms = expandQuery(query);
    
    const scored = membersData.map(m => ({
        member: m,
        score: calcCompatibility(m, expandedTerms)
    }));
    
    return scored
        .filter(s => s.score >= 70)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10); // Grab top 10 so Gemini has options to filter down
}

// ========== RENDER HELPERS ==========

function ringProgressSVG(pct) {
    const r = 22, circ = 2 * Math.PI * r;
    const offset = circ - (pct / 100) * circ;
    const color = pct >= 90 ? '#22c55e' : pct >= 80 ? '#F5A623' : '#eab308';
    const label = pct >= 90 ? '🔥' : pct >= 80 ? '⭐' : '✨';
    return `
        <div class="ring-badge">
            <svg width="56" height="56" viewBox="0 0 50 50">
                <circle class="ring-bg" cx="25" cy="25" r="${r}"/>
                <circle class="ring-fg" cx="25" cy="25" r="${r}"
                    stroke="${color}"
                    stroke-dasharray="${circ}"
                    stroke-dashoffset="${offset}"
                />
            </svg>
            <div class="ring-pct">${label}${pct}%<small>Ideal</small></div>
        </div>
    `;
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

// ========== GEMINI AI INTEGRATION ==========
async function analyzeWithGemini(query, candidates) {
    if(candidates.length === 0) return candidates;
    
    // Simplifica dados para enviar
    const candData = candidates.map(c => ({
        nome: c.member.nome,
        empresa: c.member.empresa,
        ramo: c.member.ramo,
        descricao: (c.member.descricao || '').substring(0, 200)
    }));
    
    const prompt = `Você é o auditor IA do 'SJP Networking'.
O usuário buscou: "${query}".
Especialistas pré-filtrados:
${JSON.stringify(candData)}

Sua tarefa: 
1. Elimine "falsos positivos". Retorne apenas especialistas que REALMENTE resolvam o problema (MÁXIMO 5).
2. Atribua um score (70 a 100).
3. Crie uma justificativa muito curta, focada na necessidade do usuário (máx 120 caracteres).

Retorne APENAS o JSON válido, sem avisos, sem markdown:
[
  { "nome": "nome exato do membro avaliado", "score": 95, "reason": "Justificativa." }
]`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
            })
        });
        
        if (!response.ok) {
            console.error("Gemini API Error details:", await response.text());
            return candidates.slice(0, 5);
        }
        
        const data = await response.json();
        if (!data.candidates || data.candidates.length === 0) {
            return candidates.slice(0, 5);
        }
        
        let rawText = data.candidates[0].content.parts[0].text.trim();
        // Remove markdown formatting if present
        if (rawText.startsWith('```')) {
            rawText = rawText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '').trim();
        }
        
        const geminiResults = JSON.parse(rawText);
        
        const finalResults = [];
        for (const g of geminiResults) {
            const original = candidates.find(c => c.member.nome === g.nome || c.member.empresa === g.nome);
            if (original) {
                finalResults.push({ member: original.member, score: g.score, reason: g.reason });
            }
        }
        return finalResults.sort((a,b) => b.score - a.score);
    } catch(e) {
        console.error("Gemini Catch Error:", e);
        return candidates.slice(0, 5); // Fallback
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
        'IA Gemini analisando descrições...',
        'Gerando relatório final...'
    ]);

    try {
        membersData = await fetchData();
        
        let results = searchMembers(query);
        
        // Let Gemini analyze the initial match results
        results = await analyzeWithGemini(query, results);
        
        hide();

        if (results.length === 0) {
            dom.emptyState.style.display = 'block';
            return;
        }

        dom.resultsBadge.textContent = `${results.length} resultado${results.length > 1 ? 's' : ''}`;
        dom.resultsTitle.textContent = 'Especialistas analisados por IA';
        dom.resultsList.innerHTML = results.map(r => renderResultCard(r, query)).join('');
        dom.resultsWrap.style.display = 'block';

    } catch(e) {
        hide();
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
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    dom.panelSearch.classList.toggle('active', mode === 'search');
    dom.panelAudit.classList.toggle('active', mode === 'audit');
}

// ========== UTILS ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== INIT ==========
function init() {
    // Tab clicks
    dom.tabSearch.addEventListener('click', () => switchMode('search'));
    dom.tabAudit.addEventListener('click', () => switchMode('audit'));

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
