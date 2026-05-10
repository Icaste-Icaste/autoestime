if (process.env.NODE_ENV !== 'production') require('dotenv').config({ override: true });
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n  ❌  ANTHROPIC_API_KEY manquante.\n');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Config
const PLATE_PROVIDER  = process.env.PLATE_API_PROVIDER  || 'claude';
const PLATE_API_KEY   = process.env.PLATE_API_KEY   || '';
const PLATE_API_URL   = process.env.PLATE_API_URL   || '';
const RAPIDAPI_KEY    = process.env.RAPIDAPI_KEY    || '';
const APIFY_TOKEN     = process.env.APIFY_API_TOKEN || '';

app.use(express.json());
app.use(express.static('public', { etag: false, lastModified: false, setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));

// ============================================================
// Plate API adapters
// ============================================================

// Generic HTTP adapter — works with most French SIV resellers.
// The provider returns JSON, we normalize it.
// RapidAPI — api-de-plaque-d-immatriculation-france.p.rapidapi.com
// Fields are prefixed with AWN_
async function decodePlate_RapidAPI(plate) {
  const p = plate.replace(/-/g, '').toUpperCase();
  const formatted = plate.toUpperCase();

  const resp = await fetch(
    `https://api-de-plaque-d-immatriculation-france.p.rapidapi.com/?plaque=${encodeURIComponent(formatted)}`,
    {
      headers: {
        'Content-Type': 'application/json',
        'plaque': formatted,
        'x-rapidapi-host': 'api-de-plaque-d-immatriculation-france.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    }
  );

  if (!resp.ok) throw new Error(`RapidAPI HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error || json.code !== 200) throw new Error(json.message || 'Plaque non trouvée');

  const d = json.data;

  // Extract year from date (format "20-06-2019" or "2019-06-20")
  let annee = null;
  if (d.AWN_date_mise_en_circulation_us) {
    annee = parseInt(d.AWN_date_mise_en_circulation_us.split('-')[0]);
  } else if (d.AWN_date_mise_en_circulation) {
    const parts = d.AWN_date_mise_en_circulation.split('-');
    annee = parseInt(parts[2] || parts[0]);
  }

  // Energy mapping (AWN uses French names)
  const energieRaw = (d.AWN_energie_description || d.AWN_energie || '').toUpperCase();
  const energieMap = { 'GAZOLE':'DIESEL', 'ESSENCE':'ESSENCE', 'ELECTRIQUE':'ELECTRIQUE', 'HYBRIDE':'HYBRIDE', 'GPL':'GPL', 'GNV':'GNV', 'HYBRIDE RECHARGEABLE':'HYBRIDE RECHARGEABLE' };
  const energie = energieMap[energieRaw] || normalizeEnergie(energieRaw);

  // Type/carrosserie mapping
  const carrosserie = (d.AWN_carrosserie || '').toUpperCase();
  const typeMap = { 'BERLINE':'BERLINE', 'SUV':'SUV', 'BREAK':'BREAK', 'CABRIOLET':'CABRIOLET', 'MONOSPACE':'MONOSPACE', 'CITADINE':'CITADINE', 'COUPE':'BERLINE' };
  const type = typeMap[carrosserie] || normalizeType(d.AWN_style_carrosserie || carrosserie);

  // Crit'Air from code_critere_qualite_air or CO2/year/energy
  let crit_air = d.AWN_code_critere_qualite_air !== 'INCONNU' ? d.AWN_code_critere_qualite_air : null;
  if (!crit_air && annee) {
    if (energie === 'ELECTRIQUE') crit_air = '0';
    else if (energie === 'HYBRIDE RECHARGEABLE' || energie === 'HYBRIDE') crit_air = annee >= 2011 ? '1' : '2';
    else if (energie === 'DIESEL') crit_air = annee >= 2019 ? '2' : annee >= 2011 ? '3' : '4';
    else crit_air = annee >= 2011 ? '1' : '2'; // essence
  }

  // Bonus/malus from CO2 (2025 scale)
  const co2 = parseInt(d.AWN_emission_co_2) || 0;
  let bonus_malus = 0;
  if (co2 > 0 && energie !== 'ELECTRIQUE') {
    if (co2 > 218) bonus_malus = -50000;
    else if (co2 > 123) bonus_malus = -Math.round(((co2 - 123) ** 2) * 1.5);
    else if (co2 <= 20 && energie === 'ELECTRIQUE') bonus_malus = 4000;
  }

  return {
    marque:              d.AWN_marque || '',
    modele:              d.AWN_modele_prf || d.AWN_modele || d.AWN_nom_commercial || '',
    annee,
    energie,
    cylindree:           d.AWN_cylindree_liters ? `${d.AWN_cylindree_liters}L ${d.AWN_version || ''}`.trim() : (d.AWN_version || ''),
    puissance_ch:        parseInt(d.AWN_puissance_chevaux) || null,
    puissance_kw:        parseInt(d.AWN_puissance_KW) || null,
    couleur:             d.AWN_couleur ? d.AWN_couleur.charAt(0) + d.AWN_couleur.slice(1).toLowerCase() : '',
    type,
    version:             [d.AWN_finition, d.AWN_version].find(v => v && v !== 'INCONNU') || '',
    transmission:        d.AWN_type_boite_vites === 'MECANIQUE' ? 'Manuelle' : d.AWN_type_boite_vites === 'AUTOMATIQUE' ? 'Automatique' : (d.AWN_type_boite_vites || ''),
    portes:              parseInt(d.AWN_nbr_portes) || null,
    co2:                 co2 || null,
    date_mise_circulation: d.AWN_date_mise_en_circulation || '',
    numero_vin:          d.AWN_VIN || '',
    crit_air,
    bonus_malus,
    puissance_fiscale:   parseInt(d.AWN_puissance_fiscale) || null,
    nbr_places:          parseInt(d.AWN_nbr_de_places) || null,
    propulsion:          d.AWN_propulsion_label || '',
    norme_euro:          d.AWN_norme_euro !== 'INCONNU' ? d.AWN_norme_euro : null,
    modele_etude:        d.AWN_modele_etude || '',
    _source: 'rapidapi',
  };
}

async function decodePlate_HTTP(plate) {
  const normalized = plate.replace(/-/g, '').toUpperCase();
  let url, headers = {}, method = 'GET';

  switch (PLATE_PROVIDER) {
    case 'datadecision':
    case 'autobiz':
      url = `${PLATE_API_URL}/vehicule/immatriculation/${normalized}`;
      headers = { 'Authorization': `Bearer ${PLATE_API_KEY}`, 'Accept': 'application/json' };
      break;
    case 'sivplaque':
    case 'apiplaqueimmat':
    case 'infosimmat':
      url = `${PLATE_API_URL}/${normalized}?token=${PLATE_API_KEY}`;
      break;
    default:
      if (!PLATE_API_URL) throw new Error('PLATE_API_URL non configurée dans .env');
      url = `${PLATE_API_URL}/${normalized}?key=${PLATE_API_KEY}`;
  }

  const resp = await fetch(url, { method, headers });
  if (!resp.ok) throw new Error(`Plate API HTTP ${resp.status}`);
  const raw = await resp.json();
  return normalizePlateResponse(raw);
}

function normalizePlateResponse(raw) {
  // Try all common field names from various French API providers
  const get = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => o?.[p], raw);
      if (v != null) return v;
    }
    return null;
  };

  return {
    marque:              get('marque','make','brand','constructeur','Marque') || '',
    modele:              get('modele','model','Modele','designation_commerciale','libelle') || '',
    annee:               get('annee','year','annee_mise_en_circulation','date_premiere_immat') || '',
    energie:             normalizeEnergie(get('energie','carburant','fuel','energie_code','typeCarburant') || ''),
    cylindree:           get('cylindree','motorisation','engine','version_energie') || '',
    puissance_ch:        get('puissance_ch','puissance','cv','power') || null,
    puissance_kw:        get('puissance_kw','puissance_kw') || null,
    couleur:             get('couleur','color','couleur_exterieure') || '',
    type:                normalizeType(get('type','carrosserie','body_type','genre') || ''),
    version:             get('version','finition','grade','variante') || '',
    transmission:        get('transmission','boite_vitesses','gearbox') || '',
    portes:              get('portes','nb_portes','doors') || null,
    co2:                 get('co2','co2_emissions','emission_co2') || null,
    date_mise_circulation: get('date_mise_circulation','date_premiere_immat','first_registration') || '',
    numero_vin:          get('vin','numero_serie','serial_number') || '',
    crit_air:            get('crit_air','vignette_crit_air','critair') || '',
    bonus_malus:         get('bonus_malus','ecotaxe') || 0,
  };
}

function normalizeEnergie(raw) {
  const r = String(raw).toUpperCase();
  if (r.includes('ELEC')) return 'ELECTRIQUE';
  if (r.includes('HYBRIDE RECH') || r.includes('PHEV')) return 'HYBRIDE RECHARGEABLE';
  if (r.includes('HYBRIDE') || r.includes('HEV')) return 'HYBRIDE';
  if (r.includes('DIES') || r === 'GO') return 'DIESEL';
  if (r.includes('GPL') || r.includes('LPG')) return 'GPL';
  if (r.includes('GNV')) return 'GNV';
  return 'ESSENCE';
}

function normalizeType(raw) {
  const r = String(raw).toUpperCase();
  if (r.includes('SUV') || r.includes('4X4') || r.includes('TOUT TERRAIN')) return 'SUV';
  if (r.includes('BREAK')) return 'BREAK';
  if (r.includes('CABRIO') || r.includes('DECAP') || r.includes('ROADSTER')) return 'CABRIOLET';
  if (r.includes('MONO') || r.includes('MINIVAN')) return 'MONOSPACE';
  if (r.includes('PICKUP')) return 'PICKUP';
  if (r.includes('CITA') || r.includes('MINI')) return 'CITADINE';
  if (r.includes('FOURGON') || r.includes('UTILITAIRE')) return 'UTILITAIRE';
  return 'BERLINE';
}

// Claude fallback — realistic simulation when no real API is configured
async function decodePlate_Claude(plate) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Simule l'API SIV française pour la plaque "${plate.toUpperCase()}".
Réponds UNIQUEMENT avec du JSON valide (sans markdown) :
{"marque":"RENAULT","modele":"Clio","annee":2020,"energie":"ESSENCE","cylindree":"1.0 TCe 100","puissance_ch":100,"puissance_kw":74,"couleur":"Rouge Flamme","type":"CITADINE","version":"Zen","transmission":"Manuelle","portes":5,"date_mise_circulation":"12/06/2020","numero_vin":"VF1RJA00068123456","co2":112,"bonus_malus":0,"crit_air":"1"}
Varie les données selon la plaque. Marques françaises ou européennes communes.`
    }],
  });
  const raw = msg.content[0].text.trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSON invalide depuis Claude');
  return JSON.parse(m[0]);
}

// ============================================================
// LeBonCoin real prices via Apify
// ============================================================

const LBC_FUEL_MAP = {
  'ESSENCE':             '1',
  'DIESEL':              '2',
  'HYBRIDE':             '6',
  'HYBRIDE RECHARGEABLE':'3',
  'ELECTRIQUE':          '3',
  'GPL':                 '4',
};

function buildLeboncoinUrl(marque, modele, annee, energie) {
  const year = parseInt(annee) || 2020;
  const fuel = LBC_FUEL_MAP[energie?.toUpperCase()] || '';
  const text  = encodeURIComponent(`${marque} ${modele}`.trim());
  let url = `https://www.leboncoin.fr/recherche?category=2&text=${text}&regdate_min=${year - 1}&regdate_max=${year + 1}`;
  if (fuel) url += `&fuel=${fuel}`;
  return url;
}

async function startApifyRun(searchUrl) {
  const resp = await fetch(
    `https://api.apify.com/v2/acts/silentflow~leboncoin-scraper-ppr/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchUrl, maxItems: 30, browseMode: false }),
    }
  );
  if (!resp.ok) throw new Error(`Apify start HTTP ${resp.status}`);
  const data = await resp.json();
  return { runId: data.data.id, datasetId: data.data.defaultDatasetId };
}

async function getApifyRunStatus(runId) {
  const resp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
  const data = await resp.json();
  return data.data.status; // READY | RUNNING | SUCCEEDED | FAILED | TIMED-OUT
}

async function getApifyResults(datasetId) {
  const resp = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=30`
  );
  const items = await resp.json();
  return items.filter(i => i.price && i.price > 500);
}

function analyzeLbcPrices(items) {
  const prices = items.map(i => i.price).filter(Boolean).sort((a, b) => a - b);
  if (!prices.length) return null;
  const median = prices[Math.floor(prices.length / 2)];
  const mean   = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const min    = prices[0];
  const max    = prices[prices.length - 1];
  return { median, mean, min, max, count: prices.length,
    listings: items.slice(0, 8).map(i => ({
      titre: i.subject || i.title,
      prix:  i.price,
      km:    i.mileage || i.attributes?.mileage,
      ville: i.location?.city || i.city,
      url:   i.url,
      date:  i.first_publication_date || i.publicationDate,
    }))
  };
}

// ============================================================
// Vehicle pricing database (fallback / base)
// ============================================================
const vehicleDB = {
  PEUGEOT: {
    '108':     { 2019:7500,  2020:8500,  2021:9000  },
    '208':     { 2018:9500,  2019:11000, 2020:12500, 2021:14000, 2022:16000, 2023:18500 },
    '2008':    { 2019:13500, 2020:15000, 2021:17500, 2022:20000, 2023:23000 },
    '308':     { 2018:12000, 2019:14000, 2020:15500, 2021:17500, 2022:21000, 2023:25000 },
    '3008':    { 2018:17000, 2019:19500, 2020:22000, 2021:25000, 2022:29000, 2023:33000 },
    '5008':    { 2018:20000, 2019:23000, 2020:26000, 2021:29000, 2022:33000, 2023:38000 },
    '508':     { 2019:20000, 2020:23000, 2021:26000, 2022:30000, 2023:34000 },
  },
  RENAULT: {
    'TWINGO':  { 2018:6000,  2019:7000,  2020:7800,  2021:8500  },
    'CLIO':    { 2018:8000,  2019:9500,  2020:11000, 2021:13000, 2022:15000, 2023:17500 },
    'CAPTUR':  { 2018:10000, 2019:12000, 2020:14000, 2021:16500, 2022:19000, 2023:22000 },
    'MEGANE':  { 2018:11000, 2019:13000, 2020:15000, 2021:17000, 2022:20000, 2023:23000 },
    'KADJAR':  { 2018:13000, 2019:15000, 2020:17500, 2021:20000, 2022:23000 },
    'KOLEOS':  { 2018:15000, 2019:17500, 2020:20000, 2021:23000, 2022:27000 },
    'ARKANA':  { 2021:19000, 2022:22000, 2023:26000 },
    'AUSTRAL': { 2022:27000, 2023:31000 },
  },
  CITROEN: {
    'C1':      { 2018:6500,  2019:7500,  2020:8200  },
    'C3':      { 2018:8000,  2019:9500,  2020:11000, 2021:12500, 2022:14500, 2023:17000 },
    'C3 AIRCROSS': { 2018:11000, 2019:13000, 2020:15000, 2021:17000, 2022:20000 },
    'C4':      { 2020:17000, 2021:19500, 2022:22000, 2023:26000 },
    'C5 AIRCROSS': { 2018:18000, 2019:21000, 2020:24000, 2021:27000, 2022:30000, 2023:34000 },
  },
  VOLKSWAGEN: {
    'POLO':    { 2018:10000, 2019:12000, 2020:14000, 2021:16000, 2022:18500, 2023:21000 },
    'GOLF':    { 2018:14000, 2019:16500, 2020:18500, 2021:21000, 2022:24000, 2023:28000 },
    'T-CROSS': { 2019:14000, 2020:16000, 2021:18500, 2022:21000, 2023:24000 },
    'T-ROC':   { 2018:17000, 2019:19500, 2020:22000, 2021:25000, 2022:28000, 2023:32000 },
    'TIGUAN':  { 2018:20000, 2019:23000, 2020:26000, 2021:29000, 2022:33000, 2023:38000 },
    'ID.3':    { 2020:22000, 2021:25000, 2022:28000, 2023:32000 },
    'ID.4':    { 2021:32000, 2022:36000, 2023:41000 },
  },
  BMW: {
    'SERIE 1': { 2018:16000, 2019:18000, 2020:20000, 2021:23000, 2022:27000, 2023:31000 },
    'SERIE 3': { 2018:22000, 2019:26000, 2020:30000, 2021:34000, 2022:39000, 2023:45000 },
    'SERIE 5': { 2018:30000, 2019:35000, 2020:40000, 2021:46000, 2022:53000, 2023:61000 },
    'X1':      { 2018:22000, 2019:25000, 2020:28000, 2021:32000, 2022:37000, 2023:43000 },
    'X3':      { 2018:28000, 2019:32000, 2020:36000, 2021:41000, 2022:47000, 2023:55000 },
    'X5':      { 2018:42000, 2019:48000, 2020:54000, 2021:62000, 2022:70000, 2023:80000 },
  },
  MERCEDES: {
    'CLASSE A': { 2018:18000, 2019:21000, 2020:24000, 2021:28000, 2022:32000, 2023:37000 },
    'CLASSE C': { 2018:25000, 2019:29000, 2020:33000, 2021:38000, 2022:44000, 2023:52000 },
    'CLASSE E': { 2018:32000, 2019:37000, 2020:42000, 2021:49000, 2022:57000, 2023:66000 },
    'GLA':      { 2018:23000, 2019:26000, 2020:30000, 2021:35000, 2022:40000, 2023:46000 },
    'GLC':      { 2018:30000, 2019:35000, 2020:40000, 2021:47000, 2022:54000, 2023:63000 },
  },
  AUDI: {
    'A1':  { 2018:15000, 2019:18000, 2020:21000, 2021:24000, 2022:27000, 2023:31000 },
    'A3':  { 2018:18000, 2019:21000, 2020:24000, 2021:28000, 2022:33000, 2023:39000 },
    'A4':  { 2018:22000, 2019:26000, 2020:30000, 2021:35000, 2022:41000, 2023:48000 },
    'Q3':  { 2018:22000, 2019:25000, 2020:29000, 2021:33000, 2022:38000, 2023:44000 },
    'Q5':  { 2018:30000, 2019:35000, 2020:40000, 2021:46000, 2022:53000, 2023:62000 },
  },
  TOYOTA: {
    'YARIS':   { 2018:9000,  2019:10500, 2020:12000, 2021:14000, 2022:16500, 2023:19000 },
    'COROLLA': { 2019:18000, 2020:20000, 2021:22500, 2022:25500, 2023:29000 },
    'C-HR':    { 2018:17000, 2019:19500, 2020:22000, 2021:25000, 2022:28500 },
    'RAV4':    { 2018:24000, 2019:27000, 2020:30000, 2021:34000, 2022:39000, 2023:45000 },
  },
  FORD: {
    'FIESTA':  { 2018:8000,  2019:9500,  2020:11000, 2021:12500, 2022:14000 },
    'FOCUS':   { 2018:12000, 2019:14000, 2020:16000, 2021:18500, 2022:21000 },
    'PUMA':    { 2019:16000, 2020:18500, 2021:21000, 2022:24000, 2023:27000 },
    'KUGA':    { 2018:17000, 2019:20000, 2020:23000, 2021:26000, 2022:30000, 2023:34000 },
  },
  HYUNDAI: {
    'I20':     { 2018:9000,  2019:10500, 2020:12000, 2021:14000, 2022:16000, 2023:18500 },
    'I30':     { 2018:12000, 2019:14000, 2020:16000, 2021:18500, 2022:21000 },
    'TUCSON':  { 2018:18000, 2019:21000, 2020:24000, 2021:28000, 2022:33000, 2023:38000 },
    'IONIQ 5': { 2021:32000, 2022:37000, 2023:43000 },
    'KONA':    { 2018:16000, 2019:19000, 2020:22000, 2021:25000, 2022:29000, 2023:33000 },
  },
  KIA: {
    'CEED':    { 2018:12000, 2019:14000, 2020:16000, 2021:18500, 2022:21500 },
    'SPORTAGE':{ 2018:18000, 2019:21000, 2020:24000, 2021:28000, 2022:33000, 2023:38000 },
    'EV6':     { 2021:33000, 2022:38000, 2023:44000 },
    'NIRO':    { 2018:21000, 2019:24000, 2020:27000, 2021:31000, 2022:36000, 2023:41000 },
  },
  DACIA: {
    'SANDERO': { 2018:7500,  2019:8500,  2020:9500,  2021:11000, 2022:13000, 2023:15000 },
    'DUSTER':  { 2018:12000, 2019:13500, 2020:15000, 2021:17000, 2022:19500, 2023:22000 },
    'JOGGER':  { 2022:16000, 2023:19000 },
    'SPRING':  { 2021:12000, 2022:14000, 2023:16000 },
  },
  TESLA: {
    'MODEL 3': { 2018:28000, 2019:32000, 2020:36000, 2021:40000, 2022:44000, 2023:38000 },
    'MODEL Y':  { 2020:42000, 2021:46000, 2022:50000, 2023:44000 },
  },
  FIAT: {
    '500':     { 2018:9000,  2019:10000, 2020:11000, 2021:12500, 2022:14000, 2023:16000 },
    'TIPO':    { 2018:9000,  2019:10500, 2020:12000, 2021:13500, 2022:15000 },
    '500E':    { 2021:19000, 2022:22000, 2023:26000 },
  },
  OPEL: {
    'CORSA':   { 2018:8000,  2019:9500,  2020:11500, 2021:13500, 2022:16000, 2023:18500 },
    'ASTRA':   { 2018:12000, 2019:14000, 2020:16000, 2021:18500, 2022:22000, 2023:26000 },
    'MOKKA':   { 2021:18000, 2022:21000, 2023:25000 },
    'GRANDLAND': { 2018:19000, 2019:22000, 2020:25000, 2021:29000, 2022:33000 },
  },
  VOLVO: {
    'XC40':    { 2018:27000, 2019:31000, 2020:35000, 2021:40000, 2022:46000, 2023:52000 },
    'XC60':    { 2018:35000, 2019:40000, 2020:46000, 2021:53000, 2022:61000, 2023:70000 },
    'XC90':    { 2018:45000, 2019:52000, 2020:60000, 2021:69000, 2022:79000 },
  },
};

function findBasePrice(brand, model, year) {
  const b = brand?.toUpperCase();
  const m = model?.toUpperCase();
  const brandData = vehicleDB[b];
  if (!brandData) return null;

  const keys = Object.keys(brandData);
  const key = keys.find(k => m?.includes(k) || k.includes(m)) || keys.find(k => m?.split(' ').some(w => k.includes(w)));
  if (!key) return null;

  const modelData = brandData[key];
  if (modelData[year]) return { price: modelData[year], source: 'exact' };

  const years = Object.keys(modelData).map(Number).sort((a, b) => a - b);
  const nearest = years.reduce((p, c) => Math.abs(c - year) < Math.abs(p - year) ? c : p);
  const adjusted = modelData[nearest] * Math.pow(0.90, -(year - nearest));
  return { price: Math.round(adjusted), source: 'interpolated' };
}

const COND = { excellent:0.10, tres_bon:0.04, bon:0, correct:-0.06, mediocre:-0.16, accidente:-0.28 };
const NRGY = { 'ELECTRIQUE':0.14,'HYBRIDE RECHARGEABLE':0.10,'HYBRIDE':0.07,'ESSENCE':0,'DIESEL':-0.06,'GPL':-0.12 };
const TYPE_FALLBACK = { CITADINE:13000, BERLINE:20000, SUV:28000, BREAK:22000, MONOSPACE:22000, CABRIOLET:28000, PICKUP:30000, UTILITAIRE:22000 };

const BODY_DECOTES  = { rayures:-2, bosses:-4, rouille:-8, parechoc:-4, parebrise:-5, peinture:-3 };
const INTERIOR_DECOTES = { sieges:-3, odeurs:-5, tableau:-4, moquette:-2, climatisation:-3 };
const KEYS_DECOTES  = { '2cles':0, '1cle':-3, '0cle':-6 };

function calcEstimate(vehicleInfo, mileage, condition, options = [], bodyIssues = [], interiorIssues = [], nbCles = '2cles') {
  const { marque, modele, annee, energie, type } = vehicleInfo;
  const km = parseInt(mileage) || 80000;
  const year = parseInt(annee) || 2019;

  const found = findBasePrice(marque, modele, year);
  let basePrice, source;
  if (found) { basePrice = found.price; source = found.source; }
  else {
    const age = 2025 - year;
    basePrice = (TYPE_FALLBACK[type?.toUpperCase()] || 20000) * Math.pow(0.90, age);
    source = 'fallback';
  }

  const refKm = (2025 - year) * 15000;
  const kmAdj     = (km - refKm) > 0 ? -(km - refKm) * 0.04 : Math.abs(km - refKm) * 0.025;
  const condFactor = COND[condition] ?? 0;
  const nrgyFactor = NRGY[energie?.toUpperCase()] ?? 0;
  const optBonus   = Math.min(options.length * 400, 3000);

  const bodyPct     = bodyIssues.reduce((s, id) => s + (BODY_DECOTES[id] || 0), 0);
  const interiorPct = interiorIssues.reduce((s, id) => s + (INTERIOR_DECOTES[id] || 0), 0);
  const keysPct     = KEYS_DECOTES[nbCles] ?? 0;
  const decotePct   = bodyPct + interiorPct + keysPct;

  const baseAdj  = (basePrice + kmAdj) * (1 + condFactor) * (1 + nrgyFactor) + optBonus;
  const final    = Math.round(baseAdj * (1 + decotePct / 100) / 50) * 50;

  return {
    prix_estime: final,
    fourchette_min: Math.round(final * 0.91 / 50) * 50,
    fourchette_max: Math.round(final * 1.09 / 50) * 50,
    source_prix: source,
    detail_calcul: {
      prix_base: Math.round(basePrice),
      ajustement_km: Math.round(kmAdj),
      bonus_etat_pct: Math.round(condFactor * 100),
      bonus_energie_pct: Math.round(nrgyFactor * 100),
      bonus_options: optBonus,
      decote_carrosserie_pct: bodyPct,
      decote_interieur_pct: interiorPct,
      decote_cles_pct: keysPct,
      decote_total_pct: decotePct,
    },
  };
}

// ============================================================
// Routes
// ============================================================

app.post('/api/decode-plate', async (req, res) => {
  const { plate } = req.body;
  if (!plate || plate.trim().length < 2) return res.status(400).json({ error: 'Plaque invalide' });

  try {
    let data;
    if (PLATE_PROVIDER === 'rapidapi' || (RAPIDAPI_KEY && PLATE_PROVIDER === 'claude')) {
      // RapidAPI has priority if key is set
      data = await decodePlate_RapidAPI(plate);
    } else if (PLATE_PROVIDER !== 'claude' && PLATE_API_KEY) {
      data = await decodePlate_HTTP(plate);
      data._source = PLATE_PROVIDER;
    } else {
      data = await decodePlate_Claude(plate);
      data._source = 'simulation';
    }
    res.json(data);
  } catch (err) {
    console.error('[decode-plate]', err.message);
    try {
      const data = await decodePlate_Claude(plate);
      data._source = 'simulation_fallback';
      res.json(data);
    } catch (err2) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.post('/api/estimate-price', async (req, res) => {
  const { vehicleInfo, mileage, condition, options = [], bodyIssues = [], interiorIssues = [], nbCles = '2cles' } = req.body;
  if (!vehicleInfo) return res.status(400).json({ error: 'Données véhicule manquantes' });

  try {
    // 1. Estimate from DB
    const estimate = calcEstimate(vehicleInfo, mileage, condition, options, bodyIssues, interiorIssues, nbCles);

    // 2. Start Apify LBC scraping if token configured (5s timeout)
    let apifyRunId = null, apifyDatasetId = null;
    if (APIFY_TOKEN) {
      try {
        const lbcUrl = buildLeboncoinUrl(vehicleInfo.marque, vehicleInfo.modele, vehicleInfo.annee, vehicleInfo.energie);
        const apifyTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('apify timeout')), 5000));
        const run = await Promise.race([startApifyRun(lbcUrl), apifyTimeout]);
        apifyRunId = run.runId;
        apifyDatasetId = run.datasetId;
      } catch (e) {
        console.error('[apify start]', e.message);
      }
    }

    // 3. Full market analysis + platform prices via Claude Haiku
    let analyse;
    let platformPrices = null;
    try {
      const claudePromise = client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Expert cote auto France. ${vehicleInfo.marque} ${vehicleInfo.modele} ${vehicleInfo.annee} ${vehicleInfo.energie} ${mileage}km état "${condition}" prix base ${estimate.prix_estime}€.
JSON sans markdown: {"points":["<20 mots>","<20 mots>","<20 mots>"],"conseil":"<1 phrase>","tendance":"hausse"|"stable"|"baisse","demande":"forte"|"normale"|"faible","delai_vente":"ex: 2-3 semaines","cotes":{"argus_reprise":<entier>,"argus_particulier":<entier>,"leboncoin_min":<entier>,"leboncoin_median":<entier>,"leboncoin_max":<entier>,"la_centrale":<entier>,"autoscout24":<entier>}}`
        }],
      });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
      const aMsg = await Promise.race([claudePromise, timeoutPromise]);
      const m = aMsg.content[0].text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        analyse = {
          points: parsed.points,
          conseil: parsed.conseil,
          tendance: parsed.tendance,
          demande: parsed.demande,
          delai_vente: parsed.delai_vente,
        };
        platformPrices = parsed.cotes || null;
      }
    } catch (e) { console.error('[claude analyse]', e.message); }

    if (!analyse) analyse = { points: ['Prix cohérent avec le marché','Kilométrage dans la moyenne','Segment stable'], conseil: 'Publiez en début de semaine pour plus de visibilité.', tendance: 'stable', demande: 'normale', delai_vente: '3-4 semaines' };

    res.json({ ...estimate, analyse, platformPrices, apifyRunId, apifyDatasetId, lbcSearchUrl: APIFY_TOKEN ? buildLeboncoinUrl(vehicleInfo.marque, vehicleInfo.modele, vehicleInfo.annee, vehicleInfo.energie) : null });
  } catch (err) {
    console.error('[estimate-price]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Poll LeBonCoin Apify run status
app.get('/api/lbc-status/:runId', async (req, res) => {
  const { runId } = req.params;
  const { datasetId } = req.query;
  if (!APIFY_TOKEN) return res.status(400).json({ error: 'Apify non configuré' });

  try {
    const status = await getApifyRunStatus(runId);
    if (status === 'SUCCEEDED') {
      const items = await getApifyResults(datasetId);
      const stats = analyzeLbcPrices(items);
      return res.json({ status: 'done', lbc: stats });
    }
    if (status === 'FAILED' || status === 'TIMED-OUT' || status === 'ABORTED') {
      return res.json({ status: 'error', message: status });
    }
    res.json({ status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Config status (tells frontend what's enabled)
app.get('/api/config', (req, res) => {
  const rapidApiActive = !!(RAPIDAPI_KEY);
  res.json({
    plateProvider: rapidApiActive ? 'rapidapi' : PLATE_PROVIDER,
    plateLive: rapidApiActive || (PLATE_PROVIDER !== 'claude' && !!PLATE_API_KEY),
    apifyEnabled: !!APIFY_TOKEN,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  AutoEstime — http://localhost:${PORT}`);
  const plateStatus = RAPIDAPI_KEY ? '✅ RapidAPI (SIV réel)' : (PLATE_PROVIDER !== 'claude' && PLATE_API_KEY ? '✅ ' + PLATE_PROVIDER : '🔶 simulation Claude');
  console.log(`  Plaque: ${plateStatus}`);
  console.log(`  LeBonCoin live: ${APIFY_TOKEN ? '✅ Apify' : '⬜ non configuré'}\n`);
});
