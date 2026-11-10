const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const crypto = require('node:crypto');
const sefaz = require('./sefaz');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors()); // API pública nesta etapa, sem restrição de origem.
app.use(express.json({ limit: '20mb' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.' }
});

function requireAdminAuth(req, res, next) {
  const config = auth.getAuthConfig();
  if (!config.configured) return res.status(503).json({ error: 'Autenticação administrativa ainda não configurada no Render.' });
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const claims = auth.verifyAdminToken(token, config.secret);
  if (!claims) return res.status(401).json({ error: 'Sessão inválida ou expirada. Entre novamente.' });
  req.admin = { username: claims.sub };
  next();
}

function requireDatabase(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Banco ainda não configurado. Defina DATABASE_URL no Render.' });
  next();
}
function cleanDocument(value) {
  const result = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return result || null;
}
function requireSefazSyncToken(req, res, next) {
  const expected = process.env.COSTALOG_SYNC_TOKEN || '';
  const auth = String(req.headers.authorization || '');
  const received = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!expected) return res.status(503).json({ error: 'Agendador SEFAZ ainda não foi configurado.' });
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

async function initializeDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL não definida. API iniciada sem persistência.');
    return;
  }
  await pool.query("CREATE TABLE IF NOT EXISTS suppliers (id BIGSERIAL PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE, document TEXT, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS invoices (id BIGSERIAL PRIMARY KEY, access_key VARCHAR(44) UNIQUE, invoice_number TEXT, series TEXT, issue_date TIMESTAMPTZ, supplier_id BIGINT REFERENCES suppliers(id), supplier_name TEXT NOT NULL, supplier_document TEXT, recipient_document TEXT, total NUMERIC(15,2) NOT NULL DEFAULT 0, payment_info TEXT, protocol TEXT, status TEXT, file_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS invoice_products (id BIGSERIAL PRIMARY KEY, invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, item_number INTEGER NOT NULL, product_code TEXT, description TEXT, ncm TEXT, cfop TEXT, unit TEXT, quantity NUMERIC(18,6) NOT NULL DEFAULT 0, unit_price NUMERIC(18,6) NOT NULL DEFAULT 0, total NUMERIC(15,2) NOT NULL DEFAULT 0)");
  await pool.query("CREATE TABLE IF NOT EXISTS fiscal_documents (id BIGSERIAL PRIMARY KEY, document_type TEXT NOT NULL, document_key TEXT NOT NULL UNIQUE, document_number TEXT, series TEXT, issue_date TIMESTAMPTZ, issuer_name TEXT, issuer_document TEXT, recipient_name TEXT, recipient_document TEXT, total NUMERIC(15,2) NOT NULL DEFAULT 0, status TEXT, source TEXT NOT NULL DEFAULT 'XML/ZIP', file_name TEXT, raw_xml TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_fiscal_documents_type_date ON fiscal_documents(document_type,issue_date DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_fiscal_documents_issuer ON fiscal_documents(issuer_document)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_fiscal_documents_recipient ON fiscal_documents(recipient_document)");
  await pool.query("CREATE TABLE IF NOT EXISTS workspace_records (id BIGSERIAL PRIMARY KEY, area TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Em aberto', supplier_name TEXT, supplier_document TEXT, amount NUMERIC(15,2), due_date DATE, related_invoice_id BIGINT REFERENCES invoices(id) ON DELETE SET NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_workspace_records_area_kind ON workspace_records(area,kind,updated_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_workspace_records_due ON workspace_records(due_date)");
  await pool.query("CREATE TABLE IF NOT EXISTS document_annotations (id BIGSERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_id BIGINT NOT NULL, kind TEXT NOT NULL DEFAULT 'comment', body TEXT NOT NULL, color TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_document_annotations_entity ON document_annotations(entity_type,entity_id,created_at DESC)");

  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sefaz_nsu VARCHAR(15)");
  await pool.query("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sefaz_schema TEXT");
  await pool.query("CREATE TABLE IF NOT EXISTS sefaz_sync_state (cnpj VARCHAR(14) PRIMARY KEY, ult_nsu VARCHAR(15) NOT NULL DEFAULT '000000000000000', max_nsu VARCHAR(15) NOT NULL DEFAULT '000000000000000', last_status TEXT, last_message TEXT, last_sync_at TIMESTAMPTZ, next_sync_at TIMESTAMPTZ, documents_processed INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS sefaz_processed_documents (nsu VARCHAR(32) PRIMARY KEY, schema TEXT NOT NULL, access_key VARCHAR(44), document_type TEXT NOT NULL, processing_status TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS sefaz_key_lookups (id BIGSERIAL PRIMARY KEY, access_key VARCHAR(44) NOT NULL, result_status TEXT NOT NULL, queried_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_sefaz_key_lookups_queried_at ON sefaz_key_lookups(queried_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_sefaz_documents_access_key ON sefaz_processed_documents(access_key)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_invoices_supplier_document ON invoices(supplier_document)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_invoice_products_description ON invoice_products(description)");
  console.log('Estrutura do PostgreSQL verificada.');
}

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const config = auth.getAuthConfig();
  if (!config.configured) return res.status(503).json({ error: 'Autenticação administrativa ainda não configurada no Render.' });
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!auth.safeEqual(username, config.username) || !auth.safeEqual(password, config.password)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  const session = auth.createAdminToken(config.username, config.secret);
  res.json({ token: session.token, expiresAt: session.expiresAt, user: config.username });
});

app.get('/api/auth/me', requireAdminAuth, (req, res) => {
  res.json({ authenticated: true, user: req.admin.username });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Central de Notas Fiscais Costalog API',
    status: 'running',
    api: 'implemented',
    endpoints: {
      health: '/health',
      invoices: '/api/invoices',
      invoiceImportBatch: 'POST /api/invoices/import-batch',
      invoiceExportCsv: '/api/invoices/export.csv',
      sefazLookupByKey: 'POST /api/sefaz/lookup-key',
      suppliers: '/api/suppliers',
      products: '/api/products',
      sefazStatus: '/api/sefaz/status',
      sefazSync: 'POST /api/sefaz/sync (token protegido)'
    },
    sefazIntegration: 'Distribuição DF-e com sincronização protegida',
    authentication: auth.getAuthConfig().configured ? 'enabled' : 'not_configured'
  });
});

app.get('/health', async (req, res) => {
  let databaseConnected = false;
  if (pool) {
    try {
      await pool.query('SELECT 1');
      databaseConnected = true;
    } catch (error) {
      return res.status(503).json({ status: 'degraded', databaseConfigured: true, databaseConnected: false });
    }
  }
  res.json({ status: 'ok', databaseConfigured: Boolean(pool), databaseConnected, authentication: auth.getAuthConfig().configured ? 'enabled' : 'not_configured' });
});

app.get('/api/invoices/export.csv', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT invoice_number,series,issue_date,supplier_name,supplier_document,recipient_document,total,status,source,access_key FROM invoices ORDER BY issue_date DESC NULLS LAST,id DESC");
    const fields = ['Número','Série','Data de emissão','Fornecedor','CNPJ fornecedor','CNPJ destinatário','Valor total','Situação','Origem','Chave de acesso'];
    const cell = value => {
      let text = String(value ?? '');
      if (/^[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const lines = [fields.map(cell).join(';'), ...result.rows.map(row => [
      row.invoice_number,row.series,row.issue_date ? new Date(row.issue_date).toISOString() : '',
      row.supplier_name,row.supplier_document,row.recipient_document,row.total,row.status,row.source,row.access_key
    ].map(cell).join(';'))];
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="costalog-notas-fiscais.csv"');
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (error) { next(error); }
});

app.get('/api/invoices', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT i.id, COALESCE(i.access_key, 'Não informada') AS key, i.access_key AS \"accessKey\", i.invoice_number AS number, i.series, i.issue_date AS date, i.supplier_name AS supplier, i.supplier_document AS \"supplierCnpj\", i.recipient_document AS \"destCnpj\", i.total, i.payment_info AS payment, i.protocol, i.status, i.source, i.file_name AS \"fileName\", COALESCE((SELECT json_agg(json_build_object('code',p.product_code,'description',p.description,'ncm',p.ncm,'cfop',p.cfop,'unit',p.unit,'quantity',p.quantity,'unitPrice',p.unit_price,'total',p.total) ORDER BY p.item_number) FROM invoice_products p WHERE p.invoice_id=i.id), '[]'::json) AS products FROM invoices i ORDER BY i.issue_date DESC NULLS LAST, i.id DESC LIMIT 1000");
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/suppliers', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT s.id,s.name,s.document,COUNT(i.id)::int AS invoice_count,COALESCE(SUM(i.total),0)::numeric(15,2) AS total_value FROM suppliers s LEFT JOIN invoices i ON i.supplier_id=s.id GROUP BY s.id ORDER BY s.name");
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/products', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT p.*,i.invoice_number,i.supplier_name FROM invoice_products p JOIN invoices i ON i.id=p.invoice_id ORDER BY p.id DESC LIMIT 5000");
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/sefaz/status', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try { res.json(await sefaz.getStatus(pool)); }
  catch (error) { next(error); }
});

app.post('/api/sefaz/lookup-key', requireDatabase, requireAdminAuth, async (req, res) => {
  const key = String(req.body?.key || '').replace(/\D/g, '');
  if (!/^\d{44}$/.test(key)) return res.status(400).json({ error: 'Informe uma chave de acesso válida com 44 números.' });
  try {
    const result = await sefaz.lookupByKey(pool, key);
    res.json(result);
  } catch (error) {
    console.error('Falha na consulta individual de NF-e:', error.message);
    const message = error.message || 'Falha na consulta individual pela SEFAZ.';
    const status = /limite de segurança|aguarde uma hora|outra consulta/i.test(message) ? 429 : /não está configurada/i.test(message) ? 503 : 502;
    res.status(status).json({ error: message });
  }
});

app.post('/api/sefaz/sync', requireDatabase, requireSefazSyncToken, async (req, res) => {
  try {
    if (!sefaz.getConfig().configured) {
      return res.json({ skipped: true, reason: 'Aguardando novo certificado A1 e configuração segura no Render.' });
    }
    res.json(await sefaz.synchronize(pool));
  } catch (error) {
    console.error('Falha na sincronização SEFAZ:', error.message);
    res.status(502).json({ error: error.message || 'Falha na sincronização com a SEFAZ.' });
  }
});

app.post('/api/invoices/import-batch', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const invoices = Array.isArray(req.body?.invoices) ? req.body.invoices : [];
  if (!invoices.length) return res.status(400).json({ error: 'Nenhuma NF-e foi enviada para importação.' });
  if (invoices.length > 100) return res.status(400).json({ error: 'Importe no máximo 100 notas por lote.' });
  const summary = { received: invoices.length, imported: 0, duplicates: 0, invalid: 0, errors: [] };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < invoices.length; index++) {
      const data = invoices[index] || {};
      const key = String(data.key || data.accessKey || '').replace(/\D/g, '');
      const supplierName = String(data.supplier || '').trim();
      const total = Number(data.total);
      const products = Array.isArray(data.products) ? data.products : [];
      const issueDate = data.date ? new Date(data.date) : null;
      let reason = '';
      if (!/^\d{44}$/.test(key)) reason = 'Chave de acesso ausente ou inválida (44 dígitos obrigatórios).';
      else if (!supplierName) reason = 'Fornecedor não identificado.';
      else if (!Number.isFinite(total) || total < 0) reason = 'Valor total inválido.';
      else if (products.length > 500) reason = 'A NF-e excede o limite de 500 itens.';
      else if (issueDate && Number.isNaN(issueDate.getTime())) reason = 'Data de emissão inválida.';
      if (reason) {
        summary.invalid++;
        summary.errors.push({ fileName: String(data.fileName || 'Arquivo ' + (index+1)), reason });
        continue;
      }
      await client.query('SAVEPOINT invoice_import_item');
      try {
        const supplierDocument = cleanDocument(data.supplierCnpj);
        const identityKey = supplierDocument || supplierName.toLocaleLowerCase('pt-BR');
        const supplierResult = await client.query(
          "INSERT INTO suppliers (identity_key,document,name) VALUES ($1,$2,$3) ON CONFLICT (identity_key) DO UPDATE SET document=EXCLUDED.document,name=EXCLUDED.name,updated_at=NOW() RETURNING id",
          [identityKey, supplierDocument, supplierName]
        );
        const inserted = await client.query(
          "INSERT INTO invoices (access_key,invoice_number,series,issue_date,supplier_id,supplier_name,supplier_document,recipient_document,total,payment_info,protocol,status,file_name,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'XML/ZIP') ON CONFLICT (access_key) DO NOTHING RETURNING id",
          [key,String(data.number||''),String(data.series||''),issueDate,supplierResult.rows[0].id,supplierName,supplierDocument,cleanDocument(data.destCnpj),total,String(data.payment||''),String(data.protocol||''),String(data.status||'Importada por XML'),String(data.fileName||'')]
        );
        if (!inserted.rows.length) {
          await client.query('ROLLBACK TO SAVEPOINT invoice_import_item');
          await client.query('RELEASE SAVEPOINT invoice_import_item');
          summary.duplicates++;
          continue;
        }
        const invoiceId = inserted.rows[0].id;
        for (let item = 0; item < products.length; item++) {
          const product = products[item] || {};
          await client.query(
            "INSERT INTO invoice_products (invoice_id,item_number,product_code,description,ncm,cfop,unit,quantity,unit_price,total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [invoiceId,item+1,String(product.code||''),String(product.description||''),String(product.ncm||''),String(product.cfop||''),String(product.unit||''),Number(product.quantity)||0,Number(product.unitPrice)||0,Number(product.total)||0]
          );
        }
        summary.imported++;
        await client.query('RELEASE SAVEPOINT invoice_import_item');
      } catch (itemError) {
        await client.query('ROLLBACK TO SAVEPOINT invoice_import_item');
        await client.query('RELEASE SAVEPOINT invoice_import_item');
        summary.invalid++;
        summary.errors.push({ fileName: String(data.fileName || 'Arquivo ' + (index+1)), reason: 'Falha ao gravar esta NF-e.' });
      }
    }
    await client.query('COMMIT');
    res.json(summary);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/invoices', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const data = req.body || {};
  const supplierName = String(data.supplier || '').trim();
  if (!supplierName) return res.status(400).json({ error: 'Fornecedor não identificado.' });
  const total = Number(data.total);
  if (!Number.isFinite(total) || total < 0) return res.status(400).json({ error: 'Valor total inválido.' });
  const supplierDocument = cleanDocument(data.supplierCnpj);
  const identityKey = supplierDocument || supplierName.toLocaleLowerCase('pt-BR');
  const rawKey = String(data.key || '').replace(/\D/g, '');
  const accessKey = rawKey.length === 44 ? rawKey : null;
  const issueDate = data.date ? new Date(data.date) : null;
  if (issueDate && Number.isNaN(issueDate.getTime())) return res.status(400).json({ error: 'Data de emissão inválida.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const supplierResult = await client.query("INSERT INTO suppliers (identity_key,document,name) VALUES ($1,$2,$3) ON CONFLICT (identity_key) DO UPDATE SET document=EXCLUDED.document,name=EXCLUDED.name,updated_at=NOW() RETURNING id", [identityKey, supplierDocument, supplierName]);
    const inserted = await client.query("INSERT INTO invoices (access_key,invoice_number,series,issue_date,supplier_id,supplier_name,supplier_document,recipient_document,total,payment_info,protocol,status,file_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (access_key) DO NOTHING RETURNING id", [
      accessKey, String(data.number || ''), String(data.series || ''), issueDate,
      supplierResult.rows[0].id, supplierName, supplierDocument,
      cleanDocument(data.destCnpj), total, String(data.payment || ''),
      String(data.protocol || ''), String(data.status || 'Importada'), String(data.fileName || '')
    ]);
    if (!inserted.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Esta chave de acesso já está cadastrada.' });
    }
    const invoiceId = inserted.rows[0].id;
    const products = Array.isArray(data.products) ? data.products : [];
    if (products.length > 500) throw new Error('A NF-e excede o limite de 500 itens.');
    for (let index = 0; index < products.length; index++) {
      const p = products[index] || {};
      await client.query("INSERT INTO invoice_products (invoice_id,item_number,product_code,description,ncm,cfop,unit,quantity,unit_price,total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
        invoiceId, index + 1, String(p.code || ''), String(p.description || ''),
        String(p.ncm || ''), String(p.cfop || ''), String(p.unit || ''),
        Number(p.quantity) || 0, Number(p.unitPrice) || 0, Number(p.total) || 0
      ]);
    }
    await client.query('COMMIT');
    const saved = await pool.query("SELECT i.id,COALESCE(i.access_key,'Não informada') AS key,i.invoice_number AS number,i.series,i.issue_date AS date,i.supplier_name AS supplier,i.supplier_document AS \"supplierCnpj\",i.recipient_document AS \"destCnpj\",i.total,i.payment_info AS payment,i.protocol,i.status,i.file_name AS \"fileName\",COALESCE((SELECT json_agg(json_build_object('code',p.product_code,'description',p.description,'ncm',p.ncm,'cfop',p.cfop,'unit',p.unit,'quantity',p.quantity,'unitPrice',p.unit_price,'total',p.total) ORDER BY p.item_number) FROM invoice_products p WHERE p.invoice_id=i.id),'[]'::json) AS products FROM invoices i WHERE i.id=$1", [invoiceId]);
    res.status(201).json({ invoice: saved.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});


const WORKSPACE_AREAS = new Set(['geral','compras','fiscal']);
const WORKSPACE_KINDS = new Set([
  'payable','bill','purchase_order','negotiation','automation','supplier_profile',
  'document_stage','report_template','library_item','tax_review','reconciliation'
]);
const FISCAL_DOCUMENT_TYPES = new Set(['NFSE','CTE','CFE_SAT','NFCE','MDFE','CTE_OS','OTHER']);

app.get('/api/fiscal-documents', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const type = String(req.query.type || '').toUpperCase();
    const result = await pool.query(
      "SELECT id,document_type AS type,document_key AS key,document_number AS number,series,issue_date AS date,issuer_name AS issuer,issuer_document AS issuer_document,recipient_name AS recipient,recipient_document AS recipient_document,total,status,source,file_name AS file_name,created_at FROM fiscal_documents WHERE ($1='' OR document_type=$1) ORDER BY issue_date DESC NULLS LAST,id DESC LIMIT 2000",
      [type]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/fiscal-documents/import-batch', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (!documents.length) return res.status(400).json({ error: 'Nenhum documento foi enviado para importação.' });
  if (documents.length > 50) return res.status(400).json({ error: 'Importe no máximo 50 documentos por lote.' });
  const summary = { received: documents.length, imported: 0, duplicates: 0, invalid: 0, errors: [] };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < documents.length; index++) {
      const item = documents[index] || {};
      const type = String(item.type || '').toUpperCase();
      const rawXml = String(item.rawXml || '');
      const fileName = String(item.fileName || 'documento-' + (index + 1) + '.xml').slice(0, 240);
      let reason = '';
      if (!FISCAL_DOCUMENT_TYPES.has(type)) reason = 'Tipo de documento não habilitado para esta importação.';
      else if (!rawXml || rawXml.length > 10 * 1024 * 1024) reason = 'XML ausente ou acima de 10 MB.';
      else if (!String(item.number || '').trim()) reason = 'Número do documento não identificado.';
      const total = Number(item.total || 0);
      const issueDate = item.date ? new Date(item.date) : null;
      if (!reason && (!Number.isFinite(total) || total < 0)) reason = 'Valor total inválido.';
      if (!reason && issueDate && Number.isNaN(issueDate.getTime())) reason = 'Data de emissão inválida.';
      if (reason) {
        summary.invalid++;
        summary.errors.push({ fileName, reason });
        continue;
      }
      const suppliedKey = String(item.key || '').trim().slice(0, 120);
      const documentKey = suppliedKey || crypto.createHash('sha256').update(rawXml).digest('hex');
      const inserted = await client.query(
        "INSERT INTO fiscal_documents (document_type,document_key,document_number,series,issue_date,issuer_name,issuer_document,recipient_name,recipient_document,total,status,source,file_name,raw_xml,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'XML/ZIP',$12,$13,$14::jsonb) ON CONFLICT (document_key) DO NOTHING RETURNING id",
        [type,documentKey,String(item.number || '').slice(0,100),String(item.series || '').slice(0,40),issueDate,String(item.issuer || '').slice(0,240),cleanDocument(item.issuerDocument),String(item.recipient || '').slice(0,240),cleanDocument(item.recipientDocument),total,String(item.status || 'Importado').slice(0,80),fileName,rawXml,JSON.stringify(item.details || {})]
      );
      if (inserted.rows.length) summary.imported++;
      else summary.duplicates++;
    }
    await client.query('COMMIT');
    res.json(summary);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

app.get('/api/fiscal-documents/:id/xml', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Documento inválido.' });
    const result = await pool.query('SELECT file_name,raw_xml FROM fiscal_documents WHERE id=$1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'XML não encontrado.' });
    const filename = String(result.rows[0].file_name || 'documento.xml').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(result.rows[0].raw_xml);
  } catch (error) { next(error); }
});

app.get('/api/workspace/records', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const area = String(req.query.area || '');
    const kind = String(req.query.kind || '');
    if (area && !WORKSPACE_AREAS.has(area)) return res.status(400).json({ error: 'Área inválida.' });
    if (kind && !WORKSPACE_KINDS.has(kind)) return res.status(400).json({ error: 'Tipo de registro inválido.' });
    const result = await pool.query(
      "SELECT id,area,kind,title,status,supplier_name AS supplier,supplier_document AS supplier_document,amount,due_date AS due_date,related_invoice_id AS related_invoice_id,payload,created_by,created_at,updated_at FROM workspace_records WHERE ($1='' OR area=$1) AND ($2='' OR kind=$2) ORDER BY updated_at DESC,id DESC LIMIT 2000",
      [area,kind]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/workspace/records', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const data = req.body || {};
  const area = String(data.area || '');
  const kind = String(data.kind || '');
  const title = String(data.title || '').trim();
  if (!WORKSPACE_AREAS.has(area)) return res.status(400).json({ error: 'Área inválida.' });
  if (!WORKSPACE_KINDS.has(kind)) return res.status(400).json({ error: 'Tipo de registro inválido.' });
  if (!title || title.length > 240) return res.status(400).json({ error: 'Informe um título com até 240 caracteres.' });
  const amount = data.amount == null || data.amount === '' ? null : Number(data.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return res.status(400).json({ error: 'Valor inválido.' });
  const dueDate = data.dueDate ? String(data.dueDate) : null;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: 'Data inválida.' });
  const relatedInvoiceId = data.relatedInvoiceId ? Number(data.relatedInvoiceId) : null;
  if (relatedInvoiceId && (!Number.isSafeInteger(relatedInvoiceId) || relatedInvoiceId <= 0)) return res.status(400).json({ error: 'Nota vinculada inválida.' });
  try {
    const result = await pool.query(
      "INSERT INTO workspace_records (area,kind,title,status,supplier_name,supplier_document,amount,due_date,related_invoice_id,payload,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id,area,kind,title,status,supplier_name AS supplier,supplier_document AS supplier_document,amount,due_date AS due_date,related_invoice_id AS related_invoice_id,payload,created_by,created_at,updated_at",
      [area,kind,title,String(data.status || 'Em aberto').slice(0,80),String(data.supplier || '').slice(0,240),cleanDocument(data.supplierDocument),amount,dueDate,relatedInvoiceId,JSON.stringify(data.payload || {}),req.admin.username]
    );
    res.status(201).json({ record: result.rows[0] });
  } catch (error) { next(error); }
});

app.patch('/api/workspace/records/:id', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Registro inválido.' });
  const data = req.body || {};
  const allowed = {
    title: 'title', status: 'status', supplier: 'supplier_name',
    supplierDocument: 'supplier_document', amount: 'amount', dueDate: 'due_date',
    relatedInvoiceId: 'related_invoice_id', payload: 'payload'
  };
  const sets = [], values = [];
  for (const [key,column] of Object.entries(allowed)) {
    if (!Object.prototype.hasOwnProperty.call(data,key)) continue;
    let value = data[key];
    if (key === 'title') { value = String(value || '').trim(); if (!value || value.length > 240) return res.status(400).json({ error: 'Título inválido.' }); }
    if (key === 'status' || key === 'supplier') value = String(value || '').slice(0,240);
    if (key === 'supplierDocument') value = cleanDocument(value);
    if (key === 'amount' && value !== null && value !== '') { value = Number(value); if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'Valor inválido.' }); }
    if (key === 'dueDate' && value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return res.status(400).json({ error: 'Data inválida.' });
    if (key === 'relatedInvoiceId' && value) { value = Number(value); if (!Number.isSafeInteger(value) || value <= 0) return res.status(400).json({ error: 'Nota vinculada inválida.' }); }
    if (key === 'payload') value = JSON.stringify(value || {});
    values.push(value);
    sets.push(column + '=
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Erro interno da API.' });
});

initializeDatabase()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log('Costalog API ativa na porta ' + PORT)))
  .catch(error => {
    console.error('Falha ao preparar o banco de dados:', error);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  if (pool) await pool.end().catch(() => {});
  process.exit(0);
});
 + values.length + (key === 'payload' ? '::jsonb' : ''));
  }
  if (!sets.length) return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
  values.push(id);
  try {
    const result = await pool.query("UPDATE workspace_records SET " + sets.join(',') + ",updated_at=NOW() WHERE id=$" + values.length + " RETURNING id,area,kind,title,status,supplier_name AS supplier,supplier_document AS supplier_document,amount,due_date AS due_date,related_invoice_id AS related_invoice_id,payload,created_by,created_at,updated_at", values);
    if (!result.rows.length) return res.status(404).json({ error: 'Registro não encontrado.' });
    res.json({ record: result.rows[0] });
  } catch (error) { next(error); }
});

app.delete('/api/workspace/records/:id', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Registro inválido.' });
  try {
    const result = await pool.query('DELETE FROM workspace_records WHERE id=$1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Registro não encontrado.' });
    res.json({ deleted: true, id });
  } catch (error) { next(error); }
});

app.get('/api/annotations', requireDatabase, requireAdminAuth, async (req, res, next) => {
  try {
    const entityType = String(req.query.entityType || '');
    const entityId = Number(req.query.entityId || 0);
    if (!['invoice','fiscal_document'].includes(entityType) || !Number.isSafeInteger(entityId) || entityId <= 0) return res.status(400).json({ error: 'Documento inválido.' });
    const result = await pool.query('SELECT id,entity_type AS entity_type,entity_id AS entity_id,kind,body,color,created_by,created_at FROM document_annotations WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC', [entityType,entityId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/annotations', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const data = req.body || {};
  const entityType = String(data.entityType || '');
  const entityId = Number(data.entityId || 0);
  const kind = String(data.kind || 'comment');
  const body = String(data.body || '').trim();
  if (!['invoice','fiscal_document'].includes(entityType) || !Number.isSafeInteger(entityId) || entityId <= 0) return res.status(400).json({ error: 'Documento inválido.' });
  if (!['comment','tag'].includes(kind)) return res.status(400).json({ error: 'Tipo de anotação inválido.' });
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Informe um texto com até 2.000 caracteres.' });
  try {
    const result = await pool.query('INSERT INTO document_annotations (entity_type,entity_id,kind,body,color,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,entity_type AS entity_type,entity_id AS entity_id,kind,body,color,created_by,created_at', [entityType,entityId,kind,body,String(data.color || '').slice(0,30),req.admin.username]);
    res.status(201).json({ annotation: result.rows[0] });
  } catch (error) { next(error); }
});

app.delete('/api/annotations/:id', requireDatabase, requireAdminAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Anotação inválida.' });
  try {
    const result = await pool.query('DELETE FROM document_annotations WHERE id=$1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Anotação não encontrada.' });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Erro interno da API.' });
});

initializeDatabase()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log('Costalog API ativa na porta ' + PORT)))
  .catch(error => {
    console.error('Falha ao preparar o banco de dados:', error);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  if (pool) await pool.end().catch(() => {});
  process.exit(0);
});
