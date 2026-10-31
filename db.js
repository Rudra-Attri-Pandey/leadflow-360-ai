const fs = require('fs');
const path = require('path');

let initSqlJs = null;
try {
  initSqlJs = require('sql.js');
} catch (e) {
  console.log("sql.js loading deferred");
}

const isVercel = process.env.VERCEL === '1' || process.env.NOW_BUILDER === '1';
const dbDir = isVercel ? '/tmp' : __dirname;
const dbPath = path.join(dbDir, 'leadflow.db');

let db = null;
let memoryStore = [];
let nextId = 1;

async function initDB() {
  if (db) return db;
  
  try {
    if (initSqlJs) {
      const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
      const config = fs.existsSync(wasmPath) ? { locateFile: () => wasmPath } : {};
      const SQL = await initSqlJs(config);
      
      if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
        // Migrate older DBs that lack the phone column (added for WhatsApp deep-links).
        try { db.run("ALTER TABLE leads ADD COLUMN phone TEXT DEFAULT '';"); saveDB(); } catch (e) { /* column already exists */ }
      } else {
        db = new SQL.Database();
        createTables(db);
        saveDB();
      }
      return db;
    }
  } catch (err) {
    console.error("WASM SQLite Fallback engaged:", err.message);
  }

  // Pure In-Memory Zero-Fail Provider for Vercel Serverless
  const LEAD_COLUMNS = ['id', 'name', 'contact', 'phone', 'channel', 'raw_text', 'intent_summary', 'budget_val', 'urgency', 'score', 'stage', 'email_draft', 'whatsapp_draft', 'next_followup', 'created_at', 'updated_at'];
  function leadToRow(l) {
    return [
      l.id, l.name, l.contact, l.phone || '', l.channel, l.raw_text, l.intent_summary,
      l.budget_val, l.urgency, l.score, l.stage, l.email_draft,
      l.whatsapp_draft, l.next_followup, l.created_at, l.updated_at
    ];
  }
  function rowToObject(columns, row) {
    const obj = {};
    columns.forEach((col, idx) => { obj[col] = row[idx]; });
    return obj;
  }
  db = {
    exec: (sql, params) => {
      // Fallback honors WHERE id = ? / WHERE id = N (real sql.js exec takes no
      // params, so callers must use prepare()+bind; this path only parses the SQL).
      let rows = memoryStore;
      let idFilter = null;
      if (Array.isArray(params) && params.length > 0 && /WHERE\s+id\s*=\s*\?/i.test(sql || '')) {
        idFilter = Number(params[0]);
      } else {
        const m = String(sql || '').match(/WHERE\s+id\s*=\s*(\d+)/i);
        if (m) idFilter = Number(m[1]);
      }
      if (idFilter !== null && Number.isInteger(idFilter)) {
        rows = rows.filter(l => Number(l.id) === idFilter);
      }
      return [{
        columns: LEAD_COLUMNS,
        values: rows.map(leadToRow)
      }];
    },
    prepare: (sql) => {
      if (/SELECT/i.test(sql || '')) {
        // SELECT mock supporting bind([id]) + step() + getAsObject() + free()
        // so transcript lookup filters to ONE lead instead of returning ALL.
        let boundId = null;
        const m = String(sql || '').match(/WHERE\s+id\s*=\s*(\d+)/i);
        if (m) boundId = Number(m[1]);
        let row = null;
        return {
          bind: (params) => {
            if (Array.isArray(params) && params.length > 0) boundId = Number(params[0]);
          },
          step: () => {
            const target = Number.isInteger(boundId)
              ? memoryStore.find(l => Number(l.id) === boundId)
              : memoryStore[0];
            row = target ? rowToObject(LEAD_COLUMNS, leadToRow(target)) : null;
            return row !== null;
          },
          getAsObject: () => row || {},
          free: () => {}
        };
      }
      return {
        run: (params) => {
          const lead = {
            id: nextId++,
            name: params[0],
            contact: params[1],
            phone: params[2] || '',
            channel: params[3],
            raw_text: params[4],
            intent_summary: params[5],
            budget_val: params[6],
            urgency: params[7],
            score: params[8],
            stage: params[9],
            email_draft: params[10],
            whatsapp_draft: params[11],
            next_followup: params[12],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          memoryStore.push(lead);
        },
        free: () => {}
      };
    },
    run: (sql, params) => {
      if (sql.includes('UPDATE leads')) {
        const [stage, summary, id] = params;
        const target = memoryStore.find(l => l.id == id);
        if (target) {
          target.stage = stage;
          if (typeof summary !== 'undefined') target.intent_summary = summary;
          target.updated_at = new Date().toISOString();
        }
      } else if (sql.includes('DELETE FROM leads')) {
        const [id] = params;
        memoryStore = memoryStore.filter(l => l.id != id);
      }
    }
  };

  return db;
}

function createTables(database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      phone TEXT DEFAULT '',
      channel TEXT DEFAULT 'Web Form',
      raw_text TEXT NOT NULL,
      intent_summary TEXT,
      budget_val INTEGER DEFAULT 0,
      urgency TEXT DEFAULT 'Medium',
      score INTEGER DEFAULT 50,
      stage TEXT DEFAULT 'Lead Ingestion',
      email_draft TEXT,
      whatsapp_draft TEXT,
      next_followup TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function saveDB() {
  if (!db || !db.export) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error("Warning: Could not save DB to disk:", err.message);
  }
}

module.exports = { initDB, saveDB };
