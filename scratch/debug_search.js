
const fs = require('fs');

// Copying EXACT logic from app.js (v11)

function normalize(str) {
    if (!str) return '';
    return str.toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function tokenize(str) {
    const norm = normalize(str);
    const words = norm.split(' ').filter(w => w.length > 1);
    const bigrams = [];
    for (let i = 0; i < words.length - 1; i++) {
        bigrams.push(words[i] + ' ' + words[i+1]);
    }
    return [...words, ...bigrams];
}

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
                    matrix[i-1][j-1] + 1,
                    matrix[i][j-1] + 1,
                    matrix[i-1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function isFuzzyMatch(a, b) {
    if (a === b) return true;
    if (a.includes(b) && (a.length - b.length) <= 2) return true;
    if (b.includes(a) && (b.length - a.length) <= 2) return true;
    if (Math.min(a.length, b.length) <= 4) {
        return levenshtein(a, b) <= 1;
    }
    if (Math.min(a.length, b.length) >= 6) {
        return levenshtein(a, b) <= 2;
    }
    return levenshtein(a, b) <= 1;
}

const synonymMap = {
    'carro': ['automotivo','automovel','auto pecas','veicular','polimento','lavagem'],
    // ... reduced map for testing ...
};

const stopWords = new Set(['para','como','com','de','um']); // reduced

function expandQuery(query) {
    const tokens = tokenize(query);
    const expanded = new Set();
    const meaningfulTokens = tokens.filter(t => !stopWords.has(t));
    meaningfulTokens.forEach(t => expanded.add(t));
    
    for (const [key, synonyms] of Object.entries(synonymMap)) {
        const normKey = normalize(key);
        const normSyns = synonyms.map(s => normalize(s));
        for (const tok of meaningfulTokens) {
            let matches = false;
            const isBigram = tok.includes(' ');
            if (tok.length <= 3) { matches = (normKey === tok); }
            else if (isBigram) { matches = normKey === tok; }
            else { matches = isFuzzyMatch(tok, normKey); }
            
            if (!matches) {
                for (const syn of normSyns) {
                    if (tok.length <= 3) { if (syn === tok) { matches = true; break; } }
                    else if (isBigram) { if (syn === tok) { matches = true; break; } }
                    else { if (isFuzzyMatch(tok, syn)) { matches = true; break; } }
                }
            }
            if (matches) {
                synonyms.forEach(s => expanded.add(normalize(s)));
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
    
    function termMatches(term, normField, isNameField = false) {
        if (!normField || !term) return false;
        if (term.length <= 3) {
            const regex = new RegExp('\\b' + term + '\\b');
            return regex.test(normField);
        }
        if (term.includes(' ')) { return normField.includes(term); }
        if (isNameField) {
            const wordRegex = new RegExp('\\b' + term + '\\b');
            return wordRegex.test(normField);
        }
        const wordRegex = new RegExp('\\b' + term + '\\b');
        if (wordRegex.test(normField)) return true;
        
        const fieldWordList = normField.split(' ');
        for (const fw of fieldWordList) {
            if (fw.startsWith(term) && (fw.length - term.length) <= 2) return true;
        }
        if (term.length >= 6) {
            for (const fw of fieldWordList) {
                if (fw.length >= 6 && isFuzzyMatch(term, fw)) return true;
            }
        }
        return false;
    }
    
    let ramoHits = 0, descHits = 0, infoHits = 0, empHits = 0;
    for (const term of expandedTerms) {
        if (termMatches(term, normRamo)) ramoHits++;
        if (termMatches(term, normDesc)) descHits++;
        if (termMatches(term, normInfo)) infoHits++;
        if (termMatches(term, normEmpresa, true) || termMatches(term, normNome, true)) empHits++;
    }
    
    if (ramoHits + descHits + infoHits + empHits === 0) return 0;
    
    let base = 0;
    if (ramoHits >= 3) base = 92;
    else if (ramoHits >= 2) base = 87;
    else if (ramoHits >= 1) base = 82;
    else if (empHits >= 1) base = 78;
    else if (descHits >= 2) base = 75;
    else if (descHits >= 1 || infoHits >= 1) base = 70;
    else return 0;
    
    return Math.min(100, Math.max(70, base));
}

// Mock membersData for testing
const members = [
    { nome: 'John', empresa: 'Auto Tech', ramo: 'Automotivo', descricao: 'Reparo de carros e motores' },
    { nome: 'Jane', empresa: 'Doces Sonhos', ramo: 'Alimentação', descricao: 'Bolos e docinhos' }
];

const queries = ['mecanico', 'comida', 'reparo'];

queries.forEach(q => {
    const expanded = expandQuery(q);
    console.log(`Query: ${q} -> Expanded: ${expanded.join(', ')}`);
    members.forEach(m => {
        const score = calcCompatibility(m, expanded);
        console.log(`  Member: ${m.empresa} -> Score: ${score}`);
    });
});
