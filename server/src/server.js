const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

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
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

function requireDatabase(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Banco ainda não configurado. Defina DATABASE_URL no Render.' });
  next();
}
function cleanDocument(value) {
  const result = String(value || '').replace(/\D/g, '');
  return result || null;
}

async function initializeDatabase() {
  if (!pool) {
    console.warn('DATABASE_URL não definida. API iniciada sem persistência.');
    return;
  }
  await pool.query("CREATE TABLE IF NOT EXISTS suppliers (id BIGSERIAL PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE, document TEXT, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS invoices (id BIGSERIAL PRIMARY KEY, access_key VARCHAR(44) UNIQUE, invoice_number TEXT, series TEXT, issue_date TIMESTAMPTZ, supplier_id BIGINT REFERENCES suppliers(id), supplier_name TEXT NOT NULL, supplier_document TEXT, recipient_document TEXT, total NUMERIC(15,2) NOT NULL DEFAULT 0, payment_info TEXT, protocol TEXT, status TEXT, file_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS invoice_products (id BIGSERIAL PRIMARY KEY, invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, item_number INTEGER NOT NULL, product_code TEXT, description TEXT, ncm TEXT, cfop TEXT, unit TEXT, quantity NUMERIC(18,6) NOT NULL DEFAULT 0, unit_price NUMERIC(18,6) NOT NULL DEFAULT 0, total NUMERIC(15,2) NOT NULL DEFAULT 0)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_invoices_supplier_document ON invoices(supplier_document)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_invoice_products_description ON invoice_products(description)");
  console.log('Estrutura do PostgreSQL verificada.');
}

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
  res.json({ status: 'ok', databaseConfigured: Boolean(pool), databaseConnected, authentication: 'disabled' });
});

app.get('/api/invoices', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT i.id, COALESCE(i.access_key, 'Não informada') AS key, i.access_key AS \"accessKey\", i.invoice_number AS number, i.series, i.issue_date AS date, i.supplier_name AS supplier, i.supplier_document AS \"supplierCnpj\", i.recipient_document AS \"destCnpj\", i.total, i.payment_info AS payment, i.protocol, i.status, i.file_name AS \"fileName\", COALESCE((SELECT json_agg(json_build_object('code',p.product_code,'description',p.description,'ncm',p.ncm,'cfop',p.cfop,'unit',p.unit,'quantity',p.quantity,'unitPrice',p.unit_price,'total',p.total) ORDER BY p.item_number) FROM invoice_products p WHERE p.invoice_id=i.id), '[]'::json) AS products FROM invoices i ORDER BY i.issue_date DESC NULLS LAST, i.id DESC LIMIT 1000");
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/suppliers', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT s.id,s.name,s.document,COUNT(i.id)::int AS invoice_count,COALESCE(SUM(i.total),0)::numeric(15,2) AS total_value FROM suppliers s LEFT JOIN invoices i ON i.supplier_id=s.id GROUP BY s.id ORDER BY s.name");
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/products', requireDatabase, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT p.*,i.invoice_number,i.supplier_name FROM invoice_products p JOIN invoices i ON i.id=p.invoice_id ORDER BY p.id DESC LIMIT 5000");
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/invoices', requireDatabase, async (req, res, next) => {
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
