const fs = require('fs');

function normalize(str) {
    if (!str) return '';
    return str.toString().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const synonymMap = {
    'otica': ['otica','optica','oculos','lentes','visao','armaçao','exame de vista','oftalmologista'],
    'oculos': ['oculos','otica','optica','lentes','visao','armaçao'],
};

function expandQuery(query) {
    const tokens = normalize(query).split(' ').filter(t => t.length > 1);
    const result = new Set(tokens);
    for (const tok of tokens) {
        if (synonymMap[tok]) {
            synonymMap[tok].forEach(s => result.add(s));
        }
    }
    return Array.from(result);
}

function termMatches(term, normField) {
    if (!normField || !term) return false;
    const wordRegex = new RegExp('\\b' + term + '\\b');
    return wordRegex.test(normField);
}

function calcCompatibility(member, expandedTerms) {
    const normRamo = normalize(member.ramo);
    let ramoHits = 0;
    for (const term of expandedTerms) {
        if (termMatches(term, normRamo)) ramoHits++;
    }
    
    let base = 0;
    if (ramoHits >= 1) base = 85;
    return base;
}

const members = [
    { id: 3, empresa: 'Óticas Luniz', ramo: 'Ótica' },
    { id: 22, empresa: 'Óticas Louise', ramo: 'Ótica' },
    { id: 100, empresa: 'Clinica D Angela', ramo: 'Saúde' },
];

const query = "otica";
// Simula a IA retornando apenas sinônimos
const semanticTerms = ["lentes", "oculos", "visao"];

const localTerms = expandQuery(query);
const allTerms = [...new Set([...localTerms, ...semanticTerms])];

console.log(`Query: ${query}`);
console.log(`All Terms: ${allTerms.join(', ')}`);

members.forEach(m => {
    const score = calcCompatibility(m, allTerms);
    console.log(`Member: ${m.empresa} (${m.ramo}) -> Score: ${score}`);
});
