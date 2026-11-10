const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, saveDB, storeMode, listLeads, insertLead, updateLeadStage, deleteLead, addActivity } = require('./db');
const { analyzeLeadText, processSalesTranscript } = require('./app');

const app = express();
const PORT = process.env.PORT || 3005;

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.warn('[WARN] API_KEY is not set — running in demo mode without API-key auth. Set API_KEY to protect mutating routes.');
}

function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // demo mode: no key configured, allow
  const provided = req.headers['x-api-key'];
  if (!provided || provided !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
}

app.use(cors({ origin: (process.env.CORS_ORIGINS || 'http://localhost:3005').split(',') }));
app.use(express.json());

// Sensitive-file guard: never expose source, stores, or env files (static
// serving below serves the project dir, so block internals explicitly).
const SENSITIVE = /(^|\/)(server|db|supabase)\.js$|(^|\/)\.env(\.|$)|\.db$|\.sqlite3?$|(^|\/)package(-lock)?\.json$|(^|\/)\.git/i;
app.use((req, res, next) => {
  if (SENSITIVE.test(req.path)) return res.status(404).json({ error: 'Not found' });
  next();
});

// Serve static assets with explicit root dir
app.use(express.static(path.join(__dirname)));

app.get('/api/leads', async (req, res) => {
  try {
    const leads = await listLeads();

    leads.forEach(obj => {
      if (obj.next_followup) {
        obj.is_overdue = new Date(obj.next_followup) < new Date() && obj.stage !== 'Contract Signed' && obj.stage !== 'Archived / Lost';
      }
      if (typeof obj.phone !== 'undefined') {
        obj.phone_digits = String(obj.phone || '').replace(/\D/g, '');
      }
    });

    const stats = {
      totalLeads: leads.length,
      hotLeads: leads.filter(l => l.score >= 80).length,
      totalPipelineValue: leads.reduce((sum, l) => sum + (l.budget_val || 0), 0),
      overdueAlerts: leads.filter(l => l.is_overdue).length
    };

    res.json({ success: true, stats, leads, store: storeMode() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/ingest', async (req, res) => {
  try {
    const { raw_text, name, contact, phone } = req.body;
    if (!raw_text) {
      return res.status(400).json({ success: false, error: "raw_text is required" });
    }
    if (typeof name === 'string' && name.length > 500) {
      return res.status(400).json({ success: false, error: "name exceeds maximum length of 500 characters" });
    }
    if (typeof contact === 'string' && contact.length > 500) {
      return res.status(400).json({ success: false, error: "contact exceeds maximum length of 500 characters" });
    }
    if (typeof phone === 'string' && phone.length > 30) {
      return res.status(400).json({ success: false, error: "phone exceeds maximum length of 30 characters" });
    }

    const analyzed = await analyzeLeadText(raw_text, name, contact, phone);
    const saved = await insertLead(analyzed);

    res.json({ success: true, message: "Lead ingested & qualified", lead: analyzed, id: saved ? saved.id : undefined, store: storeMode() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function validateRouteId(id) {
  const s = String(id || '');
  if (/^\d+$/.test(s) && Number(s) > 0) return s;               // legacy integer id (dev mode)
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return s; // uuid (Supabase)
  return null;
}

app.put('/api/leads/:id/stage', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateRouteId(id)) {
      return res.status(400).json({ success: false, error: "Invalid lead ID" });
    }
    const { stage } = req.body;
    const validStages = [
      "Lead Ingestion",
      "SQL (Sales Qualified)",
      "Proposal & Negotiation",
      "Contract Signed",
      "Archived / Lost"
    ];
    
    if (!validStages.includes(stage)) {
      return res.status(400).json({ success: false, error: "Invalid pipeline stage" });
    }

    await updateLeadStage(id, stage);
    await addActivity(id, "Stage Updated", `Pipeline stage changed to ${stage}`);

    res.json({ success: true, message: `Pipeline stage updated to ${stage}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:id/transcript', async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateRouteId(id)) {
      return res.status(400).json({ success: false, error: "Invalid lead ID" });
    }
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ success: false, error: "transcript text is required" });
    }

    const result = await processSalesTranscript(id, transcript);
    res.json({ success: true, result });
  } catch (err) {
    if (err && err.statusCode === 400) {
      return res.status(400).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/leads/:id', requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    if (!validateRouteId(id)) {
      return res.status(400).json({ success: false, error: "Invalid lead ID" });
    }
    await deleteLead(id);
    res.json({ success: true, message: "Lead record deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Wildcard Route — serve index.html for all SPA non-API requests
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(444).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 LeadFlow 360 AI Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
