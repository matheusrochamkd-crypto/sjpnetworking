const fs = require('fs');
const csv = fs.readFileSync('sheet_data.csv', 'utf8');
const membersData = csv.split('\n').slice(1).map((row, i) => {
    let fields = []; let cur = ''; let inQ = false;
    for (let j=0; j<row.length; j++) {
        if (row[j]==='\"') { inQ = !inQ; }
        else if (row[j]===',' && !inQ) { fields.push(cur); cur=''; }
        else { cur += row[j]; }
    }
    fields.push(cur);
    if (fields.length < 8) return null;
    return { id: i+1, nome: fields[2], empresa: fields[3], ramo: fields[4], descricao: fields[5], infocards: fields[7] };
}).filter(Boolean);

function normalize(str) { return (str||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

const thesaurusStr = `tecnologia: tecnologia,ti,tech,desenvolvimento,programacao,informatica,computador,notebook,assistencia
computador: informatica,computador,notebook,manutencao,reparo,assistencia tecnica,hardware,pc,celular,smart,ti
celular: celular,smartphone,iphone,apple,assistencia tecnica,capinha,pelicula,computador,notebook
informatica: informatica,computador,notebook,manutencao,reparo,assistencia tecnica,hardware,pc,ti,celular`;

const synonymMap = {};
thesaurusStr.split('\n').forEach(l => { const p = l.split(':'); if(p.length>1) synonymMap[p[0].trim()] = p[1].split(',').map(x=>x.trim()); });
const stopWords = new Set(['quero', 'comprar', 'o']);

function expandQuery(query) {
    const tokens = normalize(query).split(' ').filter(w => w.length > 1);
    const meaningful = tokens.filter(t => !stopWords.has(t));
    const expanded = new Set(meaningful);
    for (const key in synonymMap) {
        if (meaningful.some(t => t === key || synonymMap[key].includes(t))) {
            expanded.add(key);
            synonymMap[key].forEach(s => expanded.add(s));
        }
    }
    return Array.from(expanded);
}

const terms = expandQuery('QUERO COMPRAR O COMPUTADOR');
function isFuzzy(a, b) { if(a===b) return true; if(a.includes(b)&&a.length-b.length<=2) return true; if(b.includes(a)&&b.length-a.length<=2) return true; return false; }
function termMatch(t, d) { if(!d) return false; return d.split(' ').some(w => isFuzzy(t, w) || (t.length>=6 && w.length>=6 && (t.includes(w)||w.includes(t)))); }

let hits = membersData.map(m => {
    let hitsCount = 0;
    terms.forEach(t => {
        if(termMatch(t, normalize(m.ramo))) hitsCount+=3;
        if(termMatch(t, normalize(m.descricao))) hitsCount+=1;
        if(termMatch(t, normalize(m.empresa))) hitsCount+=2;
        if(termMatch(t, normalize(m.infocards))) hitsCount+=1;
    });
    return {m, hitsCount, score: hitsCount > 0 ? 70 + hitsCount : 0};
}).filter(x => x.score > 0).sort((a,b)=>b.score - a.score).slice(0, 60);

let lines = ['TERMOS: ' + terms.join(', '), 'ENCONTRADOS LOCAL: ' + hits.length];
hits.forEach(h => lines.push(h.score + ' | EM: ' + h.m.empresa + ' | RA: ' + h.m.ramo + ' | DE: ' + h.m.descricao.substring(0,60)));
fs.writeFileSync('out.txt', lines.join('\n'));
