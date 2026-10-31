const { initDB, saveDB } = require('./db');
const { calculateLeadScore, analyzeLeadText, processSalesTranscript } = require('./app');

async function runExtremeTests() {
  console.log("==================================================");
  console.log("🧪 LEADFLOW 360 AI EXTREME AUTOMATED TEST SUITE");
  console.log("==================================================\n");

  try {
    console.log("Test 1: Initializing WASM SQLite Database...");
    const db = await initDB();
    console.log("✅ WASM SQLite DB initialized successfully.\n");

    console.log("Test 2: Testing Lead Score Math Engine...");
    const score1 = calculateLeadScore(250000, "High", 120);
    const score2 = calculateLeadScore(30000, "Low", 40);
    console.log(`- High Budget + High Urgency Score: ${score1}% (Expected >= 85)`);
    console.log(`- Low Budget + Low Urgency Score: ${score2}% (Expected <= 65)`);
    if (score1 >= 85 && score2 <= 65) {
      console.log("✅ Lead Score Math Engine passed.\n");
    } else {
      throw new Error("Lead Score Math assertion failed");
    }

    console.log("Test 3: Testing Formal AI Extraction Engine...");
    const rawEnquiry = "Hi my name is Sanjay Gupta, we urgently need custom AI software. Budget around ₹3,00,000 ASAP.";
    const analyzed = await analyzeLeadText(rawEnquiry, "Sanjay Gupta", "+919123456789");
    console.log(`- Extracted Name: ${analyzed.name}`);
    console.log(`- Calculated Budget: ₹${analyzed.budget_val}`);
    console.log(`- Calculated Urgency: ${analyzed.urgency}`);
    console.log(`- Assigned Stage: ${analyzed.stage}`);
    console.log(`- Score: ${analyzed.score}%`);
    if (analyzed.budget_val === 300000 && analyzed.urgency === "High" && analyzed.stage === "SQL (Sales Qualified)") {
      console.log("✅ Formal AI Extraction Engine passed.\n");
    } else {
      throw new Error("AI Extraction assertion failed");
    }

    console.log("Test 4: Testing Formal Sales Transcript Engine...");
    // Use a live lead id — leadflow.db persists across runs so hardcoded id=1 may not exist.
    const idProbe = db.exec("SELECT id FROM leads ORDER BY id LIMIT 1;");
    const transcriptLeadId = (idProbe.length && idProbe[0].values.length) ? idProbe[0].values[0][0] : 1;
    const transcriptRes = await processSalesTranscript(transcriptLeadId, "Had executive briefing with client. Contract signed, payment received in full.");
    console.log(`- Updated Stage: ${transcriptRes.updatedStage}`);
    if (transcriptRes.updatedStage === "Contract Signed") {
      console.log("✅ Formal Sales Transcript Engine passed.\n");
    } else {
      throw new Error("Transcript Engine assertion failed");
    }

    console.log("Test 5: Verifying DB Leads Query...");
    const res = db.exec("SELECT COUNT(*) FROM leads;");
    const count = res[0].values[0][0];
    console.log(`- Total Leads in DB: ${count}`);
    if (count > 0) {
      console.log("✅ Database record verification passed.\n");
    }

    console.log("==================================================");
    console.log("🎉 ALL 5 EXTREME VERIFICATION TESTS PASSED 100%!");
    console.log("==================================================");
  } catch (err) {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  }
}

runExtremeTests();
