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

// Case E: Blank / unreadable live scan must NEVER default to Rahul Sharma or fake dates
const ocrRes5 = OCREngine.extractFieldsByTemplate('', 'passport', {});
console.log('Real Scan 5 (Blank scan):', { name: ocrRes5.name, dob: ocrRes5.date_of_birth, docNum: ocrRes5.document_number, nat: ocrRes5.nationality });
if (ocrRes5.name && (ocrRes5.name.includes('RAHUL') || ocrRes5.name.includes('SHARMA'))) {
  console.error('FAIL: Blank scan must never default to Rahul Sharma!');
  process.exit(1);
}
if (ocrRes5.date_of_birth !== null && ocrRes5.date_of_birth !== undefined) {
  console.error('FAIL: Blank scan must have null date_of_birth, not fake default!');
  process.exit(1);
}
if (ocrRes5.document_number !== null && ocrRes5.document_number !== undefined) {
  console.error('FAIL: Blank scan must have null document_number, not fake default!');
  process.exit(1);
}

// Case F: Verify all real fields extracted accurately
const fullDocText = "PASSPORT\nNAME: AMITA CHEN\nDOCUMENT NO: K9928103\nNATIONALITY: IND\nDATE OF BIRTH: 1991-05-18\nSEX: F\nEXPIRY DATE: 2031-05-17";
const ocrRes6 = OCREngine.extractFieldsByTemplate(fullDocText, 'passport', {});
console.log('Real Scan 6 (Full Real Doc):', ocrRes6);
if (ocrRes6.name !== 'AMITA CHEN' || ocrRes6.document_number !== 'K9928103' || ocrRes6.nationality !== 'IND' || ocrRes6.date_of_birth !== '1991-05-18' || ocrRes6.gender !== 'F' || ocrRes6.expiry_date !== '2031-05-17') {
  console.error('FAIL: Real Scan 6 should extract 100% real document data!');
  process.exit(1);
}

console.log('--- 3. Testing QualityGate Auto-Capture & Detail Detection ---');
import { QualityGate } from './src/cv/qualityGate.js';

// Case G: Clear document with high-frequency text details ready for auto-capture
const mockW = 360;
const mockH = 270;
const mockBuf = new Uint8ClampedArray(mockW * mockH * 4);

// Background
for (let i = 0; i < mockW * mockH; i++) {
  mockBuf[i * 4] = 235;
  mockBuf[i * 4 + 1] = 235;
  mockBuf[i * 4 + 2] = 235;
  mockBuf[i * 4 + 3] = 255;
}

// Inner document edges & high contrast boundary
for (let x = 36; x < 324; x++) {
  const top = (40 * mockW + x) * 4;
  const bot = (230 * mockW + x) * 4;
  mockBuf[top] = 20; mockBuf[top+1] = 20; mockBuf[top+2] = 20;
  mockBuf[bot] = 20; mockBuf[bot+1] = 20; mockBuf[bot+2] = 20;
}
for (let y = 40; y < 230; y++) {
  const left = (y * mockW + 36) * 4;
  const right = (y * mockW + 324) * 4;
  mockBuf[left] = 20; mockBuf[left+1] = 20; mockBuf[left+2] = 20;
  mockBuf[right] = 20; mockBuf[right+1] = 20; mockBuf[right+2] = 20;
}

// Draw alternating high-contrast text lines inside document body
for (let y = 60; y < 210; y += 8) {
  for (let x = 60; x < 300; x += 3) {
    const idx = (y * mockW + x) * 4;
    mockBuf[idx] = 10; mockBuf[idx+1] = 10; mockBuf[idx+2] = 10;
  }
}

const mockImg = { width: mockW, height: mockH, data: mockBuf };
const qRes = QualityGate.analyzeImageQuality(mockImg);
console.log('QualityGate Auto-Capture Check:', {
  passed: qRes.passed,
  hasDocument: qRes.hasDocument,
  detailsVisible: qRes.detailsVisible,
  readyForAutoCapture: qRes.readyForAutoCapture,
  laplacianVariance: qRes.laplacianVariance,
  detailDensityPct: qRes.detailDensityPct
});

if (!qRes.hasDocument || !qRes.detailsVisible || !qRes.readyForAutoCapture) {
  console.error('FAIL: Sharp document with visible text details must trigger readyForAutoCapture!');
  process.exit(1);
}

// Case H: Blank blurry surface must NOT trigger auto-capture
const blankBuf = new Uint8ClampedArray(mockW * mockH * 4);
for (let i = 0; i < mockW * mockH; i++) {
  blankBuf[i * 4] = 180;
  blankBuf[i * 4 + 1] = 180;
  blankBuf[i * 4 + 2] = 180;
  blankBuf[i * 4 + 3] = 255;
}
const blankQ = QualityGate.analyzeImageQuality({ width: mockW, height: mockH, data: blankBuf });
console.log('Blank surface check (should NOT auto-capture):', { readyForAutoCapture: blankQ.readyForAutoCapture });
if (blankQ.readyForAutoCapture) {
  console.error('FAIL: Blank surface must never trigger auto-capture!');
  process.exit(1);
}

console.log('--- ALL PIPELINE, OCR, AND AUTO-CAPTURE TESTS PASSED! ---');
