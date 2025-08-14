import express from 'express';
import fs from 'fs';
import path from 'path';
import * as url from 'url';
import dotenv from 'dotenv'
dotenv.config({ path: '.env' })

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const USERS_DIR = path.join(__dirname, 'users');
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' })); // recebemos vetores, não imagens

const LIMIAR = 0.55; // ajuste depois com seus dados

const slugify = (s) =>
  (s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'user';

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function meanVector(vectors) {
  const n = vectors.length;
  const len = vectors[0].length;
  const out = new Float32Array(len);
  for (const v of vectors) for (let i = 0; i < len; i++) out[i] += v[i];
  for (let i = 0; i < len; i++) out[i] /= n;
  return Array.from(out);
}

// Páginas
app.get('/', (_, res) => res.redirect('/enroll'));
app.get('/enroll', (_, res) => res.sendFile(path.join(__dirname, 'public', 'enroll.html')));
app.get('/detect', (_, res) => res.sendFile(path.join(__dirname, 'public', 'detect.html')));

// API: cadastro via JSON com embeddings (nada de upload de imagem)
app.post('/api/enroll', (req, res) => {
  try {
    const { name, descriptors } = req.body;
    if (!name || !Array.isArray(descriptors) || descriptors.length === 0) {
      return res.status(400).json({ error: 'Envie name e descriptors (vetores).' });
    }
    const slug = slugify(name);
    const userDir = path.join(USERS_DIR, slug);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

    // salva todos os vetores e um profile com a média
    fs.writeFileSync(path.join(userDir, 'embeddings.json'), JSON.stringify({ name, descriptors }));
    const avg = meanVector(descriptors);
    fs.writeFileSync(path.join(userDir, 'profile.json'), JSON.stringify({ name, slug, descriptor: avg }, null, 2));

    res.json({ ok: true, name, slug, count: descriptors.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha no cadastro' });
  }
});

// API: matching — recebe 1 descriptor e retorna melhor nome
app.post('/api/match', (req, res) => {
  try {
    const { descriptor } = req.body;
    if (!descriptor || !Array.isArray(descriptor)) {
      return res.status(400).json({ error: 'Envie descriptor (vetor).' });
    }

    const users = fs.readdirSync(USERS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    let best = { name: null, slug: null, score: -1 };

    for (const u of users) {
      const profilePath = path.join(USERS_DIR, u, 'profile.json');
      if (!fs.existsSync(profilePath)) continue;
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      const score = cosineSim(descriptor, profile.descriptor);
      if (score > best.score) best = { name: profile.name, slug: profile.slug, score };
    }

    if (best.score >= LIMIAR) {
      return res.json({ match: true, name: best.name, score: Number(best.score.toFixed(3)) });
    } else {
      return res.json({ match: false, score: Number(best.score.toFixed(3)) });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha no match' });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}/enroll`);
  console.log(`http://localhost:${PORT}/detect`);
});
