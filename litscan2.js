const { initParser, loadLanguage } = require('./dist/loader.js');
const fs = require('fs');
const path = require('path');
(async () => {
  const Parser = await initParser();
  const lang = await loadLanguage({ wasm: 'tree-sitter-javascript.wasm' });
  const parser = new Parser(); parser.setLanguage(lang);
  const root = 'D:/node/swagger-ui/src/core';
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(e.name)) files.push(p); } };
  walk(root);
  // unk_log events: file recorded as relative path with backslashes, chunk key = relfile::hash
  const byRel = new Map(); // relfile -> chunkName -> [events]
  for (const line of fs.readFileSync('unk_log.txt', 'utf8').split('\n')) {
    const parts = line.replace(/\r/g, '').split('\t');
    if (parts[0] !== 'UNK' && parts[0] !== 'DYN') continue;
    const rel = parts[1];
    let m = byRel.get(rel); if (!m) { m = new Map(); byRel.set(rel, m); }
    const name = parts[3];
    let a = m.get(name); if (!a) { a = []; m.set(name, a); }
    a.push(parts);
  }
  const chunkNameOf = (n) => {
    let p = n.parent;
    let ownerClass = null;
    while (p) {
      if (p.type === 'class_declaration') {
        const c = p.childForFieldName('name');
        ownerClass = c ? c.text : null;
      }
      if (p.type === 'function_declaration' || p.type === 'method_definition' || p.type === 'generator_function_declaration') {
        const c = p.childForFieldName('name');
        const nm = c ? c.text : '<anonymous>';
        return nm; // log stores unqualified rc.name
      }
      if (p.type === 'variable_declarator') {
        const val = p.childForFieldName('value');
        if (val && /function/.test(val.type)) {
          const c = p.childForFieldName('name');
          return c ? c.text : null;
        }
      }
      p = p.parent;
    }
    return '<module>';
  };
  const hits = [];
  for (const f of files) {
    const rel = f.replace(/\\/g, '/').replace(/^.*swagger-ui\/src\/core\//, '').replace(/\//g, '\\');
    const evsByName = byRel.get(rel);
    if (!evsByName) continue;
    const tree = parser.parse(fs.readFileSync(f, 'utf8'));
    const visit = (n) => {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function');
        if (fn && fn.type === 'member_expression') {
          const obj = fn.childForFieldName('object') ?? fn.children[0];
          if (obj && ['string', 'array', 'object', 'true', 'false', 'number', 'regex'].includes(obj.type)) {
            const chunkName = chunkNameOf(n);
            const evs = evsByName.get(chunkName);
            if (evs) hits.push({ rel, chunkName, evs, call: n.text.replace(/\s+/g, ' ').slice(0, 80) });
          }
        }
      }
      for (const c of n.children) visit(c);
    };
    visit(tree.rootNode);
  }
  console.log('literal-receiver calls inside ? source chunks:', hits.length);
  const byChunk = new Map();
  for (const h of hits) {
    const key = h.rel + '::' + h.chunkName;
    let s = byChunk.get(key); if (!s) { s = { evs: h.evs, lit: [] }; byChunk.set(key, s); }
    s.lit.push(h.call);
  }
  console.log('distinct ? sources with literal-receiver calls:', byChunk.size);
  let flippable = 0;
  for (const [key, s] of byChunk) {
    const other = s.evs.filter((e) => e[4] !== '<unresolved>');
    const unresolved = s.evs.filter((e) => e[4] === '<unresolved>');
    const ok = other.length === 0 && unresolved.length === s.lit.length && unresolved.length > 0;
    console.log((ok ? 'FLIP ' : 'keep ') + key + '\tother=' + other.length + ' unres=' + unresolved.length + ' lit=' + s.lit.length + '\t' + s.lit[0]);
    if (ok) flippable++;
  }
  console.log('FLIPPABLE ? sources:', flippable);
})();
