const fs = require('fs');

function normalize(str) {
    if (!str) return '';
    return str.toString().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function expandQuery(query) {
    let normalized = normalize(query);
    const stopWords = [' de ', ' da ', ' do ', ' das ', ' dos ', ' para ', ' com ', ' um ', ' uma ', ' em ', ' no ', ' na ', ' os ', ' as ', ' e ', ' ou '];
    for (const word of stopWords) {
        normalized = normalized.split(word).join(' ');
    }
    const terms = normalized.split(' ').filter(t => t.length > 2 || t === 'ia' || t === 'ti' || t === 'rh');
    const result = new Set(terms);
    
    // Some basic synonyms
    const synonyms = {
        'comida': ['alimentacao', 'restaurante', 'lanche', 'doce', 'bolo', 'marmita', 'cafe'],
        'roupa': ['vestuario', 'moda', 'camisa', 'calca', 'loja'],
        'carro': ['automotivo', 'mecanica', 'veiculo', 'lavacar', 'estetica automotiva'],
        'advogado': ['direito', 'juridico', 'advocacia', 'lei'],
        'medico': ['saude', 'clinica', 'terapia', 'psicologia', 'odontologia'],
        'construcao': ['engenharia', 'obra', 'reforma', 'arquitetura', 'material'],
    };
    
    for (const term of terms) {
        if (synonyms[term]) {
            synonyms[term].forEach(s => result.add(s));
        }
    }
    
    return Array.from(result);
}

function calcCompatibility(member, expandedTerms) {
    const normRamo = normalize(member.ramo);
    const normDesc = normalize(member.descricao);
    const normInfo = normalize(member.info);
    const normEmpresa = normalize(member.empresa);
    const normNome = normalize(member.nome);
    
    function isFuzzyMatch(a, b) {
        if (a === b) return true;
        let diff = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (a[i] !== b[i]) diff++;
        }
        diff += Math.abs(a.length - b.length);
        return diff <= 2;
    }
    
    function termMatches(term, normField, isNameField = false) {
        if (!normField || !term) return false;
        
        if (term.length <= 3) {
            const regex = new RegExp('\\b' + term + '\\b');
            return regex.test(normField);
        }
        
        if (term.includes(' ')) {
            return normField.includes(term);
        }
        
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
    else if (empHits >= 1 && (ramoHits >= 1 || descHits >= 2)) base = 78; 
    else {
        return 0; // The bug!
    }
    
    const totalHits = ramoHits + descHits + infoHits + empHits;
    const depthBonus = Math.min(6, Math.floor((totalHits - 1) * 1.2));
    const fieldsHit = [ramoHits > 0, descHits > 0, infoHits > 0, empHits > 0].filter(Boolean).length;
    const fieldBonus = fieldsHit >= 3 ? 4 : fieldsHit >= 2 ? 2 : 0;
    const descPenalty = (!member.descricao || member.descricao.length < 10) ? -2 : 0;
    
    return Math.min(100, Math.max(70, base + depthBonus + fieldBonus + descPenalty));
}

function parseCSV(text) {
    const lines = text.split('\n');
    const result = [];
    const headers = lines[0].split(',');
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        // Very basic CSV parser for test
        let inQuotes = false;
        let currentField = '';
        const fields = [];
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
                fields.push(currentField);
                currentField = '';
            } else {
                currentField += char;
            }
        }
        fields.push(currentField);
        
        if (fields.length >= 7) {
            result.push({
                id: i,
                nome: fields[1] || '',
                empresa: fields[2] || '',
                ramo: fields[3] || '',
                descricao: fields[4] || '',
                whatsapp: fields[5] || '',
                instagram: fields[6] || '',
                info: fields[7] || ''
            });
        }
    }
    return result;
}

const csvData = fs.readFileSync('sheet_data.csv', 'utf8');
const membersData = parseCSV(csvData);

function test(query) {
    const expandedTerms = expandQuery(query);
    console.log(`\n--- Testando Busca: "${query}" ---`);
    console.log(`Termos expandidos: ${expandedTerms.join(', ')}`);
    
    const scored = membersData.map(m => ({
        member: m,
        score: calcCompatibility(m, expandedTerms)
    })).filter(s => s.score > 0);
    
    scored.sort((a,b) => b.score - a.score);
    
    console.log(`Encontrados pelo pre-filtro (score > 0): ${scored.length}`);
    scored.slice(0, 5).forEach(s => {
        console.log(`- [${s.score}] ${s.member.empresa} (${s.member.ramo})`);
    });
}

test('limpar nome');
test('brownie');
test('cilios');
