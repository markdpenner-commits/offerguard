"use client";
import { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   OFFERGUARD v4.6 - Broker Compliance Review Tool
   Royal LePage Prime Real Estate - Manitoba OTP (Nov 2025)
   Supports: Residential OTP + Condominium Unit OTP
   v4.6: Counter-offer price logic (effectivePrice), visual
   timeline in broker drill-in, MTG-003 HIGH, SIG-006 condo-
   aware with clear message, AMD-001 shows details, timestamp
   extraction ignores DocuSign metadata, CTR-005 price change
   rule. 109 active rules, 1 stub.
   ============================================================ */

// -- Theme --
var T = {
  bg: "#06090F", s1: "#0D1321", s2: "#131B2E", bd: "#1C2640",
  tx: "#E2E8F0", m: "#8896B0", dm: "#4A5672",
  ac: "#2563EB", ad: "rgba(37,99,235,0.12)",
  cr: "#F43F5E", cb: "rgba(244,63,94,0.06)",
  hi: "#F59E0B", hb: "rgba(245,158,11,0.06)",
  md: "#3B82F6", mb: "rgba(59,130,246,0.06)",
  lo: "#6B7280", lb: "rgba(107,114,128,0.06)",
  ok: "#10B981", ob: "rgba(16,185,129,0.06)"
};
var MO = "'JetBrains Mono',monospace";
var SA = "'DM Sans',-apple-system,sans-serif";
var SO = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sC(s) { return { CRITICAL: T.cr, HIGH: T.hi, MEDIUM: T.md, LOW: T.lo }[s] || T.dm; }
function sB(s) { return { CRITICAL: T.cb, HIGH: T.hb, MEDIUM: T.mb, LOW: T.lb }[s] || "transparent"; }
function gC(g) { return { FAIL: T.cr, REVIEW: T.hi, CAUTION: T.hi, PASS: T.ok }[g] || T.dm; }

// -- Section ordering: maps rule categories to form sections --
var SECTIONS = {
  ARCH: { order: 0, label: "Document Architecture" },
  MANDATORY: { order: 1, label: "Reg. 4.3 Mandatory Fields" },
  BRK: { order: 2, label: "Brokerage Obligations (Page 1)" },
  CHECKBOX: { order: 3, label: "Checkbox Validation" },
  VALID: { order: 4, label: "Sec 2: Property Validation" },
  CAP: { order: 5, label: "Sec 1: Party Capacity" },
  SD: { order: 6, label: "RESA s.30: Self-Dealing" },
  MORTGAGE: { order: 7, label: "Sec 4: Purchase Price / Mortgage" },
  DEP: { order: 8, label: "Sec 5: Deposit" },
  PDS: { order: 9, label: "Sec 6: Property Disclosure Statement" },
  COND: { order: 10, label: "Sec 7: Conditions" },
  WAR: { order: 11, label: "Sec 9: Seller Representations & Warranties" },
  NONE: { order: 12, label: "Sec 9-10: Blank Fields" },
  TIME: { order: 13, label: "Timeline Validation" },
  STAT: { order: 14, label: "Sec 12-13: Homestead & Residency" },
  REM: { order: 15, label: "Sec 14: Seller Remuneration" },
  EXEC: { order: 16, label: "Sec 15-16: Seller Response & Execution" },
  CLOSE: { order: 17, label: "Sec 18: Conveyancing" },
  SCH: { order: 18, label: "Sec 10.2: Schedules" },
  REG: { order: 19, label: "Regulatory (FINTRAC)" },
  AMEND: { order: 20, label: "Amendments" },
  CONF: { order: 21, label: "AI Extraction Confidence" }
};
function sectionSort(a, b) {
  var sa = (SECTIONS[a.cat] || { order: 99 }).order;
  var sb = (SECTIONS[b.cat] || { order: 99 }).order;
  if (sa !== sb) return sa - sb;
  return SO[a.sev] - SO[b.sev];
}

// -- Context definitions --
var SELLER_ONLY = ["w", "lp"];
var PRE_RESPONSE = ["w", "lp"];
var WRITING_ONLY = ["w"];

// -- Shared prompt components --
var SHARED_RULES = [
  "Be EXTREMELY LITERAL. Only report values VISIBLY WRITTEN on the document.",
  "Empty blanks = empty string. Never infer. Never guess. Never fill in assumed values.",
  "",
  "RULES:",
  "- Checkboxes: checked ONLY if visible mark (X, checkmark, filled box) IN the box boundary. Empty box = not checked.",
  "- CRITICAL - BROKERAGE OBLIGATIONS PAGE: The representation checkboxes (a) and (b) are SEPARATE from the initial boxes below them. Handwritten initials in the 'Initials' boxes are NOT checkbox marks. Do NOT confuse ink from an initial that is near a checkbox with the checkbox being checked. A checkbox is checked ONLY if there is a deliberate mark INSIDE the small square box next to (a) or (b). The initial boxes are BELOW the checkboxes and are labeled 'Initials (Buyer)' or 'Initials (Seller)' or 'Initials (Buyer brokerage representative)' etc. Ink in those labeled initial boxes does NOT mean checkbox (b) is checked. Look ONLY at the small square boxes next to the text '(a) only the Buyer...' and '(b) both parties...' for checkbox status.",
  "- Conditions 7.1(a),(b),(c): filled=true ONLY if actual time AND date are written in the blanks.",
  "- Money fields: only numbers visibly written after $. If blank after $ = empty string.",
  "- If NONE or None is written as text, return that text exactly. This is different from an empty string.",
  "- Section 16: only mark buyerCounterResponse if seller ACTUALLY countered in Section 15 Box 3.",
  "- Legal description: report EXACTLY as written even if it looks wrong.",
  "- For crossed-out or struck-through values with replacement text nearby, report both in _amendments array.",
  "- Count total PDF pages and report as _pageCount.",
  "- If Section 15 Box 3 is checked (counter), look for counter terms in Section 15 AND in Schedule 2 if referenced.",
  "- For Section 7.1(b), report BOTH the filled status AND the mortgage amount written on that condition line separately as cond7b_conditionAmt.",
  "- The X mark next to a.m./p.m. indicates which is selected.",
  "",
  "CRITICAL - PURCHASE PRICE EXTRACTION:",
  "- The purchase price is in Section 4 of PART ONE, on the line labeled 'Purchase price:' followed by '$ ___'.",
  "- Read ONLY the number written on THAT specific line after the $ sign.",
  "- Do NOT confuse with: mortgage amounts, deposit amounts, condo corporation numbers, parking stall numbers, locker numbers, common element shares, or any other number on the page.",
  "- Return as number only, no commas, no $. e.g. 259000",
  "- If the price appears to have been crossed out and rewritten, report the CURRENT (replacement) value as purchasePrice and include both in _amendments.",
  "",
  "CRITICAL - COUNTER-OFFER PRICE:",
  "- If Section 15 Box 3 is checked (counter), the seller may have changed the purchase price.",
  "- Look for a new dollar amount in the counter-offer terms (Section 15 counter lines OR Schedule 2).",
  "- If you find a different price in the counter terms, return it as counterOfferPrice (number only, no $ or commas).",
  "- The counterOfferPrice is the EFFECTIVE selling price when the buyer accepts the counter.",
  "",
  "CRITICAL - TIMESTAMP EXTRACTION:",
  "- Read dates and times ONLY from the FORM FIELDS (handwritten or typed values in the blanks).",
  "- Do NOT read DocuSign envelope metadata, DocuSign timestamps (e.g. '21 March 2026 | 3:12 PM PDT'), or electronic signing platform dates as form field values.",
  "- DocuSign metadata appears at the top of pages or near signature stamps. These are NOT the offer dates.",
  "- Section 11 'Signed and dated at ___ a.m./p.m. on ___' - read the TIME and DATE written IN the blanks.",
  "- Section 15 'Signed and dated at ___ a.m./p.m. on ___' - read the TIME and DATE written IN the blanks.",
  "- For irrevocability, read 'open for acceptance by the Seller until ___ a.m./p.m. on ___' from the form blanks.",
  "",
  "CRITICAL - MORTGAGE AMOUNT:",
  "- Mortgage approximate amount in Section 4: return as number. Also check 7.1(b) for a separate mortgage amount.",
  "- The mortgage amount is on the line that says 'the approximate amount to be paid from the proceeds of a new mortgage is: $___'.",
  "- Do NOT confuse with purchase price, deposit amounts, or any other number.",
  "",
  "CRITICAL DISTINCTION for section9Amendments:",
  "- Section 9 of PART ONE has a field labeled 'The additions, exclusions or amendments to the representations and warranties in section 9 of PART TWO are as follows:'",
  "- This is a HIGH-PRIORITY field. Transcribe EXACTLY and COMPLETELY everything written there.",
  "- If it says 'NONE', 'None', 'N/A', return that exact text.",
  "- If it contains ANY other text — even a single phrase, clause reference, or handwritten note — return ALL of it verbatim.",
  "- Look carefully for handwritten text, typed additions, or any markings in this area. Even partial or hard-to-read text should be transcribed.",
  "- Do NOT return the standard warranty text from PART TWO. Part Two Section 9 is boilerplate — ignore it entirely.",
  "- ONLY look at the PART ONE page with this field.",
  "- If the lines appear completely blank with no visible writing, return empty string.",
  "",
  "CRITICAL DISTINCTION for residency (Section 13):",
  "- Box 1: 'will NOT be a non-resident' = seller IS resident. Return 'resident'.",
  "- Box 2: 'WILL BE a non-resident' = seller IS NOT resident. Return 'non_resident'.",
  "- If neither box is checked, return 'none_selected'.",
  "",
  "CRITICAL DISTINCTION for homestead (Section 12):",
  "- Box 1: 'is NOT a homestead' = return 'not_homestead'",
  "- Box 2: 'IS a homestead...registered in names of both' = return 'both_on_title'",
  "- Box 3: 'IS a homestead...NOT registered in the name of' = return 'not_on_title'",
  "- If neither box is checked, return 'none_selected'.",
  "",
  "CRITICAL - SIGNATURE AND INITIAL DETECTION:",
  "- A SIGNATURE is a handwritten mark, DocuSign digital signature stamp, or e-signature indicator on or near a signature line.",
  "- A typed or printed name alone (e.g. 'A. Litz Construction Ltd.' printed on the Seller line) is NOT a signature. Names are often PRINTED below signature lines as identification. This does NOT count as signing.",
  "- DocuSign signatures are DISTINCT: they show 'DocuSigned by:' with a stylized handwriting-like mark and a hex ID (e.g. '521FFC2D57E44DC...'). If you see this pattern, it IS a signature.",
  "- If you see ONLY a typed/printed name with NO handwriting mark, NO DocuSign stamp, NO e-signature indicator above or on the signature line, return false for that signature field.",
  "- INITIALS are small marks (handwritten, stamps, or DocuSign initial stamps) in the initial boxes on the Brokerage Obligations page.",
  "- On the SELLER side of page 1, check EACH initial box next to (a) and (b). If the boxes are empty (no mark inside), sellerInitialsP1 = false.",
  "- CHECK EACH SIGNATURE LOCATION INDEPENDENTLY:",
  "  1. Part One Section 11 area - Buyer signature line -> buyerSigP1",
  "  2. Part One Section 15 area - Seller signature line -> sellerSigP1",
  "  3. Part Two LAST page - Buyer signature line -> buyerSigP2",
  "  4. Part Two LAST page - Seller signature line -> sellerSigP2",
  "  5. Page 1 buyer initial boxes -> buyerInitialsP1",
  "  6. Page 1 seller initial boxes -> sellerInitialsP1",
  "  7. Page 1 BOTTOM - buyer brokerage rep: look at the 'Signature:' line UNDER 'Buyer brokerage representative:' Name line. ANY handwritten mark or scrawl on or near that line = true -> buyerBrkRepSig",
  "  8. Page 1 BOTTOM - seller brokerage rep: look at the 'Signature:' line UNDER 'Seller brokerage representative:' Name line. ANY handwritten mark or scrawl on or near that line = true -> sellerBrkRepSig",
  "- For items 7 and 8: The brokerage rep signatures are at the BOTTOM of page 1, below the Self-Dealing Disclosure section. There is a 'Name:' line and a 'Signature:' line for EACH side. A quick scrawl, initials, or any ink mark on the signature line counts as signed. Do NOT confuse the printed Name with the Signature - they are separate lines.",
].join("\n");

var SHARED_KEYS = [
  "",
  "buyerName1 buyerName2 sellerName1 sellerName2",
  "buyerBrokerage sellerBrokerage buyerRep sellerRep",
  "buyerRepPhone sellerRepPhone buyerRepEmail sellerRepEmail",
  "buyerRepType(buyer_only|both|none) sellerRepType(seller_only|both|none)",
  "civicAddress legalDescription excludedFixtures includedChattels",
  "possessionDate purchasePrice(number only)",
  "mortgageBox(yes|no|both|unclear) mortgageAmount(number or empty)",
  "existingMortgageBox(yes|no|unclear)",
  "depositAmount1 depositAmount2 depositAmount3",
  "depositDeliveryDate depositMethods(array of checked methods as strings)",
  "pdsChoice(box1_condition|box2_provided|box3_not_required|none_selected)",
  "cond7a_filled(bool) cond7a_time cond7a_date",
  "cond7b_filled(bool) cond7b_time cond7b_date cond7b_mortgageAmt cond7b_conditionAmt",
  "cond7c_filled(bool) cond7c_time cond7c_date",
  "cond7d_otherConditions cond72_sellerConditions",
  "section9Amendments(ONLY text written in Part One Section 9 field, NOT Part Two boilerplate)",
  "section10AdditionalTerms",
  "schedule1_PDS(bool) schedule2_AdditionalTerms(bool)",
  "schedule3_MortgageAssumption(bool) schedule4_Other(bool) schedule4_Description",
  "irrevocability(full timestamp string e.g. '11 PM on March 5, 2026')",
  "offerSigned(full timestamp string)",
  "buyerAddress",
  "homestead(not_homestead|both_on_title|not_on_title|none_selected|deleted)",
  "homesteadSpouseName",
  "residency(resident|non_resident|none_selected|deleted)",
  "remunerationPct remunerationSeries remunerationFixedSum",
  "sellerResponse(accepts|rejects|counters|none)",
  "counterOfferTerms counterOfferScheduleRef(bool if 'see schedule 2' or similar)",
  "counterOfferPrice(number only - if counter-offer changes the purchase price, extract the NEW price here. If no price change in counter, return empty string.)",
  "sellerCounterDeadline(full timestamp)",
  "sellerSigned(full timestamp)",
  "sellerAddress",
  "buyerCounterResponse(accepts|rejects|none)",
  "buyerCounterSigned(full timestamp or empty)",
  "buyerSolicitor buyerSolicitorFirm buyerSolicitorPhone buyerSolicitorEmail",
  "sellerSolicitor sellerSolicitorFirm sellerSolicitorPhone sellerSolicitorEmail",
  "hasPartTwo(bool)",
  "schedule2Content(full text of Schedule 2 if visible, otherwise empty)",
  "",
  "SIGNATURE FIELDS:",
  "buyerSigP1(bool - actual signature mark on Part One Section 11, not just printed name)",
  "sellerSigP1(bool - actual signature mark on Part One Section 15, not just printed name)",
  "buyerSigP2(bool - actual signature mark on Part Two last page)",
  "sellerSigP2(bool - actual signature mark on Part Two last page)",
  "buyerInitialsP1(bool - initials in buyer initial boxes on Brokerage Obligations page)",
  "sellerInitialsP1(bool - initials in seller initial boxes on Brokerage Obligations page)",
  "buyerBrkRepSig(bool - buyer brokerage rep signature on page 1)",
  "sellerBrkRepSig(bool - seller brokerage rep signature on page 1)",
  "",
  "PART TWO AMENDMENT DETECTION:",
  "THIS IS CRITICAL. Part Two is a PRESCRIBED STATUTORY FORM that must NOT be modified. Any alteration is a compliance violation.",
  "_partTwoModified(bool): Scan EVERY page of Part Two with extreme care. Look for ANY of the following:",
  "  - Crossed-out text, strikethrough lines, or scribble lines over printed text",
  "  - Handwritten additions, margin notes, or inserted text anywhere",
  "  - Whiteout, correction tape, or overwritten text",
  "  - Initialed changes or marginal annotations",
  "  - Deleted clauses, sections, or paragraphs",
  "  - Any ink mark that is NOT a buyer/seller signature on the LAST page of Part Two",
  "  - Any ink mark that is NOT a buyer/seller signature at the very end (Section 19 signature lines)",
  "The ONLY acceptable marks on Part Two are buyer and seller signatures on the FINAL signature page (Section 19).",
  "If you see ANY other mark, annotation, crossing-out, or handwriting on ANY Part Two page, return true.",
  "When in doubt, return true. False negatives on Part Two modifications are dangerous.",
  "_partTwoModDetails(string): If _partTwoModified is true, describe EXACTLY what you see and on which page/section. If false, return empty string.",
  "",
  "_pageCount(integer total pages in PDF)",
  "",
  "ATTACHED DOCUMENT DETECTION:",
  "_attachedDocs: Scan the title/header of EVERY page in the PDF. Report an array of objects for each distinct document you find beyond Part One and Part Two.",
  "For each document found, return: {type, title, pageNumbers}",
  "  type values: 'pds' | 'schedule2' | 'schedule3' | 'schedule4' | 'addendum' | 'amendment' | 'condition_removal' | 'other'",
  "  title: the actual title text visible on the page (e.g. 'PROPERTY DISCLOSURE STATEMENT', 'SCHEDULE 2 - Additional Terms')",
  "  pageNumbers: array of page numbers this document spans (e.g. [12,13,14,15])",
  "Look for these specific headers:",
  "  - 'PROPERTY DISCLOSURE STATEMENT' or 'SCHEDULE 1' -> type: 'pds'",
  "  - 'SCHEDULE 2' or 'ADDITIONAL TERMS AND CONDITIONS' -> type: 'schedule2'",
  "  - 'SCHEDULE 3' or 'ASSUMPTION OF MORTGAGE' -> type: 'schedule3'",
  "  - 'SCHEDULE 4' -> type: 'schedule4'",
  "  - 'ADDENDUM' or 'AMENDMENT' -> type: 'addendum' or 'amendment'",
  "  - 'CONDITION REMOVAL' or 'WAIVER' or 'NOTICE OF FULFILLMENT' -> type: 'condition_removal'",
  "  - Any other titled document not Part One or Part Two -> type: 'other'",
  "If no additional documents are found beyond Part One and Part Two, return an empty array [].",
  "Do NOT include Part One pages or Part Two pages in this list.",
  "",
  "PROPERTY DISCLOSURE STATEMENT VALIDATION:",
  "If a Property Disclosure Statement is detected in the PDF, examine it carefully and report:",
  "_pdsCompleted(bool): Are the checkbox columns (CORRECT / NOT CORRECT / DO NOT KNOW) actually filled in?",
  "  Look at the table rows (items 2 through 24). If check marks or initials appear in the checkbox columns for most items, return true.",
  "  If the checkbox columns are entirely blank or only 1-2 items are marked, return false. This indicates a blank/incomplete PDS.",
  "_pdsNotCorrectItems(array of integers): List the item numbers where 'NOT CORRECT' is checked (e.g. [9, 14, 22]).",
  "  If none are checked as NOT CORRECT, return empty array [].",
  "_pdsDoNotKnowItems(array of integers): List the item numbers where 'DO NOT KNOW' is checked.",
  "  If none, return empty array [].",
  "_pdsExplanationsPresent(bool): If any items are marked NOT CORRECT or DO NOT KNOW, is there text written in the 'Explanations' section? true if explanations are provided, false if the Explanations area is blank despite NOT CORRECT or DO NOT KNOW being checked.",
  "_pdsSellerSigned(bool): Is there a seller signature on the PDS 'Acknowledgement and Agreement by Seller' page?",
  "  Look for a handwritten mark, DocuSign stamp, or any signature on the 'Seller' signature lines at the bottom of the acknowledgement page.",
  "  A printed name alone is NOT a signature. Return true ONLY if an actual signature mark is present.",
  "_pdsBuyerSigned(bool): Is there a buyer signature on the PDS 'Acknowledgement by Buyer' section?",
  "  This is at the very bottom of the PDS, below the seller acknowledgement. Look for signature marks on the 'Buyer' lines.",
  "  Return true ONLY if an actual signature mark is present.",
  "_pdsBuyerSignedDate(string): The date written on the line 'Date this Property Disclosure Statement is signed by the Buyer:'. Return the date as written, or empty string if blank.",
  "If NO Property Disclosure Statement is detected in the PDF, return false for all _pds fields and empty arrays for the item lists.",
  "",
  "_confidence: {buyerName sellerName purchasePrice possessionDate mortgageBox homestead residency sellerResponse conditions legalDescription: each high|medium|low}",
  "_amendments: [{field original amended}] for any crossed-out values with replacements",
  "_partyCapacity: {buyerCapacity sellerCapacity} values: Executor|POA|Trustee|Corporation or empty string",
  "",
  "CRITICAL: If a field has no visible value written, return empty string. Do NOT infer or assume."
].join("\n");

// -- Residential Prompt --
var RES_PROMPT = [
  "Extract ALL fields from this Manitoba RESIDENTIAL Offer to Purchase (Nov 2025 statutory form).",
  SHARED_RULES,
  "",
  "Return ONLY a JSON object. No markdown fences. No explanation. Keys:",
  SHARED_KEYS
].join("\n");

// -- Condo Prompt --
var CONDO_PROMPT = [
  "Extract ALL fields from this Manitoba CONDOMINIUM UNIT Offer to Purchase Contract (Nov 2025 statutory form).",
  "",
  "THIS IS A CONDO FORM. It has MORE numeric fields than a residential form. You MUST read each number from its EXACT labeled line.",
  "",
  "CONDO FORM FIELD MAP - read each from its LABELED position:",
  "- Page 2, Section 2 'The Unit':",
  "  - 'Civic address:' line -> civicAddress (e.g. '309 230 Bonner Avenue Winnipeg MB R2G1B2')",
  "  - 'Unit No.' line -> condoUnitNumber (e.g. 45)",
  "  - 'the condominium project known as' -> condoProjectName (e.g. 'Bunn's Creek Condominiums')",
  "  - 'Condominium Corporation No.' -> condoCorpNumber (e.g. 969). This is a SMALL number, NOT the purchase price.",
  "  - 'An undivided ___ %' -> commonElementShare (e.g. 0.95). This is a DECIMAL, NOT a price.",
  "  - 'Parking stall(s) No.(s):' -> parkingStall",
  "  - 'Locker/storage:' -> lockerStorage",
  "- Page 3, Section 4 'Purchase Price':",
  "  - 'Purchase price:  $___' -> purchasePrice. This is the ONLY large dollar amount in Section 4.",
  "  - It is on the line IMMEDIATELY after the 'Purchase Price' section header.",
  "  - SANITY CHECK: The purchase price is typically $100,000-$2,000,000. If you read a number outside this range, re-examine the line.",
  "  - Do NOT read the Condominium Corporation number (a 3-4 digit number), the common element share (a decimal like 0.95), the parking stall number, or the locker number as the price.",
  "  - 'approximate amount to be paid from proceeds of a new mortgage: $___' -> mortgageAmount. This is BELOW the price line.",
  "- Page 3, Section 5 'Deposit' -> depositAmount1, depositAmount2, etc.",
  "",
  SHARED_RULES,
  "",
  "Return ONLY a JSON object. No markdown fences. No explanation. Keys:",
  "condoUnitNumber condoProjectName condoCorpNumber",
  "commonElementShare parkingStall lockerStorage",
  SHARED_KEYS
].join("\n");

function getPrompt(formType) {
  return formType === "condo" ? CONDO_PROMPT : RES_PROMPT;
}

// ====================================================================
// PDF EXTRACTION
// ====================================================================
function extractOffer(file, formType, onProg) {
  return new Promise(function(resolve, reject) {
    onProg("Reading PDF...");
    var reader = new FileReader();
    reader.onerror = function() { reject(new Error("File read failed")); };
    reader.onload = function() {
      var b64 = reader.result.split(",")[1];
      var sizeMB = (b64.length * 0.75 / 1048576).toFixed(1);
      onProg("Sending " + sizeMB + "MB PDF for analysis...");
      fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 6000,
          messages: [{ role: "user", content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: getPrompt(formType) }
          ]}]
        })
      }).then(function(resp) {
        onProg("Processing response...");
        if (!resp.ok) return resp.text().then(function(t) { throw new Error("API " + resp.status + ": " + t.substring(0, 300)); });
        return resp.json();
      }).then(function(data) {
        onProg("Parsing extraction...");
        var text = "";
        (data.content || []).forEach(function(c) { text += (c.text || ""); });
        if (!text) throw new Error("Empty response. stop_reason: " + (data.stop_reason || "?"));
        var tick = String.fromCharCode(96);
        var cleaned = text.split(tick + tick + tick + "json").join("").split(tick + tick + tick).join("").trim();
        var si = cleaned.indexOf("{");
        if (si === -1) throw new Error("No JSON in response. Raw: " + text.substring(0, 300));
        var depth = 0, ei = -1;
        for (var i = si; i < cleaned.length; i++) {
          if (cleaned[i] === "{") depth++;
          if (cleaned[i] === "}") { depth--; if (depth === 0) { ei = i + 1; break; } }
        }
        if (ei === -1) throw new Error("Truncated JSON (" + cleaned.length + " chars). stop_reason: " + (data.stop_reason || "?"));
        var fields = JSON.parse(cleaned.substring(si, ei));
        fields._raw = text.substring(0, 2000);
        try { fields = normalizeFields(fields); } catch (e) { fields._normError = e.message; }
        resolve({ fields: fields });
      }).catch(reject);
    };
    reader.readAsDataURL(file);
  });
}

// ====================================================================
// DATE/TIME PARSING
// ====================================================================
function pts(s) {
  if (!s || s.length < 3) return null;
  var moMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // Try time formats in order: "11:59PM", "1159PM", "11PM", "6pm"
  var tm = s.match(/(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (!tm) tm = s.match(/(\d{1,2})(\d{2})\s*(am|pm|a\.m\.|p\.m\.)/i);
  if (!tm) {
    var tm3 = s.match(/(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/i);
    if (tm3) tm = [tm3[0], tm3[1], null, tm3[2]];
  }
  var h = 12, mn = 0;
  if (tm) {
    h = parseInt(tm[1]); mn = parseInt(tm[2] || "0");
    if (/pm|p\.m\./i.test(tm[3]) && h < 12) h += 12;
    if (/am|a\.m\./i.test(tm[3]) && h === 12) h = 0;
  }
  var dm = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[,\/]?\s*(?:20)?(\d{2}))?/i);
  if (!dm) {
    dm = s.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/);
    if (dm) {
      var m2 = parseInt(dm[1]), dy2 = parseInt(dm[2]), yr2 = parseInt(dm[3]);
      if (yr2 < 100) yr2 += 2000;
      if (m2 && dy2) return ((yr2 * 12 + m2) * 31 + dy2) * 1440 + h * 60 + mn;
    }
    return null;
  }
  var m = moMap[dm[1].toLowerCase().substring(0, 3)];
  var dy = parseInt(dm[2]);
  var yr = parseInt(dm[3] || String(new Date().getFullYear() % 100));
  if (yr < 100) yr += 2000;
  if (!m || !dy) return null;
  return ((yr * 12 + m) * 31 + dy) * 1440 + h * 60 + mn;
}
function tc(a, b) { return (a == null || b == null) ? null : a - b; }

// ====================================================================
// FIELD NORMALIZATION
// ====================================================================
function normalizeFields(f) {
  f.buyerName = [f.buyerName1, f.buyerName2].filter(Boolean).join(" and ");
  f.sellerName = [f.sellerName1, f.sellerName2].filter(Boolean).join(" and ");
  f.propAddr = f.civicAddress || f.legalDescription || "";
  f.depositAmounts = [f.depositAmount1, f.depositAmount2, f.depositAmount3].filter(Boolean);
  f.depositTotal = f.depositAmounts.join(" / ");
  f.hasDepositMethod = (f.depositMethods || []).length > 0;
  f.depositCheque = (f.depositMethods || []).some(function(m) { return /^cheque$/i.test(m); });
  f.depositCertCheque = (f.depositMethods || []).some(function(m) { return /certified/i.test(m); });
  f.depositCash = (f.depositMethods || []).some(function(m) { return /^cash$/i.test(m); });
  f.hasRem = !!(f.remunerationPct || (f.remunerationSeries && !/N\/A|none/i.test(f.remunerationSeries)) || f.remunerationFixedSum);

  // Effective selling price: counter-offer price overrides original when accepted
  f._counterPrice = f.counterOfferPrice ? parseFloat(String(f.counterOfferPrice).replace(/[,$]/g, "")) : null;
  f._hasCounterPrice = f.sellerResponse === "counters" && f.buyerCounterResponse === "accepts" && f._counterPrice && !isNaN(f._counterPrice);
  f.effectivePrice = f._hasCounterPrice ? String(f._counterPrice) : (f.purchasePrice || "");

  // Warranty text: Section 9 Part One vs broader text
  var s9 = (f.section9Amendments || "").toLowerCase();
  var s2c = (f.schedule2Content || "").toLowerCase();
  var s10 = (f.section10AdditionalTerms || "").toLowerCase();
  var s9clean = /^none\.?$/i.test(s9.trim()) ? "" : s9;
  var s10clean = /^none\.?$/i.test(s10.trim()) ? "" : s10;
  f.s9only = s9clean.trim();
  f.allWar = (s9clean + " " + s2c + " " + s10clean).trim();

  // Shared warranty detection (used by rules AND buildSummary)
  var wt = f.allWar;
  var s9o = f.s9only;
  f._warParts = [];
  if (/9\s*\(?a\)/i.test(wt) || (s9o.length > 4 && /encroach/i.test(s9o))) f._warParts.push("9(a)");
  if (/9\s*\(?c\)/i.test(wt) || (s9o.length > 4 && /zoning/i.test(s9o))) f._warParts.push("9(c) zoning");
  if (/9\s*\(?d\)/i.test(wt) || (s9o.length > 4 && /permit/i.test(s9o))) f._warParts.push("9(d) permits");
  if (/9\s*\(?g\)/i.test(wt) || (s9o.length > 4 && /working\s*order/i.test(s9o))) f._warParts.push("9(g) working order");
  f._warCount = f._warParts.length;
  f._hasAsIs = (s9o.length > 4 && /as[\s-]*is/i.test(s9o)) || /as[\s-]*is/i.test(s2c);

  f.buyerRepOnly = f.buyerRepType === "buyer_only";
  f.sellerRepOnly = f.sellerRepType === "seller_only";
  var co = f._confidence || {};
  f._lo = Object.keys(co).filter(function(k) { return co[k] === "low"; });
  f._md = Object.keys(co).filter(function(k) { return co[k] === "medium"; });
  f._am = f._amendments || [];
  f.hasAm = f._am.length > 0;
  var cap = f._partyCapacity || {};
  f.bCap = cap.buyerCapacity || "";
  f.sCap = cap.sellerCapacity || "";

  // Legal description validation (includes condo unit numbers)
  f.ldOk = false;
  f.isCondo = f.formType === "condo_unit";
  if (f.legalDescription) {
    var ld = f.legalDescription.toUpperCase();
    f.ldOk = /^LBP\s/.test(ld) || /LOT\s+\d/.test(ld) || /BLOCK\s+\d/.test(ld) || /PLAN\s+\d/.test(ld) || /^\d+\s+\d+\s+\d+/.test(ld) || /PARISH/.test(ld) || /UNIT\s*(NO\.?)?\s*\d/i.test(ld) || ld.length === 0;
  }

  f.bigCash = f.depositCash && parseFloat(f.depositAmount1 || "0") >= 10000;
  f._pages = f._pageCount || 0;

  // Timestamps
  f._ts = {};
  ["offerSigned", "irrevocability", "sellerSigned", "sellerCounterDeadline", "buyerCounterSigned", "possessionDate"].forEach(function(k) { f._ts[k] = pts(f[k]); });
  f._ts.cond7a = pts((f.cond7a_time || "") + " " + (f.cond7a_date || ""));
  f._ts.cond7b = pts((f.cond7b_time || "") + " " + (f.cond7b_date || ""));
  f._ts.cond7c = pts((f.cond7c_time || "") + " " + (f.cond7c_date || ""));

  // Deposit total
  f._depTotal = 0;
  f.depositAmounts.forEach(function(d) {
    var n = parseFloat(String(d).replace(/[,$]/g, ""));
    if (!isNaN(n)) f._depTotal += n;
  });

  // Signature normalization
  f._sigBuyerP1 = !!f.buyerSigP1;
  f._sigSellerP1 = !!f.sellerSigP1;
  f._sigBuyerP2 = !!f.buyerSigP2;
  f._sigSellerP2 = !!f.sellerSigP2;
  f._initBuyer = !!f.buyerInitialsP1;
  f._initSeller = !!f.sellerInitialsP1;
  f._sigBuyerBrkRep = !!f.buyerBrkRepSig;
  f._sigSellerBrkRep = !!f.sellerBrkRepSig;

  // Condo normalization
  f._isCondo = !!(f.condoUnitNumber || f.condoProjectName || f.condoCorpNumber);
  if (f._isCondo) {
    f._condoDesc = "Unit " + (f.condoUnitNumber || "?") + ", " + (f.condoProjectName || "?") + " (Corp #" + (f.condoCorpNumber || "?") + ")";
    var ces = parseFloat(f.commonElementShare || "0");
    f._cesValid = ces > 0 && ces <= 100;
  }

  // Attached document detection
  var docs = f._attachedDocs || [];
  f._detectedPDS = docs.some(function(d) { return d.type === "pds"; });
  f._detectedSch2 = docs.some(function(d) { return d.type === "schedule2"; });
  f._detectedSch3 = docs.some(function(d) { return d.type === "schedule3"; });
  f._detectedSch4 = docs.some(function(d) { return d.type === "schedule4"; });
  f._detectedAddendum = docs.some(function(d) { return d.type === "addendum" || d.type === "amendment"; });
  f._detectedCondRemoval = docs.some(function(d) { return d.type === "condition_removal"; });
  f._docSummary = docs.map(function(d) { return d.title || d.type; });

  // PDS validation (only relevant if PDS is detected)
  f._pdsPresent = f._detectedPDS;
  f._pdsIsComplete = f._pdsPresent && !!f._pdsCompleted;
  f._pdsSellerOk = f._pdsPresent && !!f._pdsSellerSigned;
  f._pdsBuyerOk = f._pdsPresent && !!f._pdsBuyerSigned;
  f._pdsNotCorrect = (f._pdsNotCorrectItems || []);
  f._pdsDoNotKnow = (f._pdsDoNotKnowItems || []);
  f._pdsHasDisclosures = f._pdsNotCorrect.length > 0 || f._pdsDoNotKnow.length > 0;
  f._pdsExplOk = !f._pdsHasDisclosures || !!f._pdsExplanationsPresent;

  return f;
}

// ====================================================================
// RULE ENGINE (98 rules)
// ====================================================================
var RULES = [
  // === DOCUMENT ARCHITECTURE (4) ===
  { id: "DOC-001", cat: "ARCH", check: "Part Two Present", sev: "HIGH",
    test: function(f) { return !f.hasPartTwo; }, msg: "Part Two not detected in document." },
  { id: "DOC-002", cat: "ARCH", check: "Part Two Modified", sev: "CRITICAL",
    test: function(f) { return !!f._partTwoModified; },
    msg: function(f) { return "CRITICAL: Part Two has been physically amended. Part Two is immutable. All amendments must be made through Part One Sections 9 or 10." + (f._partTwoModDetails ? " Detail: " + f._partTwoModDetails : ""); } },
  { id: "DOC-003", cat: "ARCH", check: "Page Count", sev: "MEDIUM",
    test: function(f) { return f._pages > 0 && f._pages < 7; },
    msg: function(f) { return "Only " + f._pages + " pages. Expect 11+ for complete offer with Part Two."; } },
  // DOC-004 removed: signature verification now handled by SIG-001 through SIG-008

  // === REG 4.3 MANDATORY FIELDS (11) ===
  { id: "R43-001", cat: "MANDATORY", check: "Offer Date", sev: "CRITICAL",
    test: function(f) { return !f.offerSigned && !f.irrevocability; }, msg: "No offer date or irrevocability found." },
  { id: "R43-002", cat: "MANDATORY", check: "Buyer Name", sev: "CRITICAL",
    test: function(f) { return !f.buyerName; }, msg: "Buyer name missing." },
  { id: "R43-003", cat: "MANDATORY", check: "Seller Name", sev: "CRITICAL",
    test: function(f) { return !f.sellerName; }, msg: "Seller name missing." },
  { id: "R43-004", cat: "MANDATORY", check: "Buyer Address", sev: "HIGH",
    test: function(f) { return !f.buyerAddress; }, msg: "Buyer address missing." },
  { id: "R43-005", cat: "MANDATORY", check: "Property ID", sev: "CRITICAL",
    test: function(f) { return !f.civicAddress && !f.legalDescription; }, msg: "No civic address or legal description." },
  { id: "R43-006", cat: "MANDATORY", check: "Purchase Price", sev: "CRITICAL",
    test: function(f) { return !f.purchasePrice; }, msg: "Purchase price missing." },
  { id: "R43-007", cat: "MANDATORY", check: "Deposit", sev: "HIGH",
    test: function(f) { return f.depositAmounts.length === 0; }, msg: "No deposit amount specified." },
  { id: "R43-008", cat: "MANDATORY", check: "Deposit Method", sev: "MEDIUM",
    test: function(f) { return f.depositAmounts.length > 0 && !f.hasDepositMethod; }, msg: "Deposit specified but no delivery method checked." },
  { id: "R43-009", cat: "MANDATORY", check: "Possession Date", sev: "CRITICAL",
    test: function(f) { return !f.possessionDate; }, msg: "Possession date missing." },
  { id: "R43-010", cat: "MANDATORY", check: "Irrevocability", sev: "HIGH",
    test: function(f) { return !f.irrevocability; }, msg: "Irrevocability deadline missing." },
  { id: "R43-011", cat: "MANDATORY", check: "Brokerage ID", sev: "CRITICAL",
    test: function(f) { return !f.buyerBrokerage && !f.sellerBrokerage; }, msg: "No brokerage identified." },

  // === CHECKBOX VALIDATION (4) ===
  { id: "CHK-001", cat: "CHECKBOX", check: "Mortgage Contradiction", sev: "CRITICAL",
    test: function(f) { return f.mortgageBox === "both"; }, msg: "Both Yes AND No checked for mortgage." },
  { id: "CHK-002", cat: "CHECKBOX", check: "Seller Response Contradiction", sev: "CRITICAL", skip: PRE_RESPONSE,
    test: function(f) { return f.sellerResponse === "both" || f.sellerResponse === "contradictory"; }, msg: "Multiple seller response boxes checked." },
  { id: "CHK-003", cat: "CHECKBOX", check: "Representation Conflict", sev: "CRITICAL",
    test: function(f) { return f.buyerRepType === "both" && f.sellerRepType === "both"; }, msg: "Both brokerages claim to represent both parties." },
  // CHK-004 removed: duplicate of PDS-004

  // === MORTGAGE DEPENDENCY CHAIN (7) ===
  { id: "MTG-001", cat: "MORTGAGE", check: "Mortgage Unclear", sev: "HIGH",
    test: function(f) { return f.mortgageBox === "unclear"; }, msg: "Cannot determine mortgage selection." },
  { id: "MTG-002", cat: "MORTGAGE", check: "Mortgage Amount Blank", sev: "HIGH",
    test: function(f) { return f.mortgageBox === "yes" && !f.mortgageAmount; }, msg: "Mortgage Yes but approximate amount is blank." },
  { id: "MTG-003", cat: "MORTGAGE", check: "No Financing Condition", sev: "HIGH",
    test: function(f) { return f.mortgageBox === "yes" && !f.cond7b_filled; }, msg: "Mortgage Yes but no financing condition in 7.1(b). Unconditional mortgage offer — verify intentional." },
  { id: "MTG-004", cat: "MORTGAGE", check: "Cash Offer", sev: "MEDIUM",
    test: function(f) { return f.mortgageBox === "no"; }, msg: "Cash offer (no mortgage). No 7-day late payment extension." },
  { id: "MTG-005", cat: "MORTGAGE", check: "Mortgage Exceeds Price", sev: "HIGH",
    test: function(f) { var m = parseFloat(f.mortgageAmount || "0"), p = parseFloat(f.purchasePrice || "0"); return m && p && m > p; }, msg: "Mortgage amount exceeds purchase price." },
  { id: "MTG-006", cat: "MORTGAGE", check: "Mortgage Under 5%", sev: "MEDIUM",
    test: function(f) { var m = parseFloat(f.mortgageAmount || "0"), p = parseFloat(f.purchasePrice || "0"); return m && p && f.mortgageBox === "yes" && m < p * 0.05; }, msg: "Mortgage under 5% of price." },
  { id: "MTG-007", cat: "MORTGAGE", check: "Amount Without Mortgage", sev: "HIGH",
    test: function(f) { return f.mortgageBox === "no" && f.mortgageAmount && parseFloat(f.mortgageAmount) > 0; }, msg: "Mortgage marked No but approximate amount is filled in. Contradiction." },

  // === PDS CHAIN (4) ===
  { id: "PDS-001", cat: "PDS", check: "PDS Void Condition", sev: "HIGH",
    test: function(f) { return f.pdsChoice === "box1_condition" && !f.cond7a_filled; }, msg: "PDS Box 1 but 7.1(a) no deadline. Condition is void." },
  { id: "PDS-002", cat: "PDS", check: "PDS No Schedule", sev: "MEDIUM",
    test: function(f) { return f.pdsChoice === "box2_provided" && !f.schedule1_PDS; }, msg: "PDS Box 2 but Schedule 1 not checked." },
  { id: "PDS-003", cat: "PDS", check: "PDS Prevails 9(g)", sev: "LOW",
    test: function(f) { return f.pdsChoice === "box1_condition" || f.pdsChoice === "box2_provided"; }, msg: "PDS present. Disclosures prevail over 9(g)." },
  { id: "PDS-004", cat: "PDS", check: "No PDS Selection", sev: "LOW",
    test: function(f) { return f.pdsChoice === "none_selected"; }, msg: "No PDS box. Defaults Box 3." },

  // === CONDITIONS (6) ===
  { id: "CND-001", cat: "COND", check: "PDS Cond Info", sev: "LOW",
    test: function(f) { return !f.cond7a_filled && f.pdsChoice !== "box1_condition"; }, msg: "7.1(a) blank. Not part of contract." },
  { id: "CND-002", cat: "COND", check: "Finance Cond Info", sev: "LOW",
    test: function(f) { return !f.cond7b_filled && f.mortgageBox !== "yes"; }, msg: "7.1(b) blank. Not part of contract." },
  { id: "CND-003", cat: "COND", check: "Inspection Cond Info", sev: "LOW",
    test: function(f) { return !f.cond7c_filled; }, msg: "7.1(c) blank. Not part of contract." },
  { id: "CND-004", cat: "COND", check: "Other Conditions Blank", sev: "MEDIUM",
    test: function(f) { var v = f.cond7d_otherConditions || ""; return !v.trim() || v.length < 2; }, msg: "7.1(d) blank. Should state 'None'." },
  { id: "CND-005", cat: "COND", check: "Seller Conditions Blank", sev: "MEDIUM",
    test: function(f) { var v = f.cond72_sellerConditions || ""; return !v.trim() || v.length < 2; }, msg: "7.2 blank. Should state 'None'." },
  { id: "CND-006", cat: "COND", check: "Finance vs Mortgage", sev: "HIGH",
    test: function(f) { return f.cond7b_filled && f.mortgageBox === "no"; }, msg: "Financing condition but mortgage No." },

  // === HOMESTEAD & RESIDENCY (8) ===
  { id: "HS-001", cat: "STAT", check: "Homestead Missing", sev: "CRITICAL", skip: SELLER_ONLY,
    test: function(f) { return f.homestead === "none_selected"; }, msg: "No homestead box checked." },
  { id: "HS-002", cat: "STAT", check: "Homestead Spouse", sev: "HIGH", skip: SELLER_ONLY,
    test: function(f) { return f.homestead === "not_on_title" && !f.homesteadSpouseName; }, msg: "Box 3 but no spouse name." },
  { id: "HS-003", cat: "STAT", check: "Homestead Deleted", sev: "CRITICAL", skip: SELLER_ONLY,
    test: function(f) { return f.homestead === "deleted"; }, msg: "Homestead section deleted. Statutory requirement." },
  { id: "HS-004", cat: "STAT", check: "Form 3 Required", sev: "HIGH", skip: SELLER_ONLY,
    test: function(f) { return f.homestead === "not_on_title"; }, msg: "Form 3 Consent required from spouse not on title." },
  { id: "NR-001", cat: "STAT", check: "Residency Missing", sev: "CRITICAL", skip: SELLER_ONLY,
    test: function(f) { return f.residency === "none_selected"; }, msg: "No residency box checked." },
  { id: "NR-002", cat: "STAT", check: "Non-Resident Seller", sev: "HIGH", skip: SELLER_ONLY,
    test: function(f) { return f.residency === "non_resident"; }, msg: "Non-resident. s.116 clearance required." },
  { id: "NR-003", cat: "STAT", check: "Residency Deleted", sev: "CRITICAL", skip: SELLER_ONLY,
    test: function(f) { return f.residency === "deleted"; }, msg: "Residency section deleted." },
  { id: "NR-004", cat: "STAT", check: "Residency Unclear", sev: "HIGH", skip: SELLER_ONLY,
    test: function(f) { return f.residency === "unclear"; }, msg: "Residency unclear." },

  // === WARRANTIES (5) ===
  { id: "WAR-001", cat: "WAR", check: "9(c) Zoning Amended", sev: "HIGH",
    test: function(f) { return (f._warParts || []).indexOf("9(c) zoning") !== -1; }, msg: "9(c) zoning warranty amended." },
  { id: "WAR-002", cat: "WAR", check: "9(d) Permits Amended", sev: "HIGH",
    test: function(f) { return (f._warParts || []).indexOf("9(d) permits") !== -1; }, msg: "9(d) permits warranty amended." },
  { id: "WAR-003", cat: "WAR", check: "9(g) Working Order", sev: "MEDIUM",
    test: function(f) { return (f._warParts || []).indexOf("9(g) working order") !== -1; }, msg: "9(g) working order amended." },
  { id: "WAR-004", cat: "WAR", check: "Multiple Warranties", sev: "HIGH",
    test: function(f) { return f._warCount >= 2; },
    msg: function(f) { return f._warCount + " warranties amended/excluded."; } },
  { id: "WAR-005", cat: "WAR", check: "As-Is Clause", sev: "HIGH",
    test: function(f) { return f._hasAsIs; }, msg: "As-is clause detected." },
  { id: "WAR-006", cat: "WAR", check: "Sec 9 Warranty Content", sev: "HIGH",
    test: function(f) {
      var s = (f.section9Amendments || "").trim();
      if (!s || s.length < 3) return false;
      if (/^(none|n\/?a|none\s*stated|nil|-+)\.?$/i.test(s)) return false;
      return true;
    },
    msg: function(f) { return "Section 9 contains warranty amendments: " + (f.section9Amendments || "").substring(0, 100) + ". BROKER: Review all additions, exclusions, or amendments to Part Two warranties."; } },

  // === BLANK FIELD RULES (5) ===
  { id: "NON-001", cat: "NONE", check: "Excluded Fixtures Blank", sev: "MEDIUM",
    test: function(f) { return !f.excludedFixtures || f.excludedFixtures.length < 2; }, msg: "Excluded Fixtures blank. Should state 'None'." },
  { id: "NON-002", cat: "NONE", check: "Included Chattels Blank", sev: "MEDIUM",
    test: function(f) { return !f.includedChattels || f.includedChattels.length < 2; }, msg: "Included Chattels blank. Should state 'None'." },
  { id: "NON-003", cat: "NONE", check: "Additional Terms Blank", sev: "MEDIUM",
    test: function(f) { return !f.section10AdditionalTerms || f.section10AdditionalTerms.length < 2; }, msg: "Section 10 blank. Should state 'None'." },
  // NON-004 removed: duplicate of REM-003
  { id: "NON-005", cat: "NONE", check: "Section 9 Blank", sev: "MEDIUM",
    test: function(f) { return !f.section9Amendments || f.section9Amendments.length < 2; }, msg: "Section 9 blank. Should state 'None'." },

  // === REMUNERATION (3) ===
  { id: "REM-001", cat: "REM", check: "Percentage Series", sev: "CRITICAL", skip: SELLER_ONLY,
    test: function(f) { return f.remunerationSeries && f.remunerationSeries.length > 5 && !/N\/A|none/i.test(f.remunerationSeries); }, msg: "Decreasing pct series. Verify Reg 4.9(1.1)." },
  { id: "REM-002", cat: "REM", check: "Difference Commission", sev: "CRITICAL", skip: SELLER_ONLY,
    test: function(f) { var all = (f.remunerationSeries || "") + " " + (f.section10AdditionalTerms || ""); return /difference|net|minus|less\s+buyer/i.test(all); }, msg: "Possible difference-based commission. Prohibited." },
  { id: "REM-003", cat: "REM", check: "Remuneration Missing", sev: "HIGH", skip: SELLER_ONLY,
    test: function(f) { return !f.hasRem; }, msg: "No remuneration in Section 14." },

  // === EXECUTION & SIGNATURES (8) + COUNTER-OFFER (4) ===
  { id: "SIG-001", cat: "EXEC", check: "Buyer Sig Part One", sev: "CRITICAL",
    test: function(f) { return !f._sigBuyerP1; }, msg: "Buyer signature missing on Part One (Section 11)." },
  { id: "SIG-002", cat: "EXEC", check: "Seller Sig Part One", sev: "CRITICAL",
    test: function(f) { return (f.sellerResponse === "accepts" || f.sellerResponse === "counters") && !f._sigSellerP1; }, msg: "CRITICAL: Seller response marked but NO seller signature on Part One. Printed/typed name is NOT a signature. Acceptance may not be legally binding." },
  { id: "SIG-003", cat: "EXEC", check: "Buyer Sig Part Two", sev: "CRITICAL",
    test: function(f) { return f.hasPartTwo && !f._sigBuyerP2; }, msg: "Buyer signature missing on Part Two." },
  { id: "SIG-004", cat: "EXEC", check: "Seller Sig Part Two", sev: "CRITICAL",
    test: function(f) { return f.hasPartTwo && (f.sellerResponse === "accepts" || f.sellerResponse === "counters") && !f._sigSellerP2; }, msg: "Seller response marked but NO seller signature on Part Two. Both parts must be signed." },
  { id: "SIG-005", cat: "BRK", check: "Buyer Initials", sev: "HIGH",
    test: function(f) { return !f._initBuyer; }, msg: "Buyer initials missing on Brokerage Obligations page." },
  { id: "SIG-006", cat: "BRK", check: "Seller Initials", sev: "HIGH",
    test: function(f) { return !f._isCondo && (f.sellerResponse === "accepts" || f.sellerResponse === "counters") && !f._initSeller; }, msg: "Seller initials missing on Brokerage Obligations page (page 1). This is separate from the Section 15 signature." },
  { id: "SIG-007", cat: "BRK", check: "Buyer Rep Sig", sev: "HIGH",
    test: function(f) { return f.buyerBrokerage && !f._sigBuyerBrkRep; }, msg: "Buyer brokerage representative signature missing." },
  { id: "SIG-008", cat: "BRK", check: "Seller Rep Sig", sev: "HIGH", skip: WRITING_ONLY,
    test: function(f) { return f.sellerBrokerage && !f._sigSellerBrkRep; }, msg: "Seller brokerage representative signature missing." },
  { id: "CTR-001", cat: "EXEC", check: "Counter Terms Missing", sev: "HIGH", skip: PRE_RESPONSE,
    test: function(f) { return f.sellerResponse === "counters" && !(f.counterOfferTerms || "").trim() && !f.counterOfferScheduleRef; }, msg: "Counter but terms blank and no schedule ref." },
  { id: "CTR-002", cat: "EXEC", check: "Counter No Deadline", sev: "HIGH", skip: PRE_RESPONSE,
    test: function(f) { return f.sellerResponse === "counters" && !f.sellerCounterDeadline; }, msg: "Counter but no deadline." },
  { id: "CTR-003", cat: "EXEC", check: "Counter No Buyer Response", sev: "HIGH", skip: PRE_RESPONSE,
    test: function(f) { return f.sellerResponse === "counters" && f.buyerCounterResponse === "none"; }, msg: "Counter but Section 16 blank." },
  { id: "CTR-004", cat: "EXEC", check: "False Counter Accept", sev: "HIGH", skip: PRE_RESPONSE,
    test: function(f) { return f.sellerResponse !== "counters" && f.buyerCounterResponse === "accepts"; }, msg: "Buyer accepts counter but seller didn't counter." },
  { id: "CTR-005", cat: "EXEC", check: "Counter Price Change", sev: "MEDIUM", skip: PRE_RESPONSE,
    test: function(f) { return f._hasCounterPrice; },
    msg: function(f) { return "Counter-offer changed price: $" + Number(f.purchasePrice).toLocaleString() + " -> $" + Number(f.counterOfferPrice).toLocaleString() + ". Effective selling price: $" + Number(f.effectivePrice).toLocaleString() + "."; } },

  // === DEPOSIT (3) ===
  { id: "DEP-001", cat: "DEP", check: "Deposit 2 No Date", sev: "HIGH",
    test: function(f) { return f.depositAmount2 && !f.depositDeliveryDate; }, msg: "Second deposit but no delivery date." },
  { id: "DEP-002", cat: "DEP", check: "Deposit by Cheque", sev: "MEDIUM",
    test: function(f) { return f.depositCheque; }, msg: "Deposit by personal cheque." },
  { id: "DEP-003", cat: "DEP", check: "Deposit vs Price", sev: "MEDIUM",
    test: function(f) { var d = f._depTotal, p = parseFloat(f.purchasePrice || "0"); return d && p && d > p; }, msg: "Deposits exceed price." },

  // === BROKERAGE (5) ===
  { id: "BRK-001", cat: "BRK", check: "Buyer Rep Selection", sev: "HIGH",
    test: function(f) { return !f.buyerRepOnly && f.buyerRepType !== "both" && f.buyerBrokerage; }, msg: "Buyer representation type not selected." },
  { id: "BRK-002", cat: "BRK", check: "Seller Rep Selection", sev: "HIGH", skip: WRITING_ONLY,
    test: function(f) { return f.sellerBrokerage && f.sellerRepType !== "seller_only" && f.sellerRepType !== "both"; }, msg: "Seller representation type not selected." },
  { id: "BRK-003", cat: "BRK", check: "Same Brokerage Dual", sev: "MEDIUM",
    test: function(f) { if (!f.buyerBrokerage || !f.sellerBrokerage) return false; return f.buyerBrokerage.toLowerCase().replace(/\s/g, "") === f.sellerBrokerage.toLowerCase().replace(/\s/g, "") && f.buyerRepType !== "both"; }, msg: "Same brokerage both sides, not dual agency." },
  { id: "LJR-001", cat: "BRK", check: "Joint Rep Consent", sev: "HIGH",
    test: function(f) {
      var sameBrk = f.buyerBrokerage && f.sellerBrokerage && f.buyerBrokerage.toLowerCase().replace(/\s/g, "") === f.sellerBrokerage.toLowerCase().replace(/\s/g, "");
      if (!sameBrk && (f.buyerRepType === "both" || f.sellerRepType === "both")) return false;
      return f.buyerRepType === "both" || f.sellerRepType === "both";
    },
    msg: "Limited joint representation selected. BROKER: Verify signed Consent to Limited Joint Representation form is in the file package." },
  { id: "LJR-002", cat: "BRK", check: "Joint Rep Mismatch", sev: "CRITICAL",
    test: function(f) {
      var sameBrk = f.buyerBrokerage && f.sellerBrokerage && f.buyerBrokerage.toLowerCase().replace(/\s/g, "") === f.sellerBrokerage.toLowerCase().replace(/\s/g, "");
      if (!sameBrk) return false;
      return (f.buyerRepType === "both" && f.sellerRepType !== "both") || (f.buyerRepType !== "both" && f.sellerRepType === "both");
    },
    msg: "Representation mismatch: one brokerage claims limited joint representation but the other does not confirm." },

  // === CLOSING (3) ===
  { id: "CLO-001", cat: "CLOSE", check: "Buyer Solicitor", sev: "MEDIUM",
    test: function(f) { return !f.buyerSolicitor || f.buyerSolicitor.length < 2; }, msg: "Buyer solicitor not specified." },
  { id: "CLO-002", cat: "CLOSE", check: "Seller Solicitor", sev: "MEDIUM", skip: WRITING_ONLY,
    test: function(f) { return !f.sellerSolicitor || f.sellerSolicitor.length < 2; }, msg: "Seller solicitor not specified." },
  { id: "CLO-003", cat: "CLOSE", check: "Possession Weekend", sev: "LOW", stub: true,
    test: function(f) { return false; }, msg: "Phase 2: day-of-week check." },

  // === SCHEDULES (4) ===
  { id: "SCH-001", cat: "SCH", check: "Schedule 1 PDS", sev: "MEDIUM",
    test: function(f) { return f.schedule1_PDS; }, msg: "BROKER: Verify PDS attached." },
  { id: "SCH-002", cat: "SCH", check: "Schedule 2 Terms", sev: "MEDIUM",
    test: function(f) { return f.schedule2_AdditionalTerms; }, msg: "BROKER: Verify Schedule 2 attached." },
  { id: "SCH-003", cat: "SCH", check: "Schedule 3 Mortgage", sev: "MEDIUM",
    test: function(f) { return f.schedule3_MortgageAssumption; }, msg: "BROKER: Verify Schedule 3 attached." },
  { id: "SCH-004", cat: "SCH", check: "PDS Condition No Schedule", sev: "HIGH",
    test: function(f) { return f.pdsChoice === "box1_condition" && !f.schedule1_PDS; }, msg: "PDS condition but Schedule 1 not checked." },

  // === TIMELINE (8) ===
  { id: "TM-001", cat: "TIME", check: "Acceptance After Expiry", sev: "CRITICAL", skip: PRE_RESPONSE,
    test: function(f) { var c = tc(f._ts.sellerSigned, f._ts.irrevocability); return c !== null && c > 0; }, msg: "VOID: Seller responded AFTER irrevocability expired." },
  { id: "TM-002", cat: "TIME", check: "Counter DL Before Sign", sev: "HIGH", skip: PRE_RESPONSE,
    test: function(f) { if (f.sellerResponse !== "counters") return false; var c = tc(f._ts.sellerCounterDeadline, f._ts.sellerSigned); return c !== null && c < 0; }, msg: "Counter deadline before seller signing." },
  { id: "TM-003", cat: "TIME", check: "Counter Response Late", sev: "CRITICAL", skip: PRE_RESPONSE,
    test: function(f) { if (f.sellerResponse !== "counters") return false; var c = tc(f._ts.buyerCounterSigned, f._ts.sellerCounterDeadline); return c !== null && c > 0; }, msg: "VOID: Buyer responded after counter expired." },
  { id: "TM-004", cat: "TIME", check: "Condition After Possession", sev: "HIGH",
    test: function(f) { var p = f._ts.possessionDate; if (!p) return false; return [f._ts.cond7a, f._ts.cond7b, f._ts.cond7c].some(function(c) { return c && c > p; }); }, msg: "Condition deadline after possession." },
  { id: "TM-005", cat: "TIME", check: "PDS After Financing", sev: "MEDIUM",
    test: function(f) { var c = tc(f._ts.cond7a, f._ts.cond7b); return c !== null && c > 0; }, msg: "PDS deadline after financing." },
  { id: "TM-006", cat: "TIME", check: "Signed After Irrevocability", sev: "HIGH",
    test: function(f) { var c = tc(f._ts.offerSigned, f._ts.irrevocability); return c !== null && c > 0; }, msg: "Offer signed after irrevocability." },
  { id: "TM-007", cat: "TIME", check: "Condition Before Acceptance", sev: "HIGH", skip: PRE_RESPONSE,
    test: function(f) { var a = f._ts.sellerSigned; if (!a) return false; return [f._ts.cond7a, f._ts.cond7b, f._ts.cond7c].some(function(c) { return c && c < a; }); }, msg: "Condition expires before acceptance." },
  { id: "TM-008", cat: "TIME", check: "Tight Closing", sev: "MEDIUM",
    test: function(f) { var p = f._ts.possessionDate; if (!p) return false; return [f._ts.cond7a, f._ts.cond7b, f._ts.cond7c].filter(Boolean).some(function(c) { return (p - c) < 10080 && (p - c) > 0; }); }, msg: "Less than 7 days to close." },

  // === LEGAL DESCRIPTION (3) ===
  { id: "LD-001", cat: "VALID", check: "Legal Desc Format", sev: "HIGH",
    test: function(f) { return f.legalDescription && f.legalDescription.length > 3 && !f.ldOk; },
    msg: function(f) { return "Legal desc may be invalid: " + f.legalDescription; } },
  { id: "LD-002", cat: "VALID", check: "Phone Number in Legal", sev: "CRITICAL",
    test: function(f) { return /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/.test((f.legalDescription || "").trim()); }, msg: "Legal description is a phone number." },
  { id: "LD-003", cat: "VALID", check: "Legal Desc Blank", sev: "MEDIUM",
    test: function(f) { return f.civicAddress && f.civicAddress.length > 3 && (!f.legalDescription || f.legalDescription.length < 2); }, msg: "Legal description blank. Civic address present but legal desc should be completed." },

  // === PARTY CAPACITY (3) ===
  { id: "CAP-001", cat: "CAP", check: "Estate Sale", sev: "HIGH",
    test: function(f) { return /executor|estate\s+of|administrator/i.test((f.sCap || "") + (f.sellerName || "")); }, msg: "Estate sale. Different obligations." },
  { id: "CAP-002", cat: "CAP", check: "Power of Attorney", sev: "HIGH",
    test: function(f) { return /power\s+of\s+attorney|POA/i.test((f.bCap || "") + (f.sCap || "") + (f.buyerName || "") + (f.sellerName || "")); }, msg: "POA involved. Verify authority." },
  { id: "CAP-003", cat: "CAP", check: "Corporate/Trust", sev: "MEDIUM",
    test: function(f) { return /\b(corp|inc|ltd|llc|trust|trustee)\b/i.test((f.bCap || "") + (f.sCap || "") + (f.buyerName || "") + (f.sellerName || "")); }, msg: "Corporate/trust entity." },

  // === SELF-DEALING (1) ===
  { id: "SD-001", cat: "SD", check: "Self-Dealing", sev: "CRITICAL",
    test: function(f) {
      var agents = [(f.buyerRep || "").toLowerCase().trim(), (f.sellerRep || "").toLowerCase().trim()].filter(function(n) { return n.length > 2; });
      var parties = [(f.buyerName1 || "").toLowerCase().trim(), (f.buyerName2 || "").toLowerCase().trim(), (f.sellerName1 || "").toLowerCase().trim(), (f.sellerName2 || "").toLowerCase().trim()].filter(function(n) { return n.length > 2; });
      for (var i = 0; i < agents.length; i++) {
        for (var j = 0; j < parties.length; j++) {
          var ap = agents[i].split(/\s+/);
          var pp = parties[j].split(/\s+/);
          var aLast = ap[ap.length - 1];
          var pLast = pp[pp.length - 1];
          if (aLast.length > 2 && aLast === pLast) return true;
        }
      }
      return false;
    },
    msg: "POSSIBLE SELF-DEALING: Agent/rep surname matches buyer or seller. RESA s.30 requires Form 10 disclosure." },

  // === CONFIDENCE (2) ===
  { id: "CNF-001", cat: "CONF", check: "Low Confidence", sev: "HIGH",
    test: function(f) { return f._lo && f._lo.length > 0; },
    msg: function(f) { return "LOW confidence: " + (f._lo || []).join(", "); } },
  { id: "CNF-002", cat: "CONF", check: "Med Confidence", sev: "MEDIUM",
    test: function(f) { return f._md && f._md.length > 0; },
    msg: function(f) { return "MEDIUM confidence: " + (f._md || []).join(", "); } },

  // === AMENDMENTS (1) ===
  { id: "AMD-001", cat: "AMEND", check: "Amendments Detected", sev: "MEDIUM",
    test: function(f) { return f.hasAm; },
    msg: function(f) { var details = (f._am || []).map(function(a) { return a.field + ": " + (a.original || "?") + " -> " + (a.amended || "?"); }); return (f._am || []).length + " amendment(s): " + details.join("; "); } },

  // === FINTRAC (1) ===
  { id: "FIN-001", cat: "REG", check: "Large Cash Deposit", sev: "HIGH",
    test: function(f) { return f.bigCash; }, msg: "Cash deposit >= $10K. FINTRAC required." },

  // === EXISTING MORTGAGE (1) ===
  { id: "MTG-008", cat: "MORTGAGE", check: "Existing Mortgage Unclear", sev: "MEDIUM",
    test: function(f) { return f.existingMortgageBox === "unclear"; }, msg: "Existing mortgage checkbox unclear." },

  // === MORTGAGE AMOUNT CONSISTENCY (1) ===
  { id: "MTG-009", cat: "MORTGAGE", check: "Mortgage Amount Mismatch", sev: "HIGH",
    test: function(f) {
      if (!f.mortgageAmount || !f.cond7b_conditionAmt) return false;
      var s4 = parseFloat(String(f.mortgageAmount).replace(/[,$]/g, ""));
      var s7 = parseFloat(String(f.cond7b_conditionAmt).replace(/[,$]/g, ""));
      return !isNaN(s4) && !isNaN(s7) && s4 !== s7;
    },
    msg: function(f) { return "Mortgage amount in Sec 4 ($" + Number(f.mortgageAmount).toLocaleString() + ") differs from 7.1(b) condition ($" + Number(f.cond7b_conditionAmt).toLocaleString() + ")."; } },

  // === SCHEDULE 4 (1) ===
  { id: "SCH-005", cat: "SCH", check: "Schedule 4 Checked", sev: "MEDIUM",
    test: function(f) { return f.schedule4_Other; },
    msg: function(f) { return "BROKER: Verify Schedule 4 (other) attached." + (f.schedule4_Description ? " Desc: " + f.schedule4_Description : ""); } },

  // === DOCUMENT VERIFICATION (detected vs expected) ===
  { id: "DOC-V01", cat: "SCH", check: "PDS Detected in PDF", sev: "LOW",
    test: function(f) { return f._detectedPDS; },
    msg: "Property Disclosure Statement detected in PDF." },
  { id: "DOC-V02", cat: "SCH", check: "PDS Expected Not Found", sev: "HIGH",
    test: function(f) { return (f.pdsChoice === "box1_condition" || f.pdsChoice === "box2_provided" || f.schedule1_PDS) && !f._detectedPDS; },
    msg: "PDS referenced in offer (Section 6 or Schedule 1 checked) but Property Disclosure Statement NOT detected in PDF." },
  { id: "DOC-V03", cat: "SCH", check: "Schedule 2 Detected", sev: "LOW",
    test: function(f) { return f._detectedSch2; },
    msg: "Schedule 2 (Additional Terms) detected in PDF." },
  { id: "DOC-V04", cat: "SCH", check: "Schedule 2 Expected Not Found", sev: "HIGH",
    test: function(f) { return f.schedule2_AdditionalTerms && !f._detectedSch2; },
    msg: "Schedule 2 checkbox marked but Schedule 2 NOT detected in PDF." },
  { id: "DOC-V05", cat: "SCH", check: "Schedule 3 Detected", sev: "LOW",
    test: function(f) { return f._detectedSch3; },
    msg: "Schedule 3 (Mortgage Assumption) detected in PDF." },
  { id: "DOC-V06", cat: "SCH", check: "Schedule 3 Expected Not Found", sev: "HIGH",
    test: function(f) { return f.schedule3_MortgageAssumption && !f._detectedSch3; },
    msg: "Schedule 3 checkbox marked but Schedule 3 NOT detected in PDF." },
  { id: "DOC-V07", cat: "SCH", check: "Addendum/Amendment Detected", sev: "MEDIUM",
    test: function(f) { return f._detectedAddendum; },
    msg: function(f) { var docs = (f._attachedDocs || []).filter(function(d) { return d.type === "addendum" || d.type === "amendment"; }); return "Addendum/Amendment detected: " + docs.map(function(d) { return d.title || "untitled"; }).join(", "); } },
  { id: "DOC-V08", cat: "SCH", check: "Condition Removal Detected", sev: "LOW",
    test: function(f) { return f._detectedCondRemoval; },
    msg: "Condition removal / notice of fulfillment detected in PDF." },

  // === PDS DOCUMENT VALIDATION (4) ===
  { id: "PDS-005", cat: "PDS", check: "PDS Seller Not Signed", sev: "CRITICAL",
    test: function(f) { return f._pdsPresent && !f._pdsSellerOk; },
    msg: "Property Disclosure Statement is present but NOT SIGNED by the Seller. PDS is invalid without seller signature." },
  { id: "PDS-006", cat: "PDS", check: "PDS Buyer Not Signed", sev: "HIGH",
    test: function(f) { return f._pdsPresent && !f._pdsBuyerOk; },
    msg: "Property Disclosure Statement is present but NOT SIGNED by the Buyer. Buyer must acknowledge receipt." },
  { id: "PDS-007", cat: "PDS", check: "PDS Not Completed", sev: "HIGH",
    test: function(f) { return f._pdsPresent && !f._pdsIsComplete; },
    msg: "Property Disclosure Statement is present but appears BLANK or incomplete. Checkbox columns are not filled in. A blank PDS form does not satisfy the disclosure requirement." },
  { id: "PDS-008", cat: "PDS", check: "PDS Disclosures No Explanation", sev: "MEDIUM",
    test: function(f) { return f._pdsPresent && f._pdsHasDisclosures && !f._pdsExplOk; },
    msg: function(f) {
      var items = [];
      if (f._pdsNotCorrect.length > 0) items.push("NOT CORRECT on items: " + f._pdsNotCorrect.join(", "));
      if (f._pdsDoNotKnow.length > 0) items.push("DO NOT KNOW on items: " + f._pdsDoNotKnow.join(", "));
      return "PDS has disclosures (" + items.join("; ") + ") but Explanations section appears blank. Seller must provide complete explanations for all NOT CORRECT and DO NOT KNOW responses.";
    } },

  // === CONDO-SPECIFIC (5) ===
  { id: "CND-C01", cat: "VALID", check: "Condo Unit Number", sev: "CRITICAL", form: "condo",
    test: function(f) { return !f.condoUnitNumber; }, msg: "Condo unit number missing." },
  { id: "CND-C02", cat: "VALID", check: "Condo Corp Number", sev: "HIGH", form: "condo",
    test: function(f) { return !f.condoCorpNumber; }, msg: "Condominium Corporation number missing." },
  { id: "CND-C03", cat: "VALID", check: "Common Element Share", sev: "HIGH", form: "condo",
    test: function(f) { return !f._cesValid; }, msg: "Common element share missing or invalid." },
  { id: "CND-C04", cat: "VALID", check: "Condo Project Name", sev: "MEDIUM", form: "condo",
    test: function(f) { return !f.condoProjectName; }, msg: "Condominium project name missing." },
  { id: "CND-C05", cat: "COND", check: "No PDS Condition (Condo)", sev: "HIGH", form: "condo",
    test: function(f) { return !f.cond7a_filled && f.pdsChoice === "box1_condition"; },
    msg: "PDS condition selected but 7.1(a) has no deadline. Condo Act cooling-off period starts on PDS delivery." }
];

var ACTIVE_RULE_COUNT = RULES.filter(function(r) { return !r.stub; }).length;

// -- Statutory citations for agent education --
var CITE = {
  "DOC-001": "Reg. 4.2 - prescribed form requires both Parts",
  "DOC-002": "Reg. 4.2 - prescribed form is immutable; amendments via Part One ss.9-10",
  "DOC-003": "Reg. 4.2 - complete prescribed form is 11+ pages",
  "R43-001": "Reg. 4.3(a) - offer must contain date",
  "R43-002": "Reg. 4.3(b) - names of all parties",
  "R43-003": "Reg. 4.3(b) - names of all parties",
  "R43-004": "Reg. 4.3(c) - address of offeror",
  "R43-005": "Reg. 4.3(d) - description of real estate",
  "R43-006": "Reg. 4.3(f) - purchase price required",
  "R43-007": "Reg. 4.3(e) - deposit amount required",
  "R43-008": "Reg. 4.3(e)(ii) - deposit delivery method",
  "R43-009": "OTP Part One s.3 - possession date",
  "R43-010": "OTP Part One s.11 - irrevocability deadline",
  "R43-011": "Reg. 4.3 - brokerage identification",
  "CHK-001": "OTP Part One s.4 - mortgage selection must be unambiguous",
  "CHK-002": "OTP Part One s.15 - seller response must be single selection",
  "CHK-003": "OTP Part One Brokerage Obligations - representation conflict",
  "MTG-001": "OTP Part One s.4 - mortgage checkbox unclear",
  "MTG-002": "OTP Part One s.4 - mortgage amount required when Yes",
  "MTG-003": "OTP Part Two s.4 - 7-day extension only applies with new mortgage",
  "MTG-004": "OTP Part Two s.4 - no 7-day extension for cash offers",
  "MTG-005": "OTP Part One s.4 - mortgage exceeds purchase price",
  "MTG-006": "OTP Part One s.4 - unusually low mortgage amount",
  "MTG-007": "OTP Part One s.4 - contradiction: No mortgage but amount filled",
  "MTG-008": "OTP Part One s.4 - existing mortgage unclear",
  "MTG-009": "OTP Part One ss.4/7.1(b) - mortgage amounts inconsistent",
  "PDS-001": "OTP Part One s.6 Box 1 + s.7.1(a) - condition requires deadline",
  "PDS-002": "OTP Part One s.6 Box 2 + s.10.2(a) - PDS must be attached as Schedule 1",
  "PDS-003": "OTP Part Two s.9 - PDS disclosures prevail over warranty 9(g)",
  "PDS-004": "OTP Part One s.6 - defaults to Box 3 if none selected",
  "PDS-005": "PDS Acknowledgement - seller must sign to validate disclosure",
  "PDS-006": "PDS Acknowledgement - buyer must sign to confirm receipt",
  "PDS-007": "PDS s.1-24 - disclosure items must be completed by seller",
  "PDS-008": "PDS Explanations - seller must explain all NOT CORRECT and DO NOT KNOW responses",
  "CND-001": "OTP Part Two s.7(e) - unfilled condition deemed not part of contract",
  "CND-002": "OTP Part Two s.7(e) - unfilled condition deemed not part of contract",
  "CND-003": "OTP Part Two s.7(e) - unfilled condition deemed not part of contract",
  "CND-004": "OTP Part One s.7.1(d) - should state None if no other conditions",
  "CND-005": "OTP Part One s.7.2 - should state None if no seller conditions",
  "CND-006": "OTP Part One ss.4/7.1(b) - financing condition without mortgage",
  "HS-001": "The Homesteads Act; OTP Part One s.12 - mandatory declaration",
  "HS-002": "The Homesteads Act; OTP Part One s.12 Box 3 - spouse name required",
  "HS-003": "The Homesteads Act - statutory requirement cannot be deleted",
  "HS-004": "The Homesteads Act - Form 3 Consent required",
  "NR-001": "Income Tax Act (Canada) s.116; OTP Part One s.13 - mandatory declaration",
  "NR-002": "Income Tax Act (Canada) s.116 - clearance certificate required",
  "NR-003": "Income Tax Act (Canada) s.116 - statutory requirement cannot be deleted",
  "NR-004": "Income Tax Act (Canada) s.116 - residency must be determined",
  "WAR-001": "OTP Part Two s.9(c) - zoning warranty amended",
  "WAR-002": "OTP Part Two s.9(d) - permits warranty amended",
  "WAR-003": "OTP Part Two s.9(g) - working order warranty amended",
  "WAR-004": "OTP Part Two s.9 - multiple warranty amendments increase risk",
  "WAR-005": "OTP Part Two s.9 - as-is clause overrides standard warranties",
  "WAR-006": "OTP Part One s.9 - any amendment to Part Two warranties requires broker review",
  "NON-001": "OTP Part One s.2 - excluded fixtures should state None if blank",
  "NON-002": "OTP Part One s.2 - included chattels should state None if blank",
  "NON-003": "OTP Part One s.10 - additional terms should state None if blank",
  "NON-005": "OTP Part One s.9 - warranty amendments should state None if blank",
  "REM-001": "Reg. 4.9(1.1) - decreasing percentage series must comply",
  "REM-002": "Reg. 4.9(3) - difference-based commission prohibited",
  "REM-003": "Reg. 4.4(b) - accepted offer must show remuneration",
  "SIG-001": "OTP Part One s.11 - buyer must sign offer",
  "SIG-002": "OTP Part One s.15 - seller must sign response",
  "SIG-003": "OTP Part One s.11 note - buyer must also sign Part Two",
  "SIG-004": "OTP Part One s.15 note - seller must also sign Part Two",
  "SIG-005": "OTP Part One Brokerage Obligations - buyer initials required",
  "SIG-006": "OTP Part One Brokerage Obligations - seller initials required",
  "SIG-007": "Reg. 4.6 - brokerage representative must sign",
  "SIG-008": "Reg. 4.6 - brokerage representative must sign",
  "CTR-001": "OTP Part One s.15 Box 3 - counter must specify terms",
  "CTR-002": "OTP Part One s.15 Box 3 - counter must have deadline",
  "CTR-003": "OTP Part One s.16 - buyer must respond to counter",
  "CTR-004": "OTP Part One s.16 - cannot accept non-existent counter",
  "CTR-005": "OTP Part One s.15 - counter-offer price change",
  "DEP-001": "OTP Part One s.5 - second deposit requires delivery date",
  "DEP-002": "OTP Part Two s.5 - personal cheque risk: 24hr cure notice",
  "DEP-003": "OTP Part One s.5 - deposits exceed purchase price",
  "BRK-001": "OTP Part One Brokerage Obligations - buyer representation type",
  "BRK-002": "OTP Part One Brokerage Obligations - seller representation type",
  "BRK-003": "OTP Part One Brokerage Obligations - dual agency disclosure",
  "LJR-001": "RESA s.30; Reg. 4.14 - limited joint rep requires written consent",
  "LJR-002": "RESA s.30; Reg. 4.14 - both brokerages must confirm LJR",
  "CLO-001": "OTP Part One s.18 - buyer solicitor information",
  "CLO-002": "OTP Part One s.18 - seller solicitor information",
  "CLO-003": "Brokerage best practice - possession day-of-week check",
  "SCH-001": "OTP Part One s.10.2(a) - verify Schedule 1 PDS attached",
  "SCH-002": "OTP Part One s.10.2(b) - verify Schedule 2 attached",
  "SCH-003": "OTP Part One s.10.2(c) - verify Schedule 3 attached",
  "SCH-004": "OTP Part One ss.6/10.2(a) - PDS condition requires Schedule 1",
  "SCH-005": "OTP Part One s.10.2(d) - verify Schedule 4 attached",
  "DOC-V01": "OTP Part One s.10.2(a) - PDS physically present in PDF",
  "DOC-V02": "OTP Part One ss.6/10.2(a) - PDS referenced but not found in PDF",
  "DOC-V03": "OTP Part One s.10.2(b) - Schedule 2 physically present in PDF",
  "DOC-V04": "OTP Part One s.10.2(b) - Schedule 2 checked but not found in PDF",
  "DOC-V05": "OTP Part One s.10.2(c) - Schedule 3 physically present in PDF",
  "DOC-V06": "OTP Part One s.10.2(c) - Schedule 3 checked but not found in PDF",
  "DOC-V07": "Brokerage review - additional document attached to offer",
  "DOC-V08": "OTP Part Two s.7(d) - condition fulfillment notice present",
  "TM-001": "OTP Part One s.11 - offer expires at irrevocability; late acceptance is void",
  "TM-002": "OTP Part One s.15 Box 3 - counter deadline before signing is invalid",
  "TM-003": "OTP Part One s.16 - late response to counter is void",
  "TM-004": "OTP Part One ss.3/7 - condition after possession is unenforceable",
  "TM-005": "OTP Part One s.7.1 - PDS review should precede financing",
  "TM-006": "OTP Part One s.11 - cannot sign after own irrevocability",
  "TM-007": "OTP Part Two s.7(e) - condition deems non-fulfilled if expired",
  "TM-008": "Brokerage best practice - insufficient time between conditions and closing",
  "LD-001": "Reg. 4.3(d) - legal description format",
  "LD-002": "Reg. 4.3(d) - legal description appears to be phone number",
  "LD-003": "Reg. 4.3(d) - legal description should be completed",
  "CAP-001": "Brokerage review - estate sale has different obligations",
  "CAP-002": "Brokerage review - verify POA authority documentation",
  "CAP-003": "Brokerage review - corporate/trust entity involved",
  "SD-001": "RESA s.30; Reg. 4.14-4.15 - Form 10 disclosure required",
  "CNF-001": "AI extraction - low confidence fields require manual verification",
  "CNF-002": "AI extraction - medium confidence fields",
  "AMD-001": "OTP Part One - counter-offer amendments detected",
  "FIN-001": "Proceeds of Crime (Money Laundering) Act - FINTRAC reporting",
  "CND-C01": "Reg. 4.2 Form 2 - condo unit number required",
  "CND-C02": "Reg. 4.2 Form 2 - condo corporation number required",
  "CND-C03": "Reg. 4.2 Form 2 - common element share required",
  "CND-C04": "Reg. 4.2 Form 2 - condo project name required",
  "CND-C05": "The Condominium Act s.48 - PDS/cooling-off period"
};

// -- Run rules with context and form-type filtering --
function runRules(fields, ctx, formType) {
  if (fields._normError) {
    return [{ id: "SYS-001", cat: "ARCH", check: "Normalization Error", sev: "CRITICAL", triggered: true, suppressed: false, msg: "Field normalization failed: " + fields._normError + ". Review extracted data manually." }];
  }
  return RULES.map(function(r) {
    // Skip rules that don't match the form type
    if (r.form && r.form !== formType) {
      return { id: r.id, cat: r.cat, check: r.check, sev: r.sev, triggered: false, suppressed: true, msg: typeof r.msg === "function" ? r.msg(fields) : r.msg };
    }
    var suppressed = r.skip && r.skip.indexOf(ctx) !== -1;
    if (suppressed) {
      return { id: r.id, cat: r.cat, check: r.check, sev: r.sev, triggered: false, suppressed: true, msg: typeof r.msg === "function" ? r.msg(fields) : r.msg };
    }
    var triggered = false;
    try { triggered = r.test(fields); } catch (e) { /* rule error */ }
    return {
      id: r.id, cat: r.cat, check: r.check, sev: r.sev, triggered: triggered, suppressed: false,
      msg: typeof r.msg === "function" ? r.msg(fields) : r.msg
    };
  });
}

// ====================================================================
// STORAGE (localStorage)
// ====================================================================
function loadIndex() {
  return new Promise(function(resolve) {
    try {
      var raw = localStorage.getItem("offerguard-index");
      resolve(raw ? JSON.parse(raw) : []);
    } catch(e) { resolve([]); }
  });
}
function loadOffer(id) {
  return new Promise(function(resolve) {
    try {
      var raw = localStorage.getItem("og:" + id);
      resolve(raw ? JSON.parse(raw) : null);
    } catch(e) { resolve(null); }
  });
}
function saveOffer(entry) {
  return new Promise(function(resolve) {
    try {
      localStorage.setItem("og:" + entry.id, JSON.stringify(entry));
      var raw = localStorage.getItem("offerguard-index");
      var idx = raw ? JSON.parse(raw) : [];
      if (idx.indexOf(entry.id) === -1) idx.unshift(entry.id);
      localStorage.setItem("offerguard-index", JSON.stringify(idx));
    } catch(e) { console.error("Storage:", e); }
    resolve();
  });
}
function updateOffer(id, updates) {
  return loadOffer(id).then(function(entry) {
    if (!entry) return;
    Object.keys(updates).forEach(function(k) { entry[k] = updates[k]; });
    try { localStorage.setItem("og:" + id, JSON.stringify(entry)); }
    catch(e) { console.error("Update:", e); }
  });
}

// ====================================================================
// SECTION-ORDERED ISSUE DISPLAY
// ====================================================================
function SectionIssues(props) {
  var issues = (props.issues || []).slice().sort(sectionSort);
  var compact = props.compact;
  var max = props.max || issues.length;
  var shown = issues.slice(0, max);
  var remaining = issues.length - max;

  // Group by section
  var groups = [];
  var currentLabel = null;
  shown.forEach(function(r) {
    var sec = SECTIONS[r.cat] || { order: 99, label: "Other" };
    if (sec.label !== currentLabel) {
      currentLabel = sec.label;
      groups.push({ label: sec.label, items: [r] });
    } else {
      groups[groups.length - 1].items.push(r);
    }
  });

  return (
    <div>
      {groups.map(function(g, gi) {
        return (
          <div key={gi}>
            {!compact && (
              <div style={{ fontSize: 8, fontWeight: 700, color: T.ac, fontFamily: MO, padding: "4px 8px", marginTop: gi > 0 ? 6 : 0, letterSpacing: "0.08em" }}>
                {g.label.toUpperCase()}
              </div>
            )}
            {g.items.map(function(r) {
              if (compact) {
                return (
                  <div key={r.id} style={{ padding: "4px 8px", marginBottom: 1, fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 7, fontWeight: 700, color: sC(r.sev), fontFamily: MO, padding: "1px 3px", background: sC(r.sev) + "15", borderRadius: 2 }}>{r.sev}</span>
                    <span style={{ color: T.m }}>{r.check + ": " + r.msg}</span>
                  </div>
                );
              }
              return (
                <div key={r.id} style={{ padding: "6px 8px", marginBottom: 2, background: sB(r.sev), borderLeft: "3px solid " + sC(r.sev), borderRadius: "0 6px 6px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: sC(r.sev), fontFamily: MO }}>{r.sev}</span>
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{r.check}</span>
                    <span style={{ fontSize: 7, color: T.dm, fontFamily: MO, marginLeft: "auto" }}>{r.id}</span>
                  </div>
                  <div style={{ fontSize: 10, color: T.m, lineHeight: 1.4 }}>{r.msg}</div>
                  {CITE[r.id] && <div style={{ fontSize: 8, color: T.ac, fontFamily: MO, marginTop: 2, opacity: 0.8 }}>{CITE[r.id]}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
      {remaining > 0 && <div style={{ fontSize: 9, color: T.dm, paddingLeft: 8 }}>{"+" + remaining + " more..."}</div>}
    </div>
  );
}

// ====================================================================
// TRADE RECORD SHEET
// ====================================================================
function TradeRecordSheet(p) {
  var f = p.fields || {};
  var trsState = useState({
    mlsNumber: "", listPrice: "", sourceOfBiz: "", commListPct: "", commSellPct: "", commFlat: "",
    shelterDonation: "5", referral: "no", referralPct: "", referralEnd: "", referralPayTo: "", referralBrokerage: "",
    multipleOffer: "no", justSold: "no", specialInstructions: "", matrixUpdated: "no",
    // Overridable extracted fields (agent can correct AI errors)
    ovAddress: f.civicAddress || "",
    ovBuyer: f.buyerName || "",
    ovSeller: f.sellerName || "",
    ovPrice: f.effectivePrice ? String(f.effectivePrice) : (f.purchasePrice ? String(f.purchasePrice) : ""),
    ovPossession: f.possessionDate || "",
    ovAcceptance: f.sellerSigned || "",
    ovDeposit1: f.depositAmount1 ? String(f.depositAmount1) : "",
    ovDeposit2: f.depositAmount2 ? String(f.depositAmount2) : "",
    ovBuyerLawyer: f.buyerSolicitor || "",
    ovSellerLawyer: f.sellerSolicitor || ""
  });
  var trs = trsState[0];
  var setTrs = function(key, val) {
    trsState[1](function(prev) {
      var next = {};
      Object.keys(prev).forEach(function(k) { next[k] = prev[k]; });
      next[key] = val;
      return next;
    });
  };
  var printState = useState(false);

  var conds = [];
  if (f.cond7a_filled) conds.push({ name: "PDS Review", date: (f.cond7a_date || "") });
  if (f.cond7b_filled) conds.push({ name: "Financing", date: (f.cond7b_date || "") });
  if (f.cond7c_filled) conds.push({ name: "Inspection", date: (f.cond7c_date || "") });
  if (f.cond7d_otherConditions && !/^none$/i.test(f.cond7d_otherConditions.trim())) {
    conds.push({ name: f.cond7d_otherConditions.substring(0, 30), date: "" });
  }
  var acceptance = f.sellerSigned || "";

  function inp(label, val, key, w) {
    return (
      <div style={{ display: "inline-block", width: w || "48%", marginBottom: 6, marginRight: "2%" }}>
        <div style={{ fontSize: 8, color: T.dm, fontFamily: MO }}>{label}</div>
        <input value={val} onChange={function(e) { setTrs(key, e.target.value); }}
          style={{ width: "100%", padding: "4px 6px", background: T.s2, border: "1px solid " + T.bd, borderRadius: 4, color: T.tx, fontSize: 11, outline: "none", boxSizing: "border-box", fontFamily: SA }} />
      </div>
    );
  }
  function ro(label, val, w) {
    return (
      <div style={{ display: "inline-block", width: w || "48%", marginBottom: 6, marginRight: "2%" }}>
        <div style={{ fontSize: 8, color: T.dm, fontFamily: MO }}>{label}</div>
        <div style={{ padding: "4px 6px", background: T.bg, border: "1px solid " + T.bd + "60", borderRadius: 4, color: T.ok, fontSize: 11, fontFamily: MO, minHeight: 18, wordBreak: "break-word" }}>{val || "-"}</div>
      </div>
    );
  }
  function tog(label, key, val) {
    return (
      <div>
        <div style={{ fontSize: 8, color: T.dm, fontFamily: MO }}>{label}</div>
        <div style={{ display: "flex", gap: 4 }}>
          {["no", "yes"].map(function(v) {
            return <button key={v} onClick={function() { setTrs(key, v); }} style={{ padding: "3px 8px", background: val === v ? T.ac : T.s2, border: "1px solid " + T.bd, borderRadius: 4, color: val === v ? "#fff" : T.tx, fontSize: 10, cursor: "pointer" }}>{v === "yes" ? "Yes" : "No"}</button>;
          })}
        </div>
      </div>
    );
  }

  if (printState[0]) {
    var ps = { fontFamily: "Arial, sans-serif", fontSize: 11, color: "#000", background: "#fff", padding: 24, maxWidth: 800, margin: "0 auto" };
    var hdr = { fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 4 };
    var sub = { fontSize: 10, textAlign: "center", marginBottom: 16, color: "#666" };
    var row = { display: "flex", borderBottom: "1px solid #ccc", padding: "3px 0" };
    var lbl = { width: "40%", fontSize: 10, color: "#666" };
    var val = { width: "60%", fontSize: 11, fontWeight: 600 };
    var sec = { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 6, borderBottom: "2px solid #000", paddingBottom: 2 };

    return (
      <div style={ps}>
        <div style={hdr}>SALES RECORD SHEET</div>
        <div style={sub}>Royal LePage Prime Real Estate</div>
        <div style={sec}>PROPERTY</div>
        <div style={row}><div style={lbl}>Address</div><div style={val}>{trs.ovAddress}</div></div>
        <div style={row}><div style={lbl}>Postal Code</div><div style={val}>{((trs.ovAddress || f.buyerAddress || "").match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i) || [""])[0]}</div></div>
        <div style={row}><div style={lbl}>MLS #</div><div style={val}>{trs.mlsNumber}</div></div>
        <div style={row}><div style={lbl}>List Price</div><div style={val}>{"$" + trs.listPrice}</div></div>
        <div style={row}><div style={lbl}>Selling Price</div><div style={val}>{trs.ovPrice ? "$" + Number(trs.ovPrice).toLocaleString() : ""}</div></div>
        <div style={row}><div style={lbl}>Acceptance Date</div><div style={val}>{trs.ovAcceptance}</div></div>
        <div style={row}><div style={lbl}>Possession Date</div><div style={val}>{trs.ovPossession}</div></div>
        <div style={sec}>CONDITIONS</div>
        {conds.map(function(c, i) { return <div key={i} style={row}><div style={lbl}>{(i + 1) + ") " + c.name}</div><div style={val}>{c.date}</div></div>; })}
        {conds.length === 0 && <div style={row}><div style={lbl}>None</div><div style={val}></div></div>}
        <div style={sec}>BUYING END</div>
        <div style={row}><div style={lbl}>Source of Business</div><div style={val}>{trs.sourceOfBiz}</div></div>
        <div style={row}><div style={lbl}>Name(s)</div><div style={val}>{trs.ovBuyer}</div></div>
        <div style={row}><div style={lbl}>Address</div><div style={val}>{f.buyerAddress || ""}</div></div>
        <div style={row}><div style={lbl}>Buyer Lawyer</div><div style={val}>{trs.ovBuyerLawyer}</div></div>
        <div style={row}><div style={lbl}>Firm</div><div style={val}>{f.buyerSolicitorFirm || ""}</div></div>
        <div style={row}><div style={lbl}>Phone</div><div style={val}>{f.buyerSolicitorPhone || ""}</div></div>
        <div style={row}><div style={lbl}>Buying Brokerage</div><div style={val}>{f.buyerBrokerage || ""}</div></div>
        <div style={row}><div style={lbl}>Agent</div><div style={val}>{f.buyerRep || ""}</div></div>
        <div style={row}><div style={lbl}>Phone</div><div style={val}>{f.buyerRepPhone || ""}</div></div>
        <div style={sec}>LISTING END</div>
        <div style={row}><div style={lbl}>Name(s)</div><div style={val}>{trs.ovSeller}</div></div>
        <div style={row}><div style={lbl}>Address</div><div style={val}>{f.sellerAddress || ""}</div></div>
        <div style={row}><div style={lbl}>Seller Lawyer</div><div style={val}>{trs.ovSellerLawyer}</div></div>
        <div style={row}><div style={lbl}>Firm</div><div style={val}>{f.sellerSolicitorFirm || ""}</div></div>
        <div style={row}><div style={lbl}>Phone</div><div style={val}>{f.sellerSolicitorPhone || ""}</div></div>
        <div style={row}><div style={lbl}>Listing Brokerage</div><div style={val}>{f.sellerBrokerage || ""}</div></div>
        <div style={row}><div style={lbl}>Agent</div><div style={val}>{f.sellerRep || ""}</div></div>
        <div style={row}><div style={lbl}>Phone</div><div style={val}>{f.sellerRepPhone || ""}</div></div>
        <div style={sec}>DEPOSIT & COMMISSION</div>
        <div style={row}><div style={lbl}>Deposit</div><div style={val}>{trs.ovDeposit1 ? "$" + trs.ovDeposit1 : ""}</div></div>
        <div style={row}><div style={lbl}>Further Deposit</div><div style={val}>{trs.ovDeposit2 ? "$" + trs.ovDeposit2 : ""}</div></div>
        <div style={row}><div style={lbl}>Commission Split</div><div style={val}>{"Listing " + trs.commListPct + "% / Selling " + trs.commSellPct + "%" + (trs.commFlat ? " or Flat $" + trs.commFlat : "")}</div></div>
        <div style={row}><div style={lbl}>Shelter Foundation</div><div style={val}>{"$" + trs.shelterDonation}</div></div>
        <div style={row}><div style={lbl}>Referral</div><div style={val}>{trs.referral === "yes" ? trs.referralPct + "% to " + trs.referralPayTo + " (" + trs.referralBrokerage + ") - " + trs.referralEnd + " end" : "No"}</div></div>
        <div style={row}><div style={lbl}>Multiple Offer</div><div style={val}>{trs.multipleOffer === "yes" ? "Yes" : "No"}</div></div>
        <div style={row}><div style={lbl}>Just Sold Cards</div><div style={val}>{trs.justSold === "yes" ? "Yes" : "No"}</div></div>
        {trs.specialInstructions && <div style={row}><div style={lbl}>Special Instructions</div><div style={val}>{trs.specialInstructions}</div></div>}
        <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
          <button onClick={function() { printState[1](false); }} style={{ padding: "8px 16px", background: "#666", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>Back</button>
          <button onClick={function() { window.print(); }} style={{ padding: "8px 16px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Print / Save PDF</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: T.s1, borderRadius: 10, border: "1px solid " + T.bd, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: MO, marginBottom: 10, color: T.ac, letterSpacing: "0.08em" }}>TRADE RECORD SHEET</div>
      <div style={{ fontSize: 10, color: T.dm, marginBottom: 12 }}>Auto-filled from offer. Complete agent-only fields below.</div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: T.m, marginBottom: 4, fontFamily: MO }}>FROM OFFER (editable — correct any AI extraction errors)</div>
        {inp("Address of Sale", trs.ovAddress, "ovAddress", "100%")}
        {inp("Buyer(s)", trs.ovBuyer, "ovBuyer")}
        {inp("Seller(s)", trs.ovSeller, "ovSeller")}
        {inp("Selling Price $", trs.ovPrice, "ovPrice")}
        {inp("Possession Date", trs.ovPossession, "ovPossession")}
        {inp("Acceptance Date", trs.ovAcceptance, "ovAcceptance")}
        {inp("Deposit 1 $", trs.ovDeposit1, "ovDeposit1")}
        {inp("Deposit 2 $", trs.ovDeposit2, "ovDeposit2")}
        {inp("Buyer Lawyer", trs.ovBuyerLawyer, "ovBuyerLawyer")}
        {inp("Seller Lawyer", trs.ovSellerLawyer, "ovSellerLawyer")}
        {ro("Buying Brokerage", f.buyerBrokerage)}
        {ro("Listing Brokerage", f.sellerBrokerage)}
        {ro("Buying Agent", f.buyerRep)}
        {ro("Listing Agent", f.sellerRep)}
        {conds.length > 0 && ro("Conditions", conds.map(function(c) { return c.name + " (" + c.date + ")"; }).join(", "), "100%")}
      </div>
      <div style={{ borderTop: "1px solid " + T.bd, paddingTop: 10, marginTop: 6 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: T.hi, marginBottom: 4, fontFamily: MO }}>AGENT INPUT (required)</div>
        {inp("MLS # / EXCL.", trs.mlsNumber, "mlsNumber")}
        {inp("List Price", trs.listPrice, "listPrice")}
        {inp("Source of Business", trs.sourceOfBiz, "sourceOfBiz")}
        {inp("Commission Listing %", trs.commListPct, "commListPct")}
        {inp("Commission Selling %", trs.commSellPct, "commSellPct")}
        {inp("Or Flat Fee $", trs.commFlat, "commFlat")}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 8, color: T.dm, fontFamily: MO, marginBottom: 2 }}>Shelter Foundation Donation</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["5", "10", "25"].map(function(v) {
              return <button key={v} onClick={function() { setTrs("shelterDonation", v); }}
                style={{ padding: "4px 10px", background: trs.shelterDonation === v ? T.ac : T.s2, border: "1px solid " + T.bd, borderRadius: 4, color: trs.shelterDonation === v ? "#fff" : T.tx, fontSize: 10, cursor: "pointer" }}>{"$" + v}</button>;
            })}
            {inp("Other $", trs.shelterDonation, "shelterDonation", "80px")}
          </div>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {tog("Referral", "referral", trs.referral)}
          {tog("Multiple Offer", "multipleOffer", trs.multipleOffer)}
          {tog("Just Sold Cards", "justSold", trs.justSold)}
          {tog("Matrix Updated", "matrixUpdated", trs.matrixUpdated)}
        </div>
        {trs.referral === "yes" && (
          <div style={{ marginTop: 6 }}>
            {inp("Referral %", trs.referralPct, "referralPct")}
            {inp("Referral End", trs.referralEnd, "referralEnd")}
            {inp("Payable To", trs.referralPayTo, "referralPayTo")}
            {inp("Referral Brokerage", trs.referralBrokerage, "referralBrokerage")}
          </div>
        )}
        {inp("Special Instructions", trs.specialInstructions, "specialInstructions", "100%")}
      </div>
      <button onClick={function() { printState[1](true); }} style={{ marginTop: 12, width: "100%", padding: 10, background: T.ac, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: SA }}>
        Preview Trade Record Sheet
      </button>
    </div>
  );
}

// ====================================================================
// COMPLIANCE SUMMARY BUILDER (uses shared warranty detection)
// ====================================================================
function buildSummary(f) {
  if (!f) return [];
  var lines = [];

  // Mandatory fields
  var mandFields = [f.buyerName, f.sellerName, f.civicAddress || f.legalDescription, f.purchasePrice, f.possessionDate, f.irrevocability, f.buyerAddress, f.buyerBrokerage || f.sellerBrokerage];
  var mandPresent = mandFields.filter(Boolean).length;
  lines.push({ cat: "Mandatory Fields", text: mandPresent + "/8 present" + (mandPresent < 8 ? " (GAPS)" : ""), ok: mandPresent >= 8 });

  // Part Two
  var p2Text = !f.hasPartTwo ? "NOT DETECTED" : f._partTwoModified ? "MODIFIED - " + (f._partTwoModDetails || "see issues") : "Present, unmodified";
  lines.push({ cat: "Part Two", text: p2Text, ok: !!f.hasPartTwo && !f._partTwoModified });

  // Mortgage
  var mtgText = "";
  if (f.mortgageBox === "yes") {
    mtgText = "Yes" + (f.mortgageAmount ? ", $" + Number(f.mortgageAmount).toLocaleString() : ", amount BLANK");
    mtgText += f.cond7b_filled ? ", financing condition " + (f.cond7b_date || "") : ", NO financing condition";
  } else if (f.mortgageBox === "no") {
    mtgText = "No (cash offer)";
  } else {
    mtgText = f.mortgageBox || "not specified";
  }
  lines.push({ cat: "Mortgage", text: mtgText, ok: f.mortgageBox === "yes" ? !!f.cond7b_filled : f.mortgageBox === "no" });

  // Conditions
  var condParts = [];
  if (f.cond7a_filled) condParts.push("PDS " + (f.cond7a_date || ""));
  if (f.cond7b_filled) condParts.push("Financing " + (f.cond7b_date || ""));
  if (f.cond7c_filled) condParts.push("Inspection " + (f.cond7c_date || ""));
  var otherCond = f.cond7d_otherConditions || "";
  if (otherCond && !/^none$/i.test(otherCond.trim())) condParts.push("Other: " + otherCond.substring(0, 40));
  lines.push({ cat: "Conditions", text: condParts.length > 0 ? condParts.join(", ") : "None", ok: true });

  // PDS
  var pdsMap = { box1_condition: "Box 1 (condition)", box2_provided: "Box 2 (provided)", box3_not_required: "Box 3 (not required)", none_selected: "NONE SELECTED (defaults Box 3)" };
  lines.push({ cat: "PDS", text: pdsMap[f.pdsChoice] || f.pdsChoice || "unknown", ok: f.pdsChoice !== "none_selected" });

  // Homestead
  var hsMap = { not_homestead: "Box 1 (not homestead)", both_on_title: "Box 2 (both on title)", not_on_title: "Box 3 (not on title" + (f.homesteadSpouseName ? ", spouse: " + f.homesteadSpouseName : ", NO SPOUSE NAME") + ")", none_selected: "NONE SELECTED", deleted: "DELETED" };
  lines.push({ cat: "Homestead", text: hsMap[f.homestead] || f.homestead || "blank", ok: f.homestead && f.homestead !== "none_selected" && f.homestead !== "deleted" });

  // Residency
  var resMap = { resident: "Box 1 (resident)", non_resident: "Box 2 (NON-RESIDENT - s.116 required)", none_selected: "NONE SELECTED", deleted: "DELETED" };
  lines.push({ cat: "Residency", text: resMap[f.residency] || f.residency || "blank", ok: f.residency === "resident" });

  // Seller Response
  var respMap = { accepts: "Accepted", rejects: "Rejected", counters: "Counter-offer", none: "No response" };
  lines.push({ cat: "Seller Response", text: respMap[f.sellerResponse] || f.sellerResponse || "blank", ok: f.sellerResponse === "accepts" });

  // Warranties (uses shared _warParts and _hasAsIs from normalizeFields)
  var warText = "";
  if (f._warCount === 0 && !f._hasAsIs) {
    warText = "None amended";
  } else {
    var wp = f._warParts.slice();
    if (f._hasAsIs) wp.push("AS-IS");
    warText = wp.length > 0 ? wp.join(", ") + " amended" : "Custom amendments (review)";
  }
  lines.push({ cat: "Warranties", text: warText, ok: f._warCount === 0 && !f._hasAsIs });

  // Deposit
  var depText = "";
  if (f.depositAmounts.length > 0) {
    depText = "$" + f.depositAmounts.join(" + $");
    if (f.hasDepositMethod) depText += " via " + (f.depositMethods || []).join(", ");
    if (f.depositDeliveryDate) depText += " by " + f.depositDeliveryDate;
  } else {
    depText = "NONE";
  }
  lines.push({ cat: "Deposit", text: depText, ok: f.depositAmounts.length > 0 });

  // Remuneration
  var remText = "";
  if (f.remunerationPct) remText = f.remunerationPct + "% of purchase price";
  else if (f.remunerationFixedSum) remText = "$" + f.remunerationFixedSum + " fixed";
  else if (f.remunerationSeries && !/none/i.test(f.remunerationSeries)) remText = "Series: " + f.remunerationSeries;
  else remText = "BLANK";
  lines.push({ cat: "Remuneration", text: remText, ok: f.hasRem });

  // Timeline
  var tlOk = true;
  var tlNotes = [];
  if (f._ts.sellerSigned && f._ts.irrevocability) {
    var diff = tc(f._ts.sellerSigned, f._ts.irrevocability);
    if (diff !== null && diff > 0) { tlNotes.push("EXPIRED before acceptance"); tlOk = false; }
  }
  if (f.sellerResponse === "counters" && f._ts.buyerCounterSigned && f._ts.sellerCounterDeadline) {
    var cd = tc(f._ts.buyerCounterSigned, f._ts.sellerCounterDeadline);
    if (cd !== null && cd > 0) { tlNotes.push("Counter expired before buyer response"); tlOk = false; }
  }
  if (f._ts.possessionDate) {
    [f._ts.cond7a, f._ts.cond7b, f._ts.cond7c].forEach(function(c) {
      if (c && c > f._ts.possessionDate) { tlNotes.push("Condition after possession"); tlOk = false; }
    });
  }
  lines.push({ cat: "Timeline", text: tlOk ? "All dates chronological" : tlNotes.join(", "), ok: tlOk });

  // Representation
  var repText = "";
  if (f.buyerRepType === "both" || f.sellerRepType === "both") {
    repText = "LIMITED JOINT REPRESENTATION - verify consent form";
  } else {
    repText = (f.buyerBrokerage || "?") + " (buyer) / " + (f.sellerBrokerage || "?") + " (seller)";
  }
  lines.push({ cat: "Representation", text: repText, ok: (f.buyerRepType !== "both" && f.sellerRepType !== "both") || (f.buyerRepType === "both" && f.sellerRepType === "both") });

  // Solicitors
  lines.push({ cat: "Solicitors", text: (f.buyerSolicitor || "TBD") + " (buyer) / " + (f.sellerSolicitor || "TBD") + " (seller)", ok: !!(f.buyerSolicitor && f.sellerSolicitor) });

  // Capacity
  if (f.bCap || f.sCap || /executor|estate|POA|power\s+of|corp|inc|ltd|trust/i.test((f.buyerName || "") + (f.sellerName || ""))) {
    var capParts = [];
    if (/executor|estate/i.test((f.sCap || "") + (f.sellerName || ""))) capParts.push("Estate sale");
    if (/POA|power\s+of/i.test((f.bCap || "") + (f.sCap || ""))) capParts.push("POA");
    if (/corp|inc|ltd|trust/i.test((f.bCap || "") + (f.sCap || "") + (f.buyerName || "") + (f.sellerName || ""))) capParts.push("Corp/Trust");
    if (capParts.length > 0) lines.push({ cat: "Capacity", text: capParts.join(", "), ok: false });
  }

  // Amendments
  if (f.hasAm) {
    lines.push({ cat: "Amendments", text: (f._am || []).length + " counter-offer amendment(s)", ok: false });
  }

  // Signatures
  var sigParts = [];
  if (!f._sigBuyerP1) sigParts.push("Buyer P1");
  if (!f._sigSellerP1) sigParts.push("Seller P1");
  if (f.hasPartTwo && !f._sigBuyerP2) sigParts.push("Buyer P2");
  if (f.hasPartTwo && !f._sigSellerP2) sigParts.push("Seller P2");
  if (!f._initBuyer) sigParts.push("Buyer initials");
  if (!f._initSeller) sigParts.push("Seller initials");
  var sigOk = sigParts.length === 0;
  lines.push({ cat: "Signatures", text: sigOk ? "All signatures and initials present" : "MISSING: " + sigParts.join(", "), ok: sigOk });

  // Condo
  if (f._isCondo) {
    lines.push({ cat: "Condo", text: f._condoDesc, ok: !!(f.condoUnitNumber && f.condoCorpNumber && f._cesValid) });
  }

  // Attached Documents
  var docs = f._attachedDocs || [];
  if (docs.length > 0) {
    var docNames = docs.map(function(d) { return d.title || d.type; });
    lines.push({ cat: "Attached Docs", text: docs.length + " document(s): " + docNames.join(", "), ok: true });
  } else {
    var expectsDocs = f.schedule1_PDS || f.schedule2_AdditionalTerms || f.schedule3_MortgageAssumption || f.schedule4_Other || f.pdsChoice === "box1_condition" || f.pdsChoice === "box2_provided";
    lines.push({ cat: "Attached Docs", text: expectsDocs ? "NONE DETECTED (schedules may be missing)" : "None expected", ok: !expectsDocs });
  }

  // PDS Validation (only if PDS is present)
  if (f._pdsPresent) {
    var pdsParts = [];
    if (!f._pdsIsComplete) pdsParts.push("NOT COMPLETED");
    if (!f._pdsSellerOk) pdsParts.push("SELLER NOT SIGNED");
    if (!f._pdsBuyerOk) pdsParts.push("BUYER NOT SIGNED");
    if (f._pdsHasDisclosures && !f._pdsExplOk) pdsParts.push("MISSING EXPLANATIONS");
    if (f._pdsHasDisclosures && f._pdsExplOk) {
      var discItems = [];
      if (f._pdsNotCorrect.length > 0) discItems.push("Not Correct: " + f._pdsNotCorrect.join(","));
      if (f._pdsDoNotKnow.length > 0) discItems.push("Do Not Know: " + f._pdsDoNotKnow.join(","));
      pdsParts.push("Disclosures on items " + discItems.join("; "));
    }
    var pdsOk = f._pdsIsComplete && f._pdsSellerOk && f._pdsBuyerOk && f._pdsExplOk;
    lines.push({ cat: "PDS Status", text: pdsOk ? "Completed, signed by both parties" + (f._pdsHasDisclosures ? " (has disclosures with explanations)" : "") : pdsParts.join(", "), ok: pdsOk });
  }

  return lines;
}

function ComplianceSummary(p) {
  return (
    <div style={{ background: T.s1, borderRadius: 8, border: "1px solid " + T.bd, padding: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 700, fontFamily: MO, color: T.dm, marginBottom: 6, letterSpacing: "0.1em" }}>COMPLIANCE SNAPSHOT</div>
      {(p.lines || []).map(function(l) {
        return (
          <div key={l.cat} style={{ display: "flex", alignItems: "flex-start", padding: "3px 0", borderBottom: "1px solid " + T.bd + "15" }}>
            <span style={{ fontSize: 10, color: T.dm, minWidth: 100, flexShrink: 0 }}>{l.cat}</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: l.ok ? T.ok : T.hi, marginTop: 4, marginRight: 6, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: l.ok ? T.ok : T.hi, fontFamily: MO, lineHeight: 1.4, wordBreak: "break-word" }}>{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ====================================================================
// AGENT VIEW
// ====================================================================
function AgentView(p) {
  var phState = useState("upload");
  var fnState = useState("");
  var prState = useState("");
  var flState = useState(null);
  var rsState = useState([]);
  var cxState = useState("la");
  var nmState = useState("");
  var snState = useState(false);
  var exState = useState(false);
  var trsOpen = useState(false);
  var dragState = useState(false);
  var ftState = useState("residential");
  var ref = useRef(null);

  var phase = phState[0], setPhase = phState[1];
  var fname = fnState[0], setFname = fnState[1];
  var setProg = prState[1];
  var fields = flState[0], setFields = flState[1];
  var results = rsState[0], setResults = rsState[1];
  var ctx = cxState[0], setCtx = cxState[1];
  var name = nmState[0], setName = nmState[1];
  var submitted = snState[0], setSubmitted = snState[1];
  var showExtracted = exState[0], setShowExtracted = exState[1];
  var formType = ftState[0], setFormType = ftState[1];

  var go = useCallback(function(f) {
    setPhase("proc"); setFname(f.name); setSubmitted(false); trsOpen[1](false);
    extractOffer(f, formType, prState[1]).then(function(r) {
      r.fields.formType = formType === "condo" ? "condo_unit" : "residential";
      setFields(r.fields);
      setResults(runRules(r.fields, ctx, formType));
      setPhase("done");
    }).catch(function(e) {
      prState[1]("Error: " + e.message);
      setPhase("error");
    });
  }, [ctx, formType]);

  var active = results.filter(function(r) { return !r.suppressed; });
  var triggered = active.filter(function(r) { return r.triggered; });
  var passed = active.filter(function(r) { return !r.triggered; });
  var suppressed = results.filter(function(r) { return r.suppressed; });
  var cnt = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  triggered.forEach(function(r) { cnt[r.sev]++; });
  var grade = cnt.CRITICAL > 0 ? "FAIL" : cnt.HIGH > 2 ? "REVIEW" : cnt.HIGH > 0 ? "CAUTION" : "PASS";
  var gradeColor = gC(grade);
  var isRejected = fields && fields.sellerResponse === "rejects";

  var reset = function() { setPhase("upload"); setResults([]); setFields(null); setSubmitted(false); setShowExtracted(false); trsOpen[1](false); };

  var submit = function() {
    var entry = {
      id: String(Date.now()), fn: fname, agent: name || "Agent", ctx: ctx,
      g: grade, cnt: cnt, tr: triggered, pa: passed, f: fields,
      at: new Date().toISOString(), bs: "pending", bn: ""
    };
    saveOffer(entry);
    p.onSubmit(entry);
    setSubmitted(true);
  };

  var fl = fields;
  var ctxLabel = { w: "Writing", lp: "Listing Pre", la: "Listing Post" }[ctx] || "";

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      {phase === "upload" && (
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Submit Offer for Review</div>
          <div style={{ fontSize: 13, color: T.m, marginBottom: 20 }}>{ACTIVE_RULE_COUNT + " rules. Context-aware. AI extraction."}</div>
          <input placeholder="Your name" value={name} onChange={function(e) { setName(e.target.value); }}
            style={{ width: "100%", padding: "10px 14px", background: T.s2, border: "1px solid " + T.bd, borderRadius: 8, color: T.tx, fontSize: 13, outline: "none", marginBottom: 12, boxSizing: "border-box", fontFamily: SA }} />
          <div style={{ fontSize: 9, color: T.dm, fontFamily: MO, marginBottom: 4, letterSpacing: "0.1em" }}>FORM TYPE</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["residential", "Residential", "Standard OTP"], ["condo", "Condo Unit", "Condominium Unit OTP"]].map(function(a) {
              return (
                <button key={a[0]} onClick={function() { setFormType(a[0]); }}
                  style={{ flex: "1 1 100px", padding: "10px 8px", background: formType === a[0] ? T.ad : T.s1, border: "1px solid " + (formType === a[0] ? T.ac : T.bd), borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: formType === a[0] ? T.ac : T.tx, fontFamily: SA }}>{a[1]}</div>
                  <div style={{ fontSize: 9, color: T.dm, marginTop: 2 }}>{a[2]}</div>
                </button>
              );
            })}
          </div>
          <div
            onClick={function() { ref.current.click(); }}
            onDragOver={function(e) { e.preventDefault(); e.stopPropagation(); dragState[1](true); }}
            onDragEnter={function(e) { e.preventDefault(); e.stopPropagation(); dragState[1](true); }}
            onDragLeave={function(e) { e.preventDefault(); e.stopPropagation(); dragState[1](false); }}
            onDrop={function(e) {
              e.preventDefault(); e.stopPropagation(); dragState[1](false);
              var files = e.dataTransfer && e.dataTransfer.files;
              if (files && files.length > 0 && /\.pdf$/i.test(files[0].name)) go(files[0]);
            }}
            style={{ border: "2px dashed " + (dragState[0] ? T.ac : T.ac + "40"), borderRadius: 12, padding: "50px 20px", textAlign: "center", cursor: "pointer", background: dragState[0] ? T.ad : "transparent", transition: "all 0.15s" }}>
            <input ref={ref} type="file" accept=".pdf" onChange={function(e) { var f = e.target.files && e.target.files[0]; if (f) go(f); }} style={{ display: "none" }} />
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>PDF</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: dragState[0] ? T.ac : T.tx }}>{dragState[0] ? "Drop PDF here" : "Click or drag offer PDF"}</div>
          </div>
        </div>
      )}

      {phase === "proc" && (
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ width: 36, height: 36, border: "3px solid " + T.bd, borderTop: "3px solid " + T.ac, borderRadius: "50%", margin: "0 auto 20px", animation: "spin 0.8s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{fname}</div>
          <div style={{ fontSize: 12, color: T.m, fontFamily: MO }}>{prState[0]}</div>
        </div>
      )}

      {phase === "error" && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.5 }}>!</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.cr, marginBottom: 8 }}>Analysis Failed</div>
          <div style={{ fontSize: 11, color: T.m, fontFamily: MO, maxWidth: 500, margin: "0 auto 16px", wordBreak: "break-word", lineHeight: 1.5 }}>{prState[0]}</div>
          <button onClick={reset} style={{ padding: "10px 24px", background: T.s1, border: "1px solid " + T.bd, borderRadius: 8, color: T.tx, fontSize: 12, cursor: "pointer" }}>Try Again</button>
        </div>
      )}

      {phase === "done" && fl && (
        <div>
          {/* Grade */}
          <div style={{ textAlign: "center", padding: "20px 16px", marginBottom: 14, background: T.s1, borderRadius: 12, border: "1px solid " + T.bd }}>
            <div style={{ fontSize: 9, color: T.dm, textTransform: "uppercase", fontFamily: MO, letterSpacing: "0.15em" }}>
              {"Compliance - " + ctxLabel}
            </div>
            <div style={{ fontSize: 44, fontWeight: 800, color: gradeColor, fontFamily: MO }}>{grade}</div>
            <div style={{ fontSize: 11, color: T.m }}>{fl.propAddr || fname}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 12 }}>
              {[["C", cnt.CRITICAL, T.cr], ["H", cnt.HIGH, T.hi], ["M", cnt.MEDIUM, T.md], ["L", cnt.LOW, T.lo], ["OK", passed.length, T.ok]].map(function(a) {
                return <div key={a[0]}><div style={{ fontSize: 20, fontWeight: 700, color: a[2], fontFamily: MO }}>{a[1]}</div><div style={{ fontSize: 8, color: T.dm }}>{a[0]}</div></div>;
              })}
            </div>
            {suppressed.length > 0 && (
              <div style={{ fontSize: 9, color: T.dm, marginTop: 8, fontFamily: MO }}>
                {suppressed.length + " rules suppressed (" + ctxLabel + " context)"}
              </div>
            )}
          </div>

          {/* Rejected offer notice */}
          {isRejected && (
            <div style={{ padding: "12px 16px", marginBottom: 14, background: T.cb, border: "1px solid " + T.cr + "30", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.cr }}>REJECTED OFFER</div>
              <div style={{ fontSize: 11, color: T.m, marginTop: 4 }}>Not submitted for broker review. Fix flagged issues before your next offer.</div>
            </div>
          )}

          {/* Amendments */}
          {fl.hasAm && (
            <div style={{ marginBottom: 12, padding: "10px 14px", background: T.hb, border: "1px solid " + T.hi + "25", borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.hi, fontFamily: MO, marginBottom: 6 }}>COUNTER-OFFER AMENDMENTS</div>
              {(fl._am || []).map(function(a, i) {
                return <div key={i} style={{ fontSize: 11, marginBottom: 4, lineHeight: 1.5 }}>
                  <span style={{ color: T.m }}>{a.field}: </span>
                  <span style={{ color: T.cr, textDecoration: "line-through" }}>{a.original}</span>
                  <span style={{ color: T.dm }}>{" -> "}</span>
                  <span style={{ color: T.ok, fontWeight: 600 }}>{a.amended}</span>
                </div>;
              })}
            </div>
          )}

          {/* Extracted Fields */}
          <div style={{ marginBottom: 12 }}>
            <div onClick={function() { setShowExtracted(!showExtracted); }} style={{ fontSize: 10, fontWeight: 700, fontFamily: MO, color: T.ac, cursor: "pointer", padding: "6px 0" }}>
              {(showExtracted ? "- " : "+ ") + "EXTRACTED FIELDS"}
            </div>
            {showExtracted && (
              <div style={{ background: T.s1, borderRadius: 8, border: "1px solid " + T.bd, padding: 10 }}>
                {[
                  ["Form Type", fl.formType === "condo_unit" ? "Condo Unit OTP" : "Residential OTP"],
                  ["Buyer", fl.buyerName], ["Seller", fl.sellerName], ["Property", fl.propAddr],
                  ["Legal Desc", fl.legalDescription],
                  ["Offer Price", fl.purchasePrice ? "$" + Number(fl.purchasePrice).toLocaleString() : ""],
                  ["Counter Price", fl._hasCounterPrice ? "$" + Number(fl.counterOfferPrice).toLocaleString() : ""],
                  ["Selling Price", fl.effectivePrice ? "$" + Number(fl.effectivePrice).toLocaleString() : ""],
                  ["Mortgage", fl.mortgageBox + (fl.mortgageAmount ? " ($" + Number(fl.mortgageAmount).toLocaleString() + ")" : "")],
                  ["Possession", fl.possessionDate], ["Deposit", fl.depositTotal + (fl.hasDepositMethod ? " via " + (fl.depositMethods || []).join(", ") : "")],
                  ["PDS", fl.pdsChoice], ["Homestead", fl.homestead], ["Residency", fl.residency],
                  ["Seller Response", fl.sellerResponse], ["Irrevocability", fl.irrevocability || ""],
                  ["Sec 9 Amendments", fl.section9Amendments || ""], ["Part Two", fl.hasPartTwo ? "Yes" : "No"]
                ].concat(fl.formType === "condo_unit" ? [
                  ["Unit #", fl.condoUnitNumber || ""], ["Project", fl.condoProjectName || ""],
                  ["Corp #", fl.condoCorpNumber || ""], ["Common Element", fl.commonElementShare ? fl.commonElementShare + "%" : ""],
                  ["Parking", fl.parkingStall || ""], ["Locker", fl.lockerStorage || ""]
                ] : []).map(function(r) {
                  return <div key={r[0]} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid " + T.bd + "20" }}>
                    <span style={{ fontSize: 10, color: T.dm, minWidth: 90 }}>{r[0]}</span>
                    <span style={{ fontSize: 10, fontFamily: MO, color: r[1] ? T.tx : T.cr, textAlign: "right", flex: 1, marginLeft: 8, wordBreak: "break-word" }}>{r[1] || "-"}</span>
                  </div>;
                })}
              </div>
            )}
          </div>

          {/* Issues (section-ordered) */}
          {triggered.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, fontFamily: MO, marginBottom: 6 }}>{"ISSUES (" + triggered.length + ")"}</div>
              <SectionIssues issues={triggered} />
            </div>
          )}

          {/* Passed */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 10, fontWeight: 700, color: T.ok, fontFamily: MO, cursor: "pointer" }}>{"PASSED (" + passed.length + ")"}</summary>
            <div style={{ marginTop: 4 }}>{passed.map(function(r) { return <div key={r.id} style={{ padding: "3px 8px", fontSize: 9, color: T.ok, fontFamily: MO }}>{r.id + " " + r.check}</div>; })}</div>
          </details>

          {/* Trade Record Sheet */}
          {!isRejected && (
            <div style={{ marginBottom: 14 }}>
              <button onClick={function() { trsOpen[1](!trsOpen[0]); }}
                style={{ width: "100%", padding: 10, background: trsOpen[0] ? T.s2 : T.ad, border: "1px solid " + (trsOpen[0] ? T.ac : T.ac + "40"), borderRadius: 8, color: T.ac, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: SA }}>
                {(trsOpen[0] ? "- " : "+ ") + "Trade Record Sheet"}
              </button>
              {trsOpen[0] && <div style={{ marginTop: 8 }}><TradeRecordSheet fields={fl} /></div>}
            </div>
          )}

          {/* Submit / Reset */}
          {isRejected ? (
            <button onClick={reset} style={{ width: "100%", padding: 12, background: "transparent", border: "1px solid " + T.bd, borderRadius: 8, color: T.m, fontSize: 12, cursor: "pointer" }}>Review Another Offer</button>
          ) : submitted ? (
            <div style={{ padding: 16, background: T.ob, borderRadius: 10, textAlign: "center", border: "1px solid " + T.ok + "30" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ok }}>Submitted to Broker Queue</div>
              <button onClick={reset} style={{ marginTop: 10, padding: "8px 20px", background: "transparent", border: "1px solid " + T.bd, borderRadius: 6, color: T.m, fontSize: 11, cursor: "pointer" }}>Review Another</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={reset} style={{ flex: 1, padding: 12, background: "transparent", border: "1px solid " + T.bd, borderRadius: 8, color: T.m, fontSize: 12, cursor: "pointer" }}>Reset</button>
              <button onClick={submit} style={{ flex: 2, padding: 12, background: cnt.CRITICAL > 0 ? T.cr : T.ac, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {cnt.CRITICAL > 0 ? "Submit (Critical Issues)" : "Submit to Broker"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ====================================================================
// TIMELINE VISUAL
// ====================================================================
function OfferTimeline(p) {
  var f = p.fields || {};
  var events = [];
  function addE(label, raw, ts, type) {
    if (raw && raw.length > 2) events.push({ label: label, raw: raw, ts: ts, type: type });
  }
  addE("Offer Signed", f.offerSigned, f._ts ? f._ts.offerSigned : null, "buyer");
  addE("Irrevocability", f.irrevocability, f._ts ? f._ts.irrevocability : null, "deadline");
  if (f.sellerResponse === "accepts") {
    addE("Seller Accepts", f.sellerSigned, f._ts ? f._ts.sellerSigned : null, "seller");
  }
  if (f.sellerResponse === "counters") {
    addE("Seller Counters", f.sellerSigned, f._ts ? f._ts.sellerSigned : null, "seller");
    addE("Counter Deadline", f.sellerCounterDeadline, f._ts ? f._ts.sellerCounterDeadline : null, "deadline");
    if (f.buyerCounterResponse === "accepts") {
      addE("Buyer Accepts Counter", f.buyerCounterSigned, f._ts ? f._ts.buyerCounterSigned : null, "buyer");
    } else if (f.buyerCounterResponse === "rejects") {
      addE("Buyer Rejects Counter", f.buyerCounterSigned, f._ts ? f._ts.buyerCounterSigned : null, "fail");
    }
  }
  if (f.cond7a_filled) addE("PDS Condition", (f.cond7a_time || "") + " " + (f.cond7a_date || ""), f._ts ? f._ts.cond7a : null, "condition");
  if (f.cond7b_filled) addE("Finance Condition", (f.cond7b_time || "") + " " + (f.cond7b_date || ""), f._ts ? f._ts.cond7b : null, "condition");
  if (f.cond7c_filled) addE("Inspection Condition", (f.cond7c_time || "") + " " + (f.cond7c_date || ""), f._ts ? f._ts.cond7c : null, "condition");
  addE("Possession", f.possessionDate, f._ts ? f._ts.possessionDate : null, "possession");

  // Sort by timestamp
  events.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });

  // Validate sequences
  var checks = [];
  var tsI = f._ts || {};
  if (tsI.sellerSigned && tsI.irrevocability) {
    var d = tsI.sellerSigned - tsI.irrevocability;
    checks.push({ ok: d <= 0, text: d <= 0 ? "Seller responded before irrevocability" : "VOID: Seller responded AFTER irrevocability expired" });
  }
  if (f.sellerResponse === "counters" && tsI.buyerCounterSigned && tsI.sellerCounterDeadline) {
    var d2 = tsI.buyerCounterSigned - tsI.sellerCounterDeadline;
    checks.push({ ok: d2 <= 0, text: d2 <= 0 ? "Buyer accepted counter before deadline" : "VOID: Buyer responded AFTER counter expired" });
  }
  if (f.sellerResponse === "counters" && tsI.sellerSigned && tsI.irrevocability) {
    var d3 = tsI.sellerSigned - tsI.irrevocability;
    checks.push({ ok: d3 <= 0, text: d3 <= 0 ? "Counter within irrevocability window" : "Counter AFTER irrevocability" });
  }

  var typeColor = { buyer: T.ac, seller: T.hi, deadline: T.cr, condition: T.md, possession: T.ok, fail: T.cr };

  if (events.length === 0) return null;

  return (
    <div style={{ background: T.s1, borderRadius: 10, border: "1px solid " + T.bd, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 700, fontFamily: MO, color: T.dm, marginBottom: 10, letterSpacing: "0.1em" }}>OFFER TIMELINE</div>
      <div style={{ position: "relative", paddingLeft: 14 }}>
        <div style={{ position: "absolute", left: 6, top: 0, bottom: 0, width: 2, background: T.bd }} />
        {events.map(function(e, i) {
          var col = typeColor[e.type] || T.dm;
          return (
            <div key={i} style={{ position: "relative", paddingLeft: 16, paddingBottom: 10, minHeight: 28 }}>
              <div style={{ position: "absolute", left: -2, top: 3, width: 10, height: 10, borderRadius: "50%", background: col, border: "2px solid " + T.s1 }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: col }}>{e.label}</span>
                <span style={{ fontSize: 10, fontFamily: MO, color: T.m, marginLeft: 8 }}>{e.raw}</span>
              </div>
              {e.type === "seller" && f._hasCounterPrice && (
                <div style={{ fontSize: 9, color: T.hi, fontFamily: MO, marginTop: 1 }}>{"Price: $" + Number(f.purchasePrice).toLocaleString() + " -> $" + Number(f.counterOfferPrice).toLocaleString()}</div>
              )}
            </div>
          );
        })}
      </div>
      {checks.length > 0 && (
        <div style={{ marginTop: 6, borderTop: "1px solid " + T.bd, paddingTop: 8 }}>
          {checks.map(function(c, i) {
            return <div key={i} style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.ok ? T.ok : T.cr, flexShrink: 0 }} />
              <span style={{ color: c.ok ? T.ok : T.cr, fontFamily: MO }}>{c.text}</span>
            </div>;
          })}
        </div>
      )}
    </div>
  );
}

// ====================================================================
// BROKER DRILL-IN
// ====================================================================
function DrillIn(p) {
  var nsState = useState(p.item.bn || "");
  var invState = useState(false);
  var notes = nsState[0], setNotes = nsState[1];
  var showInvoice = invState[0], setShowInvoice = invState[1];
  var gc = gC(p.item.g);
  var f = p.item.f || {};
  var summary = buildSummary(f);
  var issues = p.item.tr || [];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={p.onBack} style={{ padding: "5px 12px", background: "transparent", border: "1px solid " + T.bd, borderRadius: 6, color: T.m, cursor: "pointer", fontSize: 12 }}>Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{f.propAddr || p.item.fn}</div>
          <div style={{ fontSize: 10, color: T.dm }}>{f.buyerName + " to " + f.sellerName + " | " + p.item.agent + " | " + (f.effectivePrice ? "$" + Number(f.effectivePrice).toLocaleString() : (f.purchasePrice ? "$" + Number(f.purchasePrice).toLocaleString() : ""))}</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: gc, fontFamily: MO }}>{p.item.g}</div>
      </div>

      {f.hasAm && (
        <div style={{ marginBottom: 12, padding: "10px 14px", background: T.hb, border: "1px solid " + T.hi + "25", borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hi, fontFamily: MO, marginBottom: 6 }}>COUNTER-OFFER AMENDMENTS</div>
          {(f._am || []).map(function(a, i) {
            return <div key={i} style={{ fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: T.m }}>{a.field}: </span><span style={{ color: T.cr, textDecoration: "line-through" }}>{a.original}</span>
              <span style={{ color: T.dm }}>{" -> "}</span><span style={{ color: T.ok, fontWeight: 600 }}>{a.amended}</span>
            </div>;
          })}
        </div>
      )}

      <OfferTimeline fields={f} />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ flex: "1 1 380px" }}>
          <ComplianceSummary lines={summary} />
        </div>
        {issues.length > 0 && (
          <div style={{ flex: "1 1 340px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: MO, color: T.cr, marginBottom: 6, letterSpacing: "0.1em" }}>
              {"ISSUES (" + issues.length + ")"}
            </div>
            <SectionIssues issues={issues} />
          </div>
        )}
      </div>

      <div style={{ background: T.s1, borderRadius: 10, border: "1px solid " + T.bd, padding: 14 }}>
        <div style={{ fontSize: 9, fontWeight: 700, fontFamily: MO, color: T.dm, marginBottom: 6 }}>BROKER REVIEW</div>
        <textarea value={notes} onChange={function(e) { setNotes(e.target.value); }} placeholder="Notes for agent..."
          style={{ width: "100%", padding: 10, background: T.bg, border: "1px solid " + T.bd, borderRadius: 6, color: T.tx, fontSize: 12, minHeight: 60, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: SA }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={function() { p.onUpdate(p.item.id, "approved", notes); p.onBack(); }} style={{ flex: 1, padding: 12, background: T.ok, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Approve</button>
          <button onClick={function() { if (!notes.trim()) { alert("Add notes before returning."); return; } p.onUpdate(p.item.id, "returned", notes); p.onBack(); }} style={{ flex: 1, padding: 12, background: T.cr, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Return to Agent</button>
        </div>
      </div>

      {/* Lawyer Invoice / Conveyancing Direction */}
      <div style={{ marginTop: 14 }}>
        <button onClick={function() { setShowInvoice(!showInvoice); }}
          style={{ width: "100%", padding: 10, background: showInvoice ? T.s2 : T.s1, border: "1px solid " + T.bd, borderRadius: 8, color: T.hi, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: SA }}>
          {(showInvoice ? "- " : "+ ") + "Lawyer Invoice / Conveyancing Direction"}
        </button>
        {showInvoice && (
          <div style={{ marginTop: 8, background: T.s1, borderRadius: 10, border: "1px solid " + T.bd, padding: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: MO, color: T.hi, marginBottom: 10, letterSpacing: "0.08em" }}>CONVEYANCING DIRECTION</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {[
                ["Property", f.propAddr || ""],
                ["Selling Price", f.effectivePrice ? "$" + Number(f.effectivePrice).toLocaleString() : (f.purchasePrice ? "$" + Number(f.purchasePrice).toLocaleString() : "")],
                ["Possession", f.possessionDate || ""],
                ["Buyer(s)", f.buyerName || ""],
                ["Seller(s)", f.sellerName || ""],
                ["Commission", f.remunerationPct ? f.remunerationPct + "% of Purchase Price" : (f.remunerationFixedSum ? "$" + f.remunerationFixedSum : "See Section 14")],
                ["Commission Amount", f.remunerationPct && f.effectivePrice ? "$" + (Number(f.effectivePrice) * parseFloat(f.remunerationPct) / 100).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : ""],
                ["Deposit", f.depositTotal || ""],
                ["Buyer Solicitor", (f.buyerSolicitor || "TBD") + (f.buyerSolicitorFirm ? " - " + f.buyerSolicitorFirm : "")],
                ["Seller Solicitor", (f.sellerSolicitor || "TBD") + (f.sellerSolicitorFirm ? " - " + f.sellerSolicitorFirm : "")],
                ["Listing Brokerage", f.sellerBrokerage || ""],
                ["Selling Brokerage", f.buyerBrokerage || ""]
              ].map(function(r) {
                return r[1] ? (
                  <div key={r[0]} style={{ flex: "1 1 45%", minWidth: 200 }}>
                    <div style={{ fontSize: 8, color: T.dm, fontFamily: MO }}>{r[0]}</div>
                    <div style={{ fontSize: 11, color: T.tx, fontFamily: MO, padding: "3px 0" }}>{r[1]}</div>
                  </div>
                ) : null;
              })}
            </div>
            <div style={{ borderTop: "1px solid " + T.bd, paddingTop: 10, display: "flex", gap: 8 }}>
              <button onClick={function() { window.print(); }}
                style={{ flex: 1, padding: 10, background: T.hi, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                Print / Save PDF
              </button>
              <button onClick={function() {
                var text = "CONVEYANCING DIRECTION\n\nProperty: " + (f.propAddr || "") + "\nSelling Price: $" + (f.effectivePrice || f.purchasePrice || "") + "\nPossession: " + (f.possessionDate || "") + "\nBuyer(s): " + (f.buyerName || "") + "\nSeller(s): " + (f.sellerName || "") + "\nCommission: " + (f.remunerationPct ? f.remunerationPct + "%" : "$" + (f.remunerationFixedSum || "?")) + "\nDeposit: " + (f.depositTotal || "") + "\nBuyer Solicitor: " + (f.buyerSolicitor || "TBD") + "\nSeller Solicitor: " + (f.sellerSolicitor || "TBD") + "\nListing Brokerage: " + (f.sellerBrokerage || "") + "\nSelling Brokerage: " + (f.buyerBrokerage || "");
                navigator.clipboard.writeText(text).then(function() { alert("Copied to clipboard"); });
              }}
                style={{ flex: 1, padding: 10, background: T.ac, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                Copy to Clipboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ====================================================================
// BROKER VIEW
// ====================================================================
var GO = { FAIL: 0, REVIEW: 1, CAUTION: 2, PASS: 3 };

function BrokerView(p) {
  var selState = useState(null);
  var filtState = useState("pending");
  var expState = useState(null);
  var sel = selState[0], setSel = selState[1];
  var filt = filtState[0], setFilt = filtState[1];
  var expanded = expState[0], setExpanded = expState[1];
  var stc = function(s) { return { pending: T.hi, approved: T.ok, returned: T.cr }[s] || T.dm; };

  var sorted = p.queue.slice().sort(function(a, b) {
    if (a.bs === "pending" && b.bs !== "pending") return -1;
    if (a.bs !== "pending" && b.bs === "pending") return 1;
    return (GO[a.g] || 3) - (GO[b.g] || 3);
  });

  var filtered = sorted.filter(function(x) {
    if (filt === "all") return true;
    if (filt === "critical") return x.g === "FAIL";
    if (filt === "returned") return x.bs === "returned";
    return x.bs === filt;
  });

  var item = sel !== null ? p.queue.find(function(x) { return x.id === sel; }) : null;
  var pn = p.queue.filter(function(x) { return x.bs === "pending"; }).length;
  var handleUpdate = function(id, status, notes) { p.onUpdate(id, status, notes); updateOffer(id, { bs: status, bn: notes }); };

  if (item) return <DrillIn item={item} onBack={function() { setSel(null); }} onUpdate={handleUpdate} />;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Broker Dashboard</div>
        {pn > 0 && <div style={{ fontSize: 12, color: T.hi, fontFamily: MO }}>{pn + " pending review"}</div>}
      </div>

      {p.queue.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            ["pending", "Pending", pn, T.hi],
            ["all", "All", p.queue.length, T.ac],
            ["critical", "Critical", p.queue.filter(function(x) { return x.g === "FAIL"; }).length, T.cr],
            ["approved", "Approved", p.queue.filter(function(x) { return x.bs === "approved"; }).length, T.ok],
            ["returned", "Returned", p.queue.filter(function(x) { return x.bs === "returned"; }).length, T.cr]
          ].map(function(a) {
            return <button key={a[0]} onClick={function() { setFilt(a[0]); setExpanded(null); }}
              style={{ flex: "1 1 60px", padding: "8px 6px", background: filt === a[0] ? a[3] + "15" : T.s1, border: "1px solid " + (filt === a[0] ? a[3] + "40" : T.bd), borderRadius: 8, cursor: "pointer", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: a[3], fontFamily: MO }}>{a[2]}</div>
              <div style={{ fontSize: 8, color: T.dm, textTransform: "uppercase" }}>{a[1]}</div>
            </button>;
          })}
        </div>
      )}

      {p.queue.length === 0 && <div style={{ textAlign: "center", padding: 60, color: T.dm }}>No offers in queue.</div>}

      {filtered.map(function(x) {
        var ic = gC(x.g);
        var f = x.f || {};
        var isExpanded = expanded === x.id;
        var summary = isExpanded ? buildSummary(f) : null;
        var issueCount = (x.tr || []).length;

        return (
          <div key={x.id} style={{ marginBottom: 6, background: T.s1, borderLeft: "3px solid " + ic, borderRadius: "0 8px 8px 0", overflow: "hidden" }}>
            <div onClick={function() { setExpanded(isExpanded ? null : x.id); }} style={{ padding: "10px 14px", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 800, color: ic, fontFamily: MO, fontSize: 11, width: 56, textAlign: "center", padding: "2px 0", background: ic + "15", borderRadius: 4 }}>{x.g}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{f.propAddr || x.fn}</div>
                    <div style={{ fontSize: 10, color: T.dm }}>{(f.buyerName || "?") + " to " + (f.sellerName || "?") + " | $" + (f.effectivePrice ? Number(f.effectivePrice).toLocaleString() : (f.purchasePrice ? Number(f.purchasePrice).toLocaleString() : "?"))}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {issueCount > 0 && (
                    <div style={{ display: "flex", gap: 3 }}>
                      {x.cnt && x.cnt.CRITICAL > 0 && <span style={{ fontSize: 8, padding: "1px 5px", background: T.cr + "20", color: T.cr, borderRadius: 3, fontFamily: MO, fontWeight: 700 }}>{x.cnt.CRITICAL + "C"}</span>}
                      {x.cnt && x.cnt.HIGH > 0 && <span style={{ fontSize: 8, padding: "1px 5px", background: T.hi + "20", color: T.hi, borderRadius: 3, fontFamily: MO, fontWeight: 700 }}>{x.cnt.HIGH + "H"}</span>}
                      {x.cnt && x.cnt.MEDIUM > 0 && <span style={{ fontSize: 8, padding: "1px 5px", background: T.md + "20", color: T.md, borderRadius: 3, fontFamily: MO, fontWeight: 700 }}>{x.cnt.MEDIUM + "M"}</span>}
                    </div>
                  )}
                  <span style={{ fontSize: 8, padding: "2px 8px", borderRadius: 10, background: stc(x.bs) + "15", color: stc(x.bs), fontFamily: MO, textTransform: "uppercase", fontWeight: 700 }}>{x.bs}</span>
                  <span style={{ fontSize: 12, color: T.dm }}>{isExpanded ? "-" : "+"}</span>
                </div>
              </div>
              <div style={{ fontSize: 9, color: T.dm, marginTop: 2 }}>{x.agent + " | " + (x.at ? new Date(x.at).toLocaleString() : "")}</div>
            </div>

            {isExpanded && (
              <div style={{ padding: "0 14px 14px 14px" }}>
                <ComplianceSummary lines={summary} />
                {issueCount > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, fontFamily: MO, color: T.cr, marginBottom: 4, letterSpacing: "0.1em" }}>{"ISSUES (" + issueCount + ")"}</div>
                    <SectionIssues issues={x.tr} compact max={5} />
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={function() { setSel(x.id); }}
                    style={{ flex: 2, padding: 10, background: T.ac, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Full Review
                  </button>
                  {x.bs === "pending" && x.g === "PASS" && (
                    <button onClick={function() { handleUpdate(x.id, "approved", ""); setExpanded(null); }}
                      style={{ flex: 1, padding: 10, background: T.ok, border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Quick Approve
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ====================================================================
// DEAL CHECKLIST (auto-populated from offer data)
// ====================================================================
function buildChecklist(f) {
  var items = [];
  // PDS
  if (f.pdsChoice === "box1_condition") {
    items.push({ id: "pds_attached", label: "Property Disclosure Statement (Schedule 1) attached", required: false, cite: "OTP Part One s.6 Box 1 + s.10.2(a)" });
    items.push({ id: "pds_fulfillment", label: "PDS condition fulfillment/waiver signed by buyer (by " + (f.cond7a_date || "?") + ")", required: false, cite: "OTP Part Two s.7(d)" });
  } else if (f.pdsChoice === "box2_provided") {
    items.push({ id: "pds_attached", label: "Property Disclosure Statement (Schedule 1) attached", required: false, cite: "OTP Part One s.6 Box 2" });
  }
  // Schedule 2
  if (f.schedule2_AdditionalTerms) {
    items.push({ id: "sch2", label: "Schedule 2 (Additional Terms) attached", required: false, cite: "OTP Part One s.10.2(b)" });
  }
  // Schedule 3
  if (f.schedule3_MortgageAssumption) {
    items.push({ id: "sch3", label: "Schedule 3 (Mortgage Assumption) attached", required: false, cite: "OTP Part One s.10.2(c)" });
  }
  // Schedule 4
  if (f.schedule4_Other) {
    items.push({ id: "sch4", label: "Schedule 4 (" + (f.schedule4_Description || "Other") + ") attached", required: false, cite: "OTP Part One s.10.2(d)" });
  }
  // Financing condition
  if (f.cond7b_filled) {
    items.push({ id: "fin_fulfill", label: "Financing condition fulfillment/waiver (by " + (f.cond7b_date || "?") + ")", required: false, cite: "OTP Part Two s.7(d)" });
  }
  // Inspection condition
  if (f.cond7c_filled) {
    items.push({ id: "insp_fulfill", label: "Inspection condition fulfillment/waiver (by " + (f.cond7c_date || "?") + ")", required: false, cite: "OTP Part Two s.7(d)" });
  }
  // Other conditions
  if (f.cond7d_otherConditions && !/^none$/i.test(f.cond7d_otherConditions.trim())) {
    items.push({ id: "other_fulfill", label: "Other condition fulfillment: " + f.cond7d_otherConditions.substring(0, 40), required: false, cite: "OTP Part Two s.7(d)" });
  }
  // Homestead Form 3
  if (f.homestead === "not_on_title") {
    items.push({ id: "form3", label: "Form 3 Homestead Consent from spouse", required: false, cite: "The Homesteads Act" });
  }
  // LJR consent
  if (f.buyerRepType === "both" || f.sellerRepType === "both") {
    items.push({ id: "ljr_consent", label: "Consent to Limited Joint Representation form signed", required: false, cite: "RESA s.30; Reg. 4.14" });
  }
  // Part Two signed
  items.push({ id: "p2_signed", label: "Part Two signed by all parties", required: false, cite: "OTP Part One s.11/15 notes" });
  // Lawyer info
  if (!f.buyerSolicitor || f.buyerSolicitor.length < 2) {
    items.push({ id: "buyer_lawyer", label: "Buyer solicitor information to follow", required: false, cite: "OTP Part One s.18" });
  }
  if (!f.sellerSolicitor || f.sellerSolicitor.length < 2) {
    items.push({ id: "seller_lawyer", label: "Seller solicitor information to follow", required: false, cite: "OTP Part One s.18" });
  }
  return items;
}

function DealChecklist(p) {
  var items = p.items || [];
  var checks = p.checks || {};
  var onToggle = p.onToggle;
  if (items.length === 0) return null;
  var done = items.filter(function(it) { return checks[it.id]; }).length;
  return (
    <div style={{ background: T.s1, borderRadius: 10, border: "1px solid " + T.bd, padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: MO, color: T.ac, letterSpacing: "0.08em" }}>DEAL CHECKLIST</div>
        <div style={{ fontSize: 9, fontFamily: MO, color: done === items.length ? T.ok : T.dm }}>{done + "/" + items.length}</div>
      </div>
      {items.map(function(it) {
        var checked = !!checks[it.id];
        return (
          <div key={it.id} onClick={function() { onToggle(it.id); }}
            style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: "1px solid " + T.bd + "20", cursor: "pointer" }}>
            <div style={{ width: 16, height: 16, borderRadius: 3, border: "1px solid " + (checked ? T.ok : T.bd), background: checked ? T.ok : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
              {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>Y</span>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: checked ? T.ok : T.tx, textDecoration: checked ? "line-through" : "none" }}>{it.label}</div>
              <div style={{ fontSize: 8, color: T.ac, fontFamily: MO, marginTop: 1, opacity: 0.7 }}>{it.cite}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ====================================================================
// QUICK CHECK + SUBMIT (unified agent view)
// ====================================================================
function QuickCheck(p) {
  var phState = useState("upload");
  var fnState = useState("");
  var prState = useState("");
  var flState = useState(null);
  var rsState = useState([]);
  var ftState = useState("residential");
  var cxState = useState("la");
  var nmState = useState("");
  var snState = useState(false);
  var exState = useState(false);
  var trsOpen = useState(false);
  var submitOpen = useState(false);
  var clState = useState({});
  var ref = useRef(null);
  var dragState = useState(false);

  var phase = phState[0], setPhase = phState[1];
  var fname = fnState[0], setFname = fnState[1];
  var fields = flState[0], setFields = flState[1];
  var results = rsState[0], setResults = rsState[1];
  var formType = ftState[0], setFormType = ftState[1];
  var ctx = cxState[0], setCtx = cxState[1];
  var name = nmState[0], setName = nmState[1];
  var submitted = snState[0], setSubmitted = snState[1];
  var showExtracted = exState[0], setShowExtracted = exState[1];
  var checklist = clState[0], setChecklist = clState[1];

  var go = useCallback(function(f) {
    setPhase("proc"); setFname(f.name); setSubmitted(false); trsOpen[1](false); submitOpen[1](false); setChecklist({});
    extractOffer(f, formType, prState[1]).then(function(r) {
      r.fields.formType = formType === "condo" ? "condo_unit" : "residential";
      setFields(r.fields);
      setResults(runRules(r.fields, ctx || "la", formType));
      setPhase("done");
    }).catch(function(e) {
      prState[1]("Error: " + e.message);
      setPhase("error");
    });
  }, [formType, ctx]);

  var active = results.filter(function(r) { return !r.suppressed; });
  var triggered = active.filter(function(r) { return r.triggered; });
  var passed = active.filter(function(r) { return !r.triggered; });
  var suppressed = results.filter(function(r) { return r.suppressed; });
  var cnt = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  triggered.forEach(function(r) { cnt[r.sev]++; });
  var grade = cnt.CRITICAL > 0 ? "FAIL" : cnt.HIGH > 2 ? "REVIEW" : cnt.HIGH > 0 ? "CAUTION" : "PASS";
  var gradeColor = gC(grade);
  var isRejected = fields && fields.sellerResponse === "rejects";
  var ctxLabel = { w: "Writing", lp: "Listing Pre", la: "Listing Post" }[ctx] || "Full Review";

  var reset = function() { setPhase("upload"); setResults([]); setFields(null); setSubmitted(false); setShowExtracted(false); trsOpen[1](false); submitOpen[1](false); setChecklist({}); };

  var checklistItems = fields ? buildChecklist(fields) : [];
  var toggleCheck = function(id) {
    setChecklist(function(prev) {
      var n = {}; Object.keys(prev).forEach(function(k) { n[k] = prev[k]; });
      n[id] = !prev[id];
      return n;
    });
  };

  var submit = function() {
    var entry = {
      id: String(Date.now()), fn: fname, agent: name || "Agent", ctx: ctx || "la",
      g: grade, cnt: cnt, tr: triggered, pa: passed, f: fields,
      at: new Date().toISOString(), bs: "pending", bn: "",
      cl: checklist
    };
    saveOffer(entry);
    p.onSubmit(entry);
    setSubmitted(true);
  };

  var fl = fields;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      {phase === "upload" && (
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Offer Compliance Check</div>
          <div style={{ fontSize: 13, color: T.m, marginBottom: 6 }}>Check your offer instantly. Submit to broker when ready.</div>
          <div style={{ fontSize: 11, color: T.ac, marginBottom: 20, fontFamily: MO }}>{ACTIVE_RULE_COUNT + " rules | RESA + Regulation citations"}</div>

          <div style={{ fontSize: 9, color: T.dm, fontFamily: MO, marginBottom: 4, letterSpacing: "0.1em" }}>FORM TYPE</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["residential", "Residential"], ["condo", "Condo Unit"]].map(function(a) {
              return (
                <button key={a[0]} onClick={function() { setFormType(a[0]); }}
                  style={{ flex: 1, padding: "10px 8px", background: formType === a[0] ? T.ad : T.s1, border: "1px solid " + (formType === a[0] ? T.ac : T.bd), borderRadius: 8, cursor: "pointer", textAlign: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: formType === a[0] ? T.ac : T.tx }}>{a[1]}</div>
                </button>
              );
            })}
          </div>

          <div onClick={function() { ref.current.click(); }}
            onDragOver={function(e) { e.preventDefault(); e.stopPropagation(); dragState[1](true); }}
            onDragEnter={function(e) { e.preventDefault(); e.stopPropagation(); dragState[1](true); }}
            onDragLeave={function(e) { e.preventDefault(); e.stopPropagation(); dragState[1](false); }}
            onDrop={function(e) {
              e.preventDefault(); e.stopPropagation(); dragState[1](false);
              var files = e.dataTransfer && e.dataTransfer.files;
              if (files && files.length > 0 && /\.pdf$/i.test(files[0].name)) go(files[0]);
            }}
            style={{ border: "2px dashed " + (dragState[0] ? T.ac : T.ac + "40"), borderRadius: 12, padding: "50px 20px", textAlign: "center", cursor: "pointer", background: dragState[0] ? T.ad : "transparent" }}>
            <input ref={ref} type="file" accept=".pdf" onChange={function(e) { var f = e.target.files && e.target.files[0]; if (f) go(f); }} style={{ display: "none" }} />
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>PDF</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: dragState[0] ? T.ac : T.tx }}>{dragState[0] ? "Drop PDF here" : "Click or drag offer PDF"}</div>
          </div>
        </div>
      )}

      {phase === "proc" && (
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ width: 36, height: 36, border: "3px solid " + T.bd, borderTop: "3px solid " + T.ac, borderRadius: "50%", margin: "0 auto 20px", animation: "spin 0.8s linear infinite" }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{fname}</div>
          <div style={{ fontSize: 12, color: T.m, fontFamily: MO }}>{prState[0]}</div>
        </div>
      )}

      {phase === "error" && (
        <div style={{ textAlign: "center", padding: "60px 20px" }}>
          <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.5 }}>!</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.cr, marginBottom: 8 }}>Analysis Failed</div>
          <div style={{ fontSize: 11, color: T.m, fontFamily: MO, maxWidth: 500, margin: "0 auto 16px", wordBreak: "break-word" }}>{prState[0]}</div>
          <button onClick={reset} style={{ padding: "10px 24px", background: T.s1, border: "1px solid " + T.bd, borderRadius: 8, color: T.tx, fontSize: 12, cursor: "pointer" }}>Try Again</button>
        </div>
      )}

      {phase === "done" && fl && (
        <div>
          {/* Grade */}
          <div style={{ textAlign: "center", padding: "20px 16px", marginBottom: 14, background: T.s1, borderRadius: 12, border: "1px solid " + T.bd }}>
            <div style={{ fontSize: 9, color: T.dm, textTransform: "uppercase", fontFamily: MO, letterSpacing: "0.15em" }}>Compliance Check</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: gradeColor, fontFamily: MO }}>{grade}</div>
            <div style={{ fontSize: 11, color: T.m }}>{fl.propAddr || fname}</div>
            <div style={{ fontSize: 10, color: T.dm, marginTop: 4 }}>{(fl.buyerName || "?") + " to " + (fl.sellerName || "?") + " | $" + (fl.effectivePrice ? Number(fl.effectivePrice).toLocaleString() : (fl.purchasePrice ? Number(fl.purchasePrice).toLocaleString() : "?"))}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 12 }}>
              {[["C", cnt.CRITICAL, T.cr], ["H", cnt.HIGH, T.hi], ["M", cnt.MEDIUM, T.md], ["L", cnt.LOW, T.lo], ["OK", passed.length, T.ok]].map(function(a) {
                return <div key={a[0]}><div style={{ fontSize: 20, fontWeight: 700, color: a[2], fontFamily: MO }}>{a[1]}</div><div style={{ fontSize: 8, color: T.dm }}>{a[0]}</div></div>;
              })}
            </div>
            {suppressed.length > 0 && (
              <div style={{ fontSize: 9, color: T.dm, marginTop: 8, fontFamily: MO }}>{suppressed.length + " rules suppressed (" + ctxLabel + " context)"}</div>
            )}
          </div>

          {/* Rejected offer notice */}
          {isRejected && (
            <div style={{ padding: "12px 16px", marginBottom: 14, background: T.cb, border: "1px solid " + T.cr + "30", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.cr }}>REJECTED OFFER</div>
              <div style={{ fontSize: 11, color: T.m, marginTop: 4 }}>Not submitted for broker review. Fix flagged issues before your next offer.</div>
            </div>
          )}

          {/* Amendments */}
          {fl.hasAm && (
            <div style={{ marginBottom: 12, padding: "10px 14px", background: T.hb, border: "1px solid " + T.hi + "25", borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.hi, fontFamily: MO, marginBottom: 6 }}>COUNTER-OFFER AMENDMENTS</div>
              {(fl._am || []).map(function(a, i) {
                return <div key={i} style={{ fontSize: 11, marginBottom: 4, lineHeight: 1.5 }}>
                  <span style={{ color: T.m }}>{a.field}: </span>
                  <span style={{ color: T.cr, textDecoration: "line-through" }}>{a.original}</span>
                  <span style={{ color: T.dm }}>{" -> "}</span>
                  <span style={{ color: T.ok, fontWeight: 600 }}>{a.amended}</span>
                </div>;
              })}
            </div>
          )}

          {/* Issues */}
          {triggered.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, fontFamily: MO, marginBottom: 6 }}>{"ISSUES (" + triggered.length + ")"}</div>
              <SectionIssues issues={triggered} />
            </div>
          )}

          {/* Extracted Fields */}
          <div style={{ marginBottom: 12 }}>
            <div onClick={function() { setShowExtracted(!showExtracted); }} style={{ fontSize: 10, fontWeight: 700, fontFamily: MO, color: T.ac, cursor: "pointer", padding: "6px 0" }}>
              {(showExtracted ? "- " : "+ ") + "EXTRACTED FIELDS"}
            </div>
            {showExtracted && (
              <div style={{ background: T.s1, borderRadius: 8, border: "1px solid " + T.bd, padding: 10 }}>
                {[
                  ["Form Type", fl.formType === "condo_unit" ? "Condo Unit OTP" : "Residential OTP"],
                  ["Buyer", fl.buyerName], ["Seller", fl.sellerName], ["Property", fl.propAddr],
                  ["Legal Desc", fl.legalDescription],
                  ["Offer Price", fl.purchasePrice ? "$" + Number(fl.purchasePrice).toLocaleString() : ""],
                  ["Counter Price", fl._hasCounterPrice ? "$" + Number(fl.counterOfferPrice).toLocaleString() : ""],
                  ["Selling Price", fl.effectivePrice ? "$" + Number(fl.effectivePrice).toLocaleString() : ""],
                  ["Mortgage", fl.mortgageBox + (fl.mortgageAmount ? " ($" + Number(fl.mortgageAmount).toLocaleString() + ")" : "")],
                  ["Possession", fl.possessionDate], ["Deposit", fl.depositTotal + (fl.hasDepositMethod ? " via " + (fl.depositMethods || []).join(", ") : "")],
                  ["PDS", fl.pdsChoice], ["Homestead", fl.homestead], ["Residency", fl.residency],
                  ["Seller Response", fl.sellerResponse], ["Irrevocability", fl.irrevocability || ""]
                ].map(function(r) {
                  return <div key={r[0]} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid " + T.bd + "20" }}>
                    <span style={{ fontSize: 10, color: T.dm, minWidth: 90 }}>{r[0]}</span>
                    <span style={{ fontSize: 10, fontFamily: MO, color: r[1] ? T.tx : T.cr, textAlign: "right", flex: 1, marginLeft: 8, wordBreak: "break-word" }}>{r[1] || "-"}</span>
                  </div>;
                })}
              </div>
            )}
          </div>

          {/* Passed */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 10, fontWeight: 700, color: T.ok, fontFamily: MO, cursor: "pointer" }}>{"PASSED (" + passed.length + ")"}</summary>
            <div style={{ marginTop: 4 }}>{passed.map(function(r) { return <div key={r.id} style={{ padding: "3px 8px", fontSize: 9, color: T.ok, fontFamily: MO }}>{r.id + " " + r.check}</div>; })}</div>
          </details>

          {/* SUBMIT TO BROKER section */}
          {!isRejected && (
            <div style={{ marginBottom: 14 }}>
              <button onClick={function() { submitOpen[1](!submitOpen[0]); }}
                style={{ width: "100%", padding: 12, background: submitOpen[0] ? T.ac + "15" : T.ad, border: "1px solid " + T.ac + "40", borderRadius: 8, color: T.ac, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: SA }}>
                {(submitOpen[0] ? "- " : "+ ") + "Submit to Broker"}
              </button>

              {submitOpen[0] && (
                <div style={{ marginTop: 10, padding: 14, background: T.s1, borderRadius: 10, border: "1px solid " + T.bd }}>
                  {/* Agent info */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.dm, fontFamily: MO, marginBottom: 6, letterSpacing: "0.08em" }}>AGENT DETAILS</div>
                    <input placeholder="Your name" value={name} onChange={function(e) { setName(e.target.value); }}
                      style={{ width: "100%", padding: "8px 12px", background: T.bg, border: "1px solid " + T.bd, borderRadius: 6, color: T.tx, fontSize: 12, outline: "none", boxSizing: "border-box", fontFamily: SA, marginBottom: 8 }} />
                  </div>

                  {/* Trade Record Sheet + Checklist */}
                  <div style={{ marginBottom: 12 }}>
                    <button onClick={function() { trsOpen[1](!trsOpen[0]); }}
                      style={{ width: "100%", padding: 8, background: trsOpen[0] ? T.s2 : T.bg, border: "1px solid " + T.bd, borderRadius: 6, color: T.ac, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: SA }}>
                      {(trsOpen[0] ? "- " : "+ ") + "Trade Record Sheet + Deal Checklist"}
                    </button>
                    {trsOpen[0] && (
                      <div style={{ marginTop: 8 }}>
                        <DealChecklist items={checklistItems} checks={checklist} onToggle={toggleCheck} />
                        <TradeRecordSheet fields={fl} />
                      </div>
                    )}
                  </div>

                  {/* Submit */}
                  {submitted ? (
                    <div style={{ padding: 14, background: T.ob, borderRadius: 8, textAlign: "center", border: "1px solid " + T.ok + "30" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ok }}>Submitted to Broker Queue</div>
                    </div>
                  ) : (
                    <button onClick={submit} disabled={!name.trim()}
                      style={{ width: "100%", padding: 12, background: !name.trim() ? T.dm : cnt.CRITICAL > 0 ? T.cr : T.ac, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, cursor: name.trim() ? "pointer" : "not-allowed", opacity: name.trim() ? 1 : 0.5 }}>
                      {cnt.CRITICAL > 0 ? "Submit (Critical Issues Present)" : "Submit to Broker"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Reset */}
          <button onClick={reset} style={{ width: "100%", padding: 10, background: "transparent", border: "1px solid " + T.bd, borderRadius: 8, color: T.m, fontSize: 11, cursor: "pointer" }}>Check Another Offer</button>
        </div>
      )}
    </div>
  );
}

// ====================================================================
// MAIN APP
// ====================================================================
export default function App() {
  var viewState = useState("check");
  var queueState = useState([]);
  var view = viewState[0], setView = viewState[1];
  var queue = queueState[0], setQueue = queueState[1];

  useEffect(function() {
    var l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }, []);

  useEffect(function() {
    loadIndex().then(function(ids) {
      if (!ids || ids.length === 0) return;
      return Promise.all(ids.map(function(id) { return loadOffer(id); })).then(function(entries) { setQueue(entries.filter(Boolean)); });
    }).catch(function() {});
  }, []);

  var handleSubmit = function(entry) { setQueue(function(prev) { return [entry].concat(prev); }); };
  var handleUpdate = function(id, status, notes) {
    setQueue(function(prev) { return prev.map(function(x) {
      if (x.id !== id) return x;
      var u = {}; Object.keys(x).forEach(function(k) { u[k] = x[k]; }); u.bs = status; u.bn = notes || x.bn; return u;
    }); });
  };

  var pendingCount = queue.filter(function(x) { return x.bs === "pending"; }).length;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.tx, fontFamily: SA }}>
      <div style={{ borderBottom: "1px solid " + T.bd, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: T.s1, height: 54 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.ac, boxShadow: "0 0 8px " + T.ac + "60" }} />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.14em", fontFamily: MO }}>OFFERGUARD</span>
          <span style={{ fontSize: 8, color: T.ac, fontFamily: MO, padding: "2px 6px", background: T.ad, borderRadius: 3 }}>v4.8</span>
          <span style={{ fontSize: 8, color: T.ok, fontFamily: MO, padding: "2px 6px", background: T.ok + "15", borderRadius: 3 }}>{ACTIVE_RULE_COUNT + " RULES"}</span>
        </div>
        <div style={{ display: "flex", background: T.bg, borderRadius: 6, padding: 2, border: "1px solid " + T.bd }}>
          {[["check", "Check + Submit"], ["broker", "Broker"]].map(function(a) {
            var k = a[0], label = a[1];
            var active = view === k;
            var badge = k === "broker" && pendingCount > 0 && !active;
            return <button key={k} onClick={function() { setView(k); }}
              style={{ padding: "6px 16px", borderRadius: 4, border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: MO, background: active ? T.ac : "transparent", color: active ? "#fff" : T.dm, position: "relative" }}>
              {label}
              {badge && <span style={{ position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: T.cr, color: "#fff", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{pendingCount}</span>}
            </button>;
          })}
        </div>
      </div>
      {view === "check" ? <QuickCheck onSubmit={handleSubmit} /> : <BrokerView queue={queue} onUpdate={handleUpdate} />}
    </div>
  );
}
