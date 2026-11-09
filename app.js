const { getLeadById, updateLeadStage, addActivity } = require('./db');

// Formal Lead Scoring Math Engine
function calculateLeadScore(budget, urgency, textLength) {
  let score = 40;

  if (budget >= 200000) score += 35;
  else if (budget >= 100000) score += 25;
  else if (budget >= 50000) score += 15;
  else if (budget > 0) score += 10;

  if (urgency === 'High') score += 20;
  else if (urgency === 'Medium') score += 10;

  if (textLength > 100) score += 5;

  return Math.min(100, Math.max(10, score));
}

// Strict id guard: positive integer (dev mode) or uuid (Supabase mode).
// Prevents unfiltered/wrong-lead lookups.
function validateLeadId(leadId) {
  const s = String(leadId || '');
  if (/^\d+$/.test(s) && Number(s) > 0) return s;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) return s;
  const err = new Error(`Invalid lead ID: ${leadId}`);
  err.statusCode = 400;
  throw err;
}

function extractPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// Formal AI Extraction & Intent Engine
async function analyzeLeadText(rawText, providedName = "", providedContact = "", providedPhone = "") {
  let name = providedName || "Inbound Enterprise Prospect";
  let contact = providedContact || "Contact Pending";
  let channel = "Web Inbound";
  let intent_summary = rawText.substring(0, 120) + "...";
  let budget_val = 50000;
  let urgency = "Medium";

  // Phone: explicit field first, then phone-like contact, then raw-text scan.
  let phone = String(providedPhone || '').trim();
  if (!phone && providedContact && /\+?\d[\d\s\-()]{6,}\d/.test(String(providedContact))) {
    phone = String(providedContact).trim();
  }
  if (!phone) {
    const m = String(rawText || '').match(/\+?\d[\d\s\-()]{6,}\d/);
    if (m) phone = m[0].trim();
  }
  const phone_digits = extractPhoneDigits(phone);

  const budgetMatch = rawText.match(/(?:budget|rs|inr|₹|\$)\s*[:=]?\s*([\d,]+k?)/i);
  if (budgetMatch) {
    let numStr = budgetMatch[1].replace(/,/g, '').toLowerCase();
    if (numStr.endsWith('k')) {
      budget_val = parseFloat(numStr) * 1000;
    } else {
      budget_val = parseFloat(numStr);
    }
  }

  if (rawText.toLowerCase().includes('urgent') || rawText.toLowerCase().includes('asap') || rawText.toLowerCase().includes('today') || rawText.toLowerCase().includes('2 weeks')) {
    urgency = "High";
  }

  if (!providedName) {
    const nameMatch = rawText.match(/(?:my name is|i am|this is)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
    if (nameMatch) name = nameMatch[1];
  }

  if (rawText.toLowerCase().includes('whatsapp') || rawText.includes('+91')) {
    channel = "WhatsApp Enterprise";
  } else if (rawText.toLowerCase().includes('call') || rawText.toLowerCase().includes('meeting')) {
    channel = "Executive Briefing";
  }

  const score = calculateLeadScore(budget_val, urgency, rawText.length);
  const stage = score >= 80 ? "SQL (Sales Qualified)" : "Lead Ingestion";

  // Formal Executive Email & WhatsApp Drafts
  const email_draft = `Dear ${name},\n\nThank you for connecting with VoidReformer. We have reviewed your business requirement:\n"${intent_summary}"\n\nBased on your requested timeline (${urgency} Priority), our technical solution team has outlined a formal implementation roadmap.\n\nMay we schedule a 15-minute executive call to review the scope?\n\nSincerely,\nCorporate Solutions Division\nVoidReformer`;

  const whatsapp_draft = `Dear ${name}, Thank you for your inquiry with VoidReformer regarding "${intent_summary}". We have compiled your executive proposal outline. When may we schedule a brief consultation call today?`;

  const next_followup = new Date(Date.now() + 86400000).toISOString();

  return {
    name,
    contact,
    phone,
    phone_digits,
    channel,
    raw_text: rawText,
    intent_summary,
    budget_val,
    urgency,
    score,
    stage,
    email_draft,
    whatsapp_draft,
    next_followup
  };
}

// Formal Sales Transcript Processing Engine
async function processSalesTranscript(leadId, transcriptText) {
  const id = validateLeadId(leadId);
  const lead = await getLeadById(id);
  if (!lead) {
    throw new Error(`Lead with ID ${id} not found`);
  }

  let updatedStage = "SQL (Sales Qualified)";
  if (transcriptText.toLowerCase().includes('closed') || transcriptText.toLowerCase().includes('deal done') || transcriptText.toLowerCase().includes('payment received') || transcriptText.toLowerCase().includes('signed')) {
    updatedStage = "Contract Signed";
  } else if (transcriptText.toLowerCase().includes('follow up') || transcriptText.toLowerCase().includes('proposal') || transcriptText.toLowerCase().includes('review')) {
    updatedStage = "Proposal & Negotiation";
  } else if (transcriptText.toLowerCase().includes('not interested') || transcriptText.toLowerCase().includes('cancelled') || transcriptText.toLowerCase().includes('unqualified')) {
    updatedStage = "Archived / Lost";
  }

  const summary = `Executive Briefing Processed: ${transcriptText.substring(0, 110)}...`;

  await updateLeadStage(id, updatedStage, summary);
  await addActivity(id, "Executive Insights Processed", `Stage updated to ${updatedStage}`);

  return { leadId: id, updatedStage, summary };
}

module.exports = {
  calculateLeadScore,
  analyzeLeadText,
  processSalesTranscript,
  validateLeadId,
  extractPhoneDigits
};
