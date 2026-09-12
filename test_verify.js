// Node.js pipeline verification test
import { computeCheckDigit, MRZValidator } from './src/pipeline/mrzValidator.js';
import { SAMPLE_SPECIMENS } from './src/samples.js';
import { OCREngine } from './src/pipeline/ocrEngine.js';

console.log('--- 1. Testing MRZ Checksum Algorithm ---');
// Test ICAO Document 9303 standard test vectors
// Document number: 'HA672242<' -> check digit
const docNum = 'HA672242<';
const check1 = computeCheckDigit(docNum);
console.log(`Document number ${docNum} check digit:`, check1);

// Test Sample 1 (Ramesh Thapa / Rahul Sharma)
const genuineSpecimen = SAMPLE_SPECIMENS.find(s => s.id === 'specimen-genuine-ind') || SAMPLE_SPECIMENS[0];
const mrzResult1 = MRZValidator.validate(genuineSpecimen.mrzLines);
console.log('Genuine Sample Validation Result:', {
  isValid: mrzResult1.isValid,
  fullName: mrzResult1.fullName,
  docNumber: mrzResult1.documentNumber,
  checks: mrzResult1.checks.map(c => `${c.field}: ${c.passed ? 'PASS' : 'FAIL'}`)
});

if (!mrzResult1.isValid) {
  console.error('FAIL: Genuine sample should be valid!');
  process.exit(1);
}

console.log('--- 2. Testing Real Data OCR Field Extraction (No Rahul Sharma Default) ---');

// Case A: Real US Passport scan (Johnathan Archer)
const usPassportText = "UNITED STATES OF AMERICA\nPASSPORT\nNAME: JOHNATHAN ARCHER\nPASSPORT NO: P9081234\nNATIONALITY: USA\nDATE OF BIRTH: 1980-04-12\nSEX: M\nEXPIRY: 2030-04-11";
const ocrRes1 = OCREngine.extractFieldsByTemplate(usPassportText, 'passport', {});
console.log('Real Scan 1 (Johnathan Archer):', { name: ocrRes1.name, docNum: ocrRes1.document_number, nat: ocrRes1.nationality });
if (ocrRes1.name !== 'JOHNATHAN ARCHER' || ocrRes1.document_number !== 'P9081234') {
  console.error('FAIL: Real scan 1 should extract JOHNATHAN ARCHER and P9081234!');
  process.exit(1);
}

// Case B: Real Scan with Surname & Given Names (Priya Tandon)
const indPassportText = "REPUBLIC OF INDIA\nSURNAME: TANDON\nGIVEN NAMES: PRIYA\nDOCUMENT NO: J4410982\nNATIONALITY: IND\nDATE OF BIRTH: 1994-08-20\nSEX: F";
const ocrRes2 = OCREngine.extractFieldsByTemplate(indPassportText, 'passport', {});
console.log('Real Scan 2 (Priya Tandon):', { name: ocrRes2.name, docNum: ocrRes2.document_number });
if (ocrRes2.name !== 'PRIYA TANDON' || ocrRes2.document_number !== 'J4410982') {
  console.error('FAIL: Real scan 2 should extract PRIYA TANDON and J4410982!');
  process.exit(1);
}

// Case C: Real MRZ lines for Pooja Verma
const mrzText = "PASSPORT\nP<INDVERMA<<POOJA<<<<<<<<<<<<<<<<<<<<<<<<<<<\nP8829104<2IND9408221F3105194<<<<<<<<<<<<<<<2";
const ocrRes3 = OCREngine.extractFieldsByTemplate(mrzText, 'passport', {});
console.log('Real Scan 3 (Pooja Verma MRZ):', { name: ocrRes3.name, docNum: ocrRes3.document_number });
if (ocrRes3.name !== 'POOJA VERMA' || ocrRes3.document_number !== 'P8829104') {
  console.error('FAIL: Real scan 3 should extract POOJA VERMA and P8829104 from MRZ!');
  process.exit(1);
}

// Case D: Real National ID for Sunil Thapa
const nidText = "GOVERNMENT OF NEPAL\nCITIZENSHIP IDENTITY CARD\nFULL NAME: SUNIL THAPA\nCITIZENSHIP NO: NP-0921448\nDATE OF BIRTH: 1990-11-25";
const ocrRes4 = OCREngine.extractFieldsByTemplate(nidText, 'national_id', {});
console.log('Real Scan 4 (Sunil Thapa ID):', { name: ocrRes4.name, docNum: ocrRes4.document_number });
if (ocrRes4.name !== 'SUNIL THAPA' || ocrRes4.document_number !== 'NP-0921448') {
  console.error('FAIL: Real scan 4 should extract SUNIL THAPA and NP-0921448!');
  process.exit(1);
}

// Case E: Blank / unreadable live scan must NEVER default to Rahul Sharma
const ocrRes5 = OCREngine.extractFieldsByTemplate('', 'passport', {});
console.log('Real Scan 5 (Blank scan):', { name: ocrRes5.name });
if (ocrRes5.name.includes('RAHUL') || ocrRes5.name.includes('SHARMA')) {
  console.error('FAIL: Blank scan must never default to Rahul Sharma!');
  process.exit(1);
}

console.log('--- ALL PIPELINE & OCR EXTRACTION TESTS PASSED! ---');
