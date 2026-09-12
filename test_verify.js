// Node.js pipeline verification test
import { computeCheckDigit, MRZValidator } from './src/pipeline/mrzValidator.js';
import { SAMPLE_SPECIMENS } from './src/samples.js';

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

console.log('--- ALL PIPELINE VALIDATION TESTS PASSED! ---');
