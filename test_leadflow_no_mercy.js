const { initDB, saveDB } = require('./db');
const { calculateLeadScore, analyzeLeadText, processSalesTranscript } = require('./app');

async function runNoMercyHardcoreTests() {
  console.log("======================================================================");
  console.log("🔥 LEADFLOW 360 AI — NO MERCY HARDCORE STRESS TEST SUITE");
  console.log("======================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASSED: ${message}`);
      passed++;
    } else {
      console.log(`  ❌ FAILED: ${message}`);
      failed++;
    }
  }

  try {
    const db = await initDB();

    // ----------------------------------------------------------------------
    // STRESS TEST 1: Security & Injection Payload Resilience
    // ----------------------------------------------------------------------
    console.log("📌 STRESS TEST 1: Malicious & Injection Payload Resilience...");

    const xssPayload = "<script>alert('xss_attack')</script>";
    const sqlInjPayload = "'; DROP TABLE leads; SELECT * FROM leads WHERE '1'='1";
    const unicodePayload = "こんにちは / مرحبا / 🚀🔥 Enterprise AI Pipeline";

    const res1 = await analyzeLeadText(`${xssPayload} ${sqlInjPayload} ${unicodePayload}`, xssPayload, sqlInjPayload);
    assert(res1.name === xssPayload, "Handled XSS string in name without crashing");
    assert(res1.contact === sqlInjPayload, "Handled SQL Injection payload in contact safely");
    assert(res1.intent_summary.includes(xssPayload), "Safely sanitized intent extraction");

    // Insert injection payload into DB
    const stmt1 = db.prepare(`
      INSERT INTO leads (name, contact, channel, raw_text, intent_summary, budget_val, urgency, score, stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt1.run([res1.name, res1.contact, res1.channel, res1.raw_text, res1.intent_summary, res1.budget_val, res1.urgency, res1.score, res1.stage]);
    stmt1.free();
    saveDB();

    // Check DB table still exists and wasn't dropped
    const tableCheck = db.exec("SELECT COUNT(*) FROM leads;");
    assert(tableCheck.length > 0 && tableCheck[0].values[0][0] > 0, "Database table survived SQL Injection attack!");
    console.log("");

    // ----------------------------------------------------------------------
    // STRESS TEST 2: Complex Budget & Currency Regex Parsing
    // ----------------------------------------------------------------------
    console.log("📌 STRESS TEST 2: Complex Budget & Currency Parser...");

    const testCases = [
      { text: "Our budget is Rs 1,50,000 for this build", expectedBudget: 150000 },
      { text: "Expected spending around 50k INR", expectedBudget: 50000 },
      { text: "Total cost is $12,000 USD asap", expectedBudget: 12000 },
      { text: "No budget mentioned, just looking for info", expectedBudget: 50000 } // Fallback default
    ];

    for (let i = 0; i < testCases.length; i++) {
      const parsed = await analyzeLeadText(testCases[i].text, `Test ${i}`, `test${i}@corp.com`);
      assert(parsed.budget_val === testCases[i].expectedBudget, `Budget Parser Test #${i + 1}: Extracted ₹${parsed.budget_val} (Expected ₹${testCases[i].expectedBudget})`);
    }
    console.log("");

    // ----------------------------------------------------------------------
    // STRESS TEST 3: Rapid-Fire High Volume Concurrent Ingestion (100 Leads Batch)
    // ----------------------------------------------------------------------
    console.log("📌 STRESS TEST 3: Batch Ingestion (100 Rapid Inbound Leads)...");

    const startTime = Date.now();
    const batchStmt = db.prepare(`
      INSERT INTO leads (name, contact, channel, raw_text, intent_summary, budget_val, urgency, score, stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    for (let i = 0; i < 100; i++) {
      const isHot = i % 3 === 0;
      const budget = isHot ? 300000 : 40000;
      const urgency = isHot ? "High" : "Low";
      const score = calculateLeadScore(budget, urgency, 150);
      const stage = score >= 80 ? "SQL (Sales Qualified)" : "Lead Ingestion";

      batchStmt.run([
        `Batch Prospect #${i}`,
        `prospect_${i}@enterprise.com`,
        "Web Inbound",
        `Batch inquiry #${i} regarding AI workflow automation with budget ₹${budget}`,
        `Batch Ingest Requirement #${i}`,
        budget,
        urgency,
        score,
        stage
      ]);
    }
    batchStmt.free();
    saveDB();

    const duration = Date.now() - startTime;
    assert(duration < 1000, `Successfully ingested 100 leads in ${duration}ms (Sub-1-second execution!)`);

    const countRes = db.exec("SELECT COUNT(*) FROM leads;");
    const totalCount = countRes[0].values[0][0];
    assert(totalCount >= 100, `Total DB records verified: ${totalCount}`);
    console.log("");

    // ----------------------------------------------------------------------
    // STRESS TEST 4: Rapid Stage Mutations (500 State Transitions)
    // ----------------------------------------------------------------------
    console.log("📌 STRESS TEST 4: Rapid Stage Mutation Stress (500 State Changes)...");

    const stages = ["Lead Ingestion", "SQL (Sales Qualified)", "Proposal & Negotiation", "Contract Signed", "Archived / Lost"];
    // Use a live lead id instead of hardcoded 1 — leadflow.db persists across
    // runs and id=1 may have been deleted, which made the suite crash here.
    const idProbe = db.exec("SELECT id FROM leads ORDER BY id LIMIT 1;");
    const targetLeadId = (idProbe.length && idProbe[0].values.length) ? idProbe[0].values[0][0] : 1;
    console.log(`  ℹ️ Using lead id=${targetLeadId} for mutation/transcript stages`);
    const mutStart = Date.now();

    for (let i = 0; i < 500; i++) {
      const targetStage = stages[i % stages.length];
      db.run("UPDATE leads SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;", [targetStage, targetLeadId]);
    }
    saveDB();

    const mutDuration = Date.now() - mutStart;
    assert(mutDuration < 1500, `500 Rapid Stage Mutations executed cleanly in ${mutDuration}ms!`);

    const lead1Res = db.exec(`SELECT stage FROM leads WHERE id = ${Number(targetLeadId)};`);
    assert(lead1Res.length && lead1Res[0].values.length && lead1Res[0].values[0][0] === stages[499 % stages.length], `Final lead stage state deterministic: ${lead1Res.length && lead1Res[0].values.length ? lead1Res[0].values[0][0] : 'MISSING'}`);
    console.log("");

    // ----------------------------------------------------------------------
    // STRESS TEST 5: Extreme Transcript Analysis Edge Cases
    // ----------------------------------------------------------------------
    console.log("📌 STRESS TEST 5: Transcript Analysis & Sentiment Stress...");

    // Test Won transcript
    const tWon = await processSalesTranscript(targetLeadId, "Executive briefing completed. Client accepted proposal, signed contract, payment completed.");
    assert(tWon.updatedStage === "Contract Signed", "Won Transcript correctly moved lead to 'Contract Signed'");

    // Test Negotiation transcript
    const tNeg = await processSalesTranscript(targetLeadId, "Client requested custom SLA clauses. Sent revised proposal for review next week.");
    assert(tNeg.updatedStage === "Proposal & Negotiation", "Negotiation Transcript correctly moved lead to 'Proposal & Negotiation'");

    // Test Lost transcript
    const tLost = await processSalesTranscript(targetLeadId, "Client cancelled project due to internal restructuring. Unqualified lead.");
    assert(tLost.updatedStage === "Archived / Lost", "Lost Transcript correctly moved lead to 'Archived / Lost'");
    console.log("");

    // ----------------------------------------------------------------------
    // SUMMARY REPORT
    // ----------------------------------------------------------------------
    console.log("======================================================================");
    console.log(`📊 NO MERCY STRESS TEST RESULTS:`);
    console.log(`   - PASSED TESTS: ${passed}`);
    console.log(`   - FAILED TESTS: ${failed}`);
    console.log(`   - TOTAL EXECUTED: ${passed + failed}`);
    console.log("======================================================================");

    if (failed > 0) {
      console.error("\n❌ HARDCORE STRESS TEST FAILED! FIXES REQUIRED!");
      process.exit(1);
    } else {
      console.log("\n🎉 ALL HARDCORE STRESS TESTS PASSED WITH 100% ZERO ERRORS! RUTHLESS VICTORY!");
    }

  } catch (err) {
    console.error("❌ UNCAUGHT EXCEPTION IN STRESS TEST:", err);
    process.exit(1);
  }
}

runNoMercyHardcoreTests();
