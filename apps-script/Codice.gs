/**
 * Calò Art – pannello per cambiare foto e descrizioni dei quadri.
 * Salva tutto su GitHub (file opere.json + cartella opere/), il sito pubblico legge da lì.
 *
 * PRIMA DI PUBBLICARE:
 *  1. Scrivi qui sotto in ADMIN_EMAILS gli indirizzi Google che possono usare il pannello.
 *  2. Impostazioni progetto → Proprietà dello script → aggiungi GITHUB_TOKEN (il token GitHub).
 *     Il token NON va scritto nel codice.
 */
const ADMIN_EMAILS = [
  // 'tuo.indirizzo@gmail.com',
  // 'alyssa@caloart.it',
];

const GH = { owner: 'Andrea91x', repo: 'CaloArt', branch: 'main' };

function doGet() {
  const email = Session.getActiveUser().getEmail();
  if (!permesso_(email)) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:24px">Accesso non consentito' +
      (email ? ' per ' + email : '') + '.</p>'
    ).setTitle('Calò Art');
  }
  return HtmlService.createHtmlOutputFromFile('Pannello')
    .setTitle('Calò Art – Opere')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Restituisce { opere: [...], sha } dal file opere.json su GitHub. */
function leggiOpere() {
  autorizza_();
  const r = gh_('get', '/contents/opere.json?ref=' + GH.branch);
  if (r.code === 404) return { opere: [], sha: null };
  const testo = Utilities.newBlob(
    Utilities.base64Decode(r.body.content.replace(/\n/g, ''))
  ).getDataAsString('UTF-8');
  return { opere: JSON.parse(testo), sha: r.body.sha };
}

/** Carica una foto (JPEG in base64, senza prefisso) e restituisce il suo percorso nel repository. */
function caricaFoto(base64) {
  autorizza_();
  if (!base64 || base64.length > 4000000) throw new Error('Foto mancante o troppo pesante.');
  const percorso = 'opere/' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '.jpg';
  gh_('put', '/contents/' + percorso, {
    message: 'Nuova foto dal pannello',
    content: base64,
    branch: GH.branch
  });
  return percorso;
}

/** Salva l'elenco delle opere. daEliminare = foto sostituite o rimosse (pulizia). */
function salvaOpere(opere, sha, daEliminare) {
  autorizza_();
  const pulite = opere.map(function (o) {
    return {
      id: String(o.id || ''),
      titolo: String(o.titolo || '').trim(),
      info: String(o.info || '').trim(),
      descrizione: String(o.descrizione || '').trim(),
      foto: String(o.foto || '')
    };
  });
  pulite.forEach(function (o) {
    if (!/^opere\/[\w.-]+\.jpg$/.test(o.foto)) throw new Error('Ogni opera deve avere una foto.');
  });

  const corpo = {
    message: 'Aggiorna le opere dal pannello',
    content: Utilities.base64Encode(JSON.stringify(pulite, null, 2), Utilities.Charset.UTF_8),
    branch: GH.branch
  };
  if (sha) corpo.sha = sha;
  const r = gh_('put', '/contents/opere.json', corpo);

  // Pulizia delle vecchie foto: se fallisce non è grave.
  (daEliminare || []).forEach(function (p) {
    if (!/^opere\/[\w.-]+\.jpg$/.test(p)) return;
    if (pulite.some(function (o) { return o.foto === p; })) return;
    try {
      const f = gh_('get', '/contents/' + p + '?ref=' + GH.branch);
      if (f.code === 200) {
        gh_('delete', '/contents/' + p, { message: 'Rimuovi vecchia foto', sha: f.body.sha, branch: GH.branch });
      }
    } catch (e) {}
  });

  return { sha: r.body.content.sha };
}

/* ---------- interni ---------- */

function permesso_(email) {
  if (!email) return false;
  return ADMIN_EMAILS.some(function (e) { return e.toLowerCase() === email.toLowerCase(); });
}

function autorizza_() {
  if (!permesso_(Session.getActiveUser().getEmail())) throw new Error('Accesso non consentito.');
}

function gh_(metodo, percorso, corpo) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Manca GITHUB_TOKEN nelle proprietà dello script.');
  const opzioni = {
    method: metodo,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };
  if (corpo) {
    opzioni.contentType = 'application/json';
    opzioni.payload = JSON.stringify(corpo);
  }
  const res = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GH.owner + '/' + GH.repo + percorso, opzioni
  );
  const code = res.getResponseCode();
  const testo = res.getContentText();
  const body = testo ? JSON.parse(testo) : {};
  if (code === 404 && metodo === 'get') return { code: code, body: body };
  if (code === 409 || (code === 422 && metodo === 'put')) {
    throw new Error('I dati sono cambiati nel frattempo. Ricarica la pagina e riprova.');
  }
  if (code === 401 || code === 403) {
    throw new Error('GitHub ha rifiutato il token (scaduto o senza permessi). Va rinnovato.');
  }
  if (code >= 300) throw new Error('Errore GitHub ' + code + ': ' + (body.message || ''));
  return { code: code, body: body };
}
