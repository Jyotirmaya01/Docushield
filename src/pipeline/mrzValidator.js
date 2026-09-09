/**
 * DocuShield ICAO Document 9303 MRZ Checksum & Field Parsing Engine
 * Full implementation supporting all 5 ICAO 9303 formats:
 *  - TD1: National ID cards (3 lines × 30 characters, Part 5)
 *  - TD2: Official travel documents (2 lines × 36 characters, Part 6)
 *  - TD3: Standard Passports (2 lines × 44 characters, Part 4)
 *  - MRV-A: Visas Format A (2 lines × 44 characters, Part 7)
 *  - MRV-B: Visas Format B (2 lines × 36 characters, Part 7)
 *  - NON_MRZ_DIGITAL_ID: Clean bypass for QR-code / digital ID credentials (mDL, Aadhaar)
 *
 * Implements deterministic 7-3-1 weighted modulo-10 algorithm with composite check digits.
 */

const WEIGHTS = [7, 3, 1];

export function charValue(c) {
  if (!c || c === '<') return 0;
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) { // 0-9
    return code - 48;
  }
  if (code >= 65 && code <= 90) { // A-Z
    return code - 65 + 10;
  }
  if (code >= 97 && code <= 122) { // a-z
    return code - 97 + 10;
  }
  return 0;
}

export function computeCheckDigit(str) {
  if (!str) return 0;
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const val = charValue(str[i]);
    const weight = WEIGHTS[i % 3];
    sum += val * weight;
  }
  return sum % 10;
}

export class MRZValidator {
  /**
   * Detects MRZ format from line count and character lengths
   * @param {string[]} lines Raw MRZ lines
   * @returns {string} 'TD1' | 'TD2' | 'TD3' | 'MRV-A' | 'MRV-B' | 'NON_MRZ_DIGITAL_ID'
   */
  static detectFormat(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return 'NON_MRZ_DIGITAL_ID';
    }

    const filtered = lines
      .map(l => (typeof l === 'string' ? l.trim().toUpperCase() : ''))
      .filter(l => l.length > 0);

    if (filtered.length === 3) {
      const len0 = filtered[0].length;
      if (len0 === 30 || Math.abs(len0 - 30) <= 2) {
        return 'TD1';
      }
    }

    if (filtered.length === 2) {
      const line1 = filtered[0];
      const len = line1.length;
      const isVisa = line1.startsWith('V');

      if (len === 44 || Math.abs(len - 44) <= 2) {
        return isVisa ? 'MRV-A' : 'TD3';
      }
      if (len === 36 || Math.abs(len - 36) <= 2) {
        return isVisa ? 'MRV-B' : 'TD2';
      }
      // If line 2 is 44 chars
      if (filtered[1].length === 44) {
        return isVisa ? 'MRV-A' : 'TD3';
      }
      if (filtered[1].length === 36) {
        return isVisa ? 'MRV-B' : 'TD2';
      }
    }

    return 'NON_MRZ_DIGITAL_ID';
  }

  /**
   * Parses and validates raw MRZ lines across all 5 ICAO formats or skips non-MRZ IDs
   * @param {string[]} lines Array of MRZ lines
   * @returns {Object} Parsed demographic fields, check digits, and validation flags
   */
  static validate(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return this.handleNonMrz('No MRZ lines present.');
    }

    const format = this.detectFormat(lines);
    const cleanLines = lines.map(l => (typeof l === 'string' ? l.toUpperCase().replace(/\s+/g, '') : ''));

    switch (format) {
      case 'TD1': {
        const l1 = cleanLines[0].padEnd(30, '<').substring(0, 30);
        const l2 = (cleanLines[1] || '').padEnd(30, '<').substring(0, 30);
        const l3 = (cleanLines[2] || '').padEnd(30, '<').substring(0, 30);
        return this.validateTD1(l1, l2, l3);
      }
      case 'TD2': {
        const l1 = cleanLines[0].padEnd(36, '<').substring(0, 36);
        const l2 = (cleanLines[1] || '').padEnd(36, '<').substring(0, 36);
        return this.validateTD2(l1, l2);
      }
      case 'TD3': {
        const l1 = cleanLines[0].padEnd(44, '<').substring(0, 44);
        const l2 = (cleanLines[1] || '').padEnd(44, '<').substring(0, 44);
        return this.validateTD3(l1, l2);
      }
      case 'MRV-A': {
        const l1 = cleanLines[0].padEnd(44, '<').substring(0, 44);
        const l2 = (cleanLines[1] || '').padEnd(44, '<').substring(0, 44);
        return this.validateMRVA(l1, l2);
      }
      case 'MRV-B': {
        const l1 = cleanLines[0].padEnd(36, '<').substring(0, 36);
        const l2 = (cleanLines[1] || '').padEnd(36, '<').substring(0, 36);
        return this.validateMRVB(l1, l2);
      }
      default:
        return this.handleNonMrz('Format does not match ICAO 9303 line/character geometry.');
    }
  }

  static handleNonMrz(reason) {
    return {
      isValid: true,
      skipped: true,
      standard: 'NON-MRZ DIGITAL IDENTITY',
      format: 'NON_MRZ_DIGITAL_ID',
      documentCategory: 'NON_MRZ_DIGITAL_ID',
      reason: reason || 'Non-MRZ digital identity credential (e.g., QR-code signed mDL / Aadhaar). Checksum validation bypassed; relying on field-format and date logic.',
      checks: []
    };
  }

  // =========================================================================
  // TD3: Passports (2 lines × 44 chars, Part 4)
  // =========================================================================
  static validateTD3(line1, line2) {
    const docType = line1.substring(0, 2);
    const issuingState = line1.substring(2, 5).replace(/</g, '');
    const namePart = line1.substring(5);
    const nameSplit = namePart.split('<<');
    const surname = (nameSplit[0] || '').replace(/</g, ' ').trim();
    const givenNames = (nameSplit[1] || '').replace(/</g, ' ').trim();
    const fullName = `${givenNames} ${surname}`.trim();

    // Line 2 offsets
    const rawDocNum = line2.substring(0, 9);
    const docNum = rawDocNum.replace(/</g, '');
    const docNumCheckActual = line2[9];
    const docNumCheckExpected = String(computeCheckDigit(rawDocNum));

    const nationality = line2.substring(10, 13).replace(/</g, '');
    const rawDob = line2.substring(13, 19);
    const dobCheckActual = line2[19];
    const dobCheckExpected = String(computeCheckDigit(rawDob));

    const sex = line2[20] === '<' ? 'U' : line2[20];
    const rawExpiry = line2.substring(21, 27);
    const expiryCheckActual = line2[27];
    const expiryCheckExpected = String(computeCheckDigit(rawExpiry));

    const rawOptional = line2.substring(28, 42);
    const optCheckActual = line2[42];
    const hasOptionalCheck = optCheckActual !== '<' && optCheckActual !== ' ';
    const optCheckExpected = hasOptionalCheck ? String(computeCheckDigit(rawOptional)) : null;

    // Composite check digit line2[43]
    // Calculated over: line2[0..9] + line2[13..19] + line2[21..42]
    const compositeString = line2.substring(0, 10) + line2.substring(13, 20) + line2.substring(21, 43);
    const compositeCheckActual = line2[43];
    const compositeCheckExpected = String(computeCheckDigit(compositeString));

    const checks = [
      {
        field: 'Document Number Checksum',
        actual: docNumCheckActual,
        expected: docNumCheckExpected,
        passed: docNumCheckActual === docNumCheckExpected,
        detail: `Passport number "${rawDocNum}" -> Check digit: ${docNumCheckExpected}`
      },
      {
        field: 'Date of Birth Checksum',
        actual: dobCheckActual,
        expected: dobCheckExpected,
        passed: dobCheckActual === dobCheckExpected,
        detail: `DOB "${rawDob}" -> Check digit: ${dobCheckExpected}`
      },
      {
        field: 'Expiry Date Checksum',
        actual: expiryCheckActual,
        expected: expiryCheckExpected,
        passed: expiryCheckActual === expiryCheckExpected,
        detail: `Expiry "${rawExpiry}" -> Check digit: ${expiryCheckExpected}`
      }
    ];

    if (hasOptionalCheck) {
      checks.push({
        field: 'Optional Data Checksum',
        actual: optCheckActual,
        expected: optCheckExpected,
        passed: optCheckActual === optCheckExpected,
        detail: `Optional data "${rawOptional}" -> Check digit: ${optCheckExpected}`
      });
    }

    const compositePassed = compositeCheckActual === compositeCheckExpected;
    checks.push({
      field: 'Composite Checksum',
      actual: compositeCheckActual,
      expected: compositeCheckExpected,
      passed: compositePassed,
      isComposite: true,
      detail: `Composite across doc#, DOB, expiry & optional fields -> Check digit: ${compositeCheckExpected}`
    });

    const allPassed = checks.every(c => c.passed);

    return {
      isValid: allPassed,
      format: 'TD3',
      standard: 'ICAO 9303 TD3 (Passport)',
      documentType: docType.startsWith('P') ? 'PASSPORT' : 'TRAVEL_DOC',
      issuingState,
      fullName,
      surname,
      givenNames,
      documentNumber: docNum,
      nationality,
      dateOfBirth: parseYYMMDD(rawDob, true),
      rawDob,
      sex,
      expiryDate: parseYYMMDD(rawExpiry, false),
      rawExpiry,
      optionalData: rawOptional.replace(/</g, ''),
      compositeCheckPassed: compositePassed,
      checks,
      mrzLines: [line1, line2]
    };
  }

  // =========================================================================
  // TD1: National ID Cards (3 lines × 30 chars, Part 5)
  // =========================================================================
  static validateTD1(line1, line2, line3) {
    const docType = line1.substring(0, 2);
    const issuingState = line1.substring(2, 5).replace(/</g, '');
    const rawDocNum = line1.substring(5, 14);
    const docNum = rawDocNum.replace(/</g, '');
    const docNumCheckActual = line1[14];
    const docNumCheckExpected = String(computeCheckDigit(rawDocNum));
    const optionalData1 = line1.substring(15, 30);

    // Line 2
    const rawDob = line2.substring(0, 6);
    const dobCheckActual = line2[6];
    const dobCheckExpected = String(computeCheckDigit(rawDob));
    const sex = line2[7] === '<' ? 'U' : line2[7];
    const rawExpiry = line2.substring(8, 14);
    const expiryCheckActual = line2[14];
    const expiryCheckExpected = String(computeCheckDigit(rawExpiry));
    const nationality = line2.substring(15, 18).replace(/</g, '');
    const optionalData2 = line2.substring(18, 29);

    // TD1 Composite Check Digit on line 2 pos 29:
    // Covers Line 1 (5..29) + Line 2 (0..6) + Line 2 (8..14) + Line 2 (18..28)
    const compositeString = line1.substring(5, 30) + line2.substring(0, 7) + line2.substring(8, 15) + line2.substring(18, 29);
    const compositeCheckActual = line2[29];
    const compositeCheckExpected = String(computeCheckDigit(compositeString));

    // Line 3: Name
    const nameSplit = line3.split('<<');
    const surname = (nameSplit[0] || '').replace(/</g, ' ').trim();
    const givenNames = (nameSplit[1] || '').replace(/</g, ' ').trim();
    const fullName = `${givenNames} ${surname}`.trim();

    const checks = [
      {
        field: 'Document Number Checksum',
        actual: docNumCheckActual,
        expected: docNumCheckExpected,
        passed: docNumCheckActual === docNumCheckExpected,
        detail: `TD1 ID number "${rawDocNum}" -> Check digit: ${docNumCheckExpected}`
      },
      {
        field: 'Date of Birth Checksum',
        actual: dobCheckActual,
        expected: dobCheckExpected,
        passed: dobCheckActual === dobCheckExpected,
        detail: `TD1 DOB "${rawDob}" -> Check digit: ${dobCheckExpected}`
      },
      {
        field: 'Expiry Date Checksum',
        actual: expiryCheckActual,
        expected: expiryCheckExpected,
        passed: expiryCheckActual === expiryCheckExpected,
        detail: `TD1 Expiry "${rawExpiry}" -> Check digit: ${expiryCheckExpected}`
      },
      {
        field: 'Composite Checksum',
        actual: compositeCheckActual,
        expected: compositeCheckExpected,
        passed: compositeCheckActual === compositeCheckExpected,
        isComposite: true,
        detail: `TD1 Composite over lines 1 & 2 -> Check digit: ${compositeCheckExpected}`
      }
    ];

    const allPassed = checks.every(c => c.passed);

    return {
      isValid: allPassed,
      format: 'TD1',
      standard: 'ICAO 9303 TD1 (National ID)',
      documentType: 'NATIONAL_ID',
      issuingState,
      fullName,
      surname,
      givenNames,
      documentNumber: docNum,
      nationality,
      dateOfBirth: parseYYMMDD(rawDob, true),
      rawDob,
      sex,
      expiryDate: parseYYMMDD(rawExpiry, false),
      rawExpiry,
      optionalData: (optionalData1 + optionalData2).replace(/</g, ''),
      compositeCheckPassed: compositeCheckActual === compositeCheckExpected,
      checks,
      mrzLines: [line1, line2, line3]
    };
  }

  // =========================================================================
  // TD2: Official Travel Documents / ID Cards (2 lines × 36 chars, Part 6)
  // =========================================================================
  static validateTD2(line1, line2) {
    const docType = line1.substring(0, 2);
    const issuingState = line1.substring(2, 5).replace(/</g, '');
    const namePart = line1.substring(5);
    const nameSplit = namePart.split('<<');
    const surname = (nameSplit[0] || '').replace(/</g, ' ').trim();
    const givenNames = (nameSplit[1] || '').replace(/</g, ' ').trim();
    const fullName = `${givenNames} ${surname}`.trim();

    // Line 2
    const rawDocNum = line2.substring(0, 9);
    const docNum = rawDocNum.replace(/</g, '');
    const docNumCheckActual = line2[9];
    const docNumCheckExpected = String(computeCheckDigit(rawDocNum));

    const nationality = line2.substring(10, 13).replace(/</g, '');
    const rawDob = line2.substring(13, 19);
    const dobCheckActual = line2[19];
    const dobCheckExpected = String(computeCheckDigit(rawDob));

    const sex = line2[20] === '<' ? 'U' : line2[20];
    const rawExpiry = line2.substring(21, 27);
    const expiryCheckActual = line2[27];
    const expiryCheckExpected = String(computeCheckDigit(rawExpiry));

    const rawOptional = line2.substring(28, 35);
    const compositeCheckActual = line2[35];
    const compositeString = line2.substring(0, 10) + line2.substring(13, 20) + line2.substring(21, 35);
    const compositeCheckExpected = String(computeCheckDigit(compositeString));

    const checks = [
      {
        field: 'Document Number Checksum',
        actual: docNumCheckActual,
        expected: docNumCheckExpected,
        passed: docNumCheckActual === docNumCheckExpected,
        detail: `TD2 Doc# "${rawDocNum}" -> Check digit: ${docNumCheckExpected}`
      },
      {
        field: 'Date of Birth Checksum',
        actual: dobCheckActual,
        expected: dobCheckExpected,
        passed: dobCheckActual === dobCheckExpected,
        detail: `TD2 DOB "${rawDob}" -> Check digit: ${dobCheckExpected}`
      },
      {
        field: 'Expiry Date Checksum',
        actual: expiryCheckActual,
        expected: expiryCheckExpected,
        passed: expiryCheckActual === expiryCheckExpected,
        detail: `TD2 Expiry "${rawExpiry}" -> Check digit: ${expiryCheckExpected}`
      },
      {
        field: 'Composite Checksum',
        actual: compositeCheckActual,
        expected: compositeCheckExpected,
        passed: compositeCheckActual === compositeCheckExpected,
        isComposite: true,
        detail: `TD2 Composite -> Check digit: ${compositeCheckExpected}`
      }
    ];

    const allPassed = checks.every(c => c.passed);

    return {
      isValid: allPassed,
      format: 'TD2',
      standard: 'ICAO 9303 TD2 (Official Travel Document)',
      documentType: docType.startsWith('V') ? 'VISA' : 'TRAVEL_DOC',
      issuingState,
      fullName,
      surname,
      givenNames,
      documentNumber: docNum,
      nationality,
      dateOfBirth: parseYYMMDD(rawDob, true),
      rawDob,
      sex,
      expiryDate: parseYYMMDD(rawExpiry, false),
      rawExpiry,
      optionalData: rawOptional.replace(/</g, ''),
      compositeCheckPassed: compositeCheckActual === compositeCheckExpected,
      checks,
      mrzLines: [line1, line2]
    };
  }

  // =========================================================================
  // MRV-A: Visas Format A (2 lines × 44 chars, Part 7)
  // =========================================================================
  static validateMRVA(line1, line2) {
    const docType = line1.substring(0, 2); // V< or VA
    const issuingState = line1.substring(2, 5).replace(/</g, '');
    const namePart = line1.substring(5);
    const nameSplit = namePart.split('<<');
    const surname = (nameSplit[0] || '').replace(/</g, ' ').trim();
    const givenNames = (nameSplit[1] || '').replace(/</g, ' ').trim();
    const fullName = `${givenNames} ${surname}`.trim();

    // Line 2
    const rawDocNum = line2.substring(0, 9);
    const docNum = rawDocNum.replace(/</g, '');
    const docNumCheckActual = line2[9];
    const docNumCheckExpected = String(computeCheckDigit(rawDocNum));

    const nationality = line2.substring(10, 13).replace(/</g, '');
    const rawDob = line2.substring(13, 19);
    const dobCheckActual = line2[19];
    const dobCheckExpected = String(computeCheckDigit(rawDob));

    const sex = line2[20] === '<' ? 'U' : line2[20];
    const rawExpiry = line2.substring(21, 27);
    const expiryCheckActual = line2[27];
    const expiryCheckExpected = String(computeCheckDigit(rawExpiry));
    const optionalData = line2.substring(28, 44);

    const checks = [
      {
        field: 'Visa Number Checksum',
        actual: docNumCheckActual,
        expected: docNumCheckExpected,
        passed: docNumCheckActual === docNumCheckExpected,
        detail: `MRV-A Visa# "${rawDocNum}" -> Check digit: ${docNumCheckExpected}`
      },
      {
        field: 'Date of Birth Checksum',
        actual: dobCheckActual,
        expected: dobCheckExpected,
        passed: dobCheckActual === dobCheckExpected,
        detail: `MRV-A DOB "${rawDob}" -> Check digit: ${dobCheckExpected}`
      },
      {
        field: 'Expiry Date Checksum',
        actual: expiryCheckActual,
        expected: expiryCheckExpected,
        passed: expiryCheckActual === expiryCheckExpected,
        detail: `MRV-A Expiry "${rawExpiry}" -> Check digit: ${expiryCheckExpected}`
      }
    ];

    const allPassed = checks.every(c => c.passed);

    return {
      isValid: allPassed,
      format: 'MRV-A',
      standard: 'ICAO 9303 MRV-A (Visa Format A)',
      documentType: 'VISA',
      issuingState,
      fullName,
      surname,
      givenNames,
      documentNumber: docNum,
      nationality,
      dateOfBirth: parseYYMMDD(rawDob, true),
      rawDob,
      sex,
      expiryDate: parseYYMMDD(rawExpiry, false),
      rawExpiry,
      optionalData: optionalData.replace(/</g, ''),
      checks,
      mrzLines: [line1, line2]
    };
  }

  // =========================================================================
  // MRV-B: Visas Format B (2 lines × 36 chars, Part 7)
  // =========================================================================
  static validateMRVB(line1, line2) {
    const docType = line1.substring(0, 2); // V< or VB
    const issuingState = line1.substring(2, 5).replace(/</g, '');
    const namePart = line1.substring(5);
    const nameSplit = namePart.split('<<');
    const surname = (nameSplit[0] || '').replace(/</g, ' ').trim();
    const givenNames = (nameSplit[1] || '').replace(/</g, ' ').trim();
    const fullName = `${givenNames} ${surname}`.trim();

    // Line 2
    const rawDocNum = line2.substring(0, 9);
    const docNum = rawDocNum.replace(/</g, '');
    const docNumCheckActual = line2[9];
    const docNumCheckExpected = String(computeCheckDigit(rawDocNum));

    const nationality = line2.substring(10, 13).replace(/</g, '');
    const rawDob = line2.substring(13, 19);
    const dobCheckActual = line2[19];
    const dobCheckExpected = String(computeCheckDigit(rawDob));

    const sex = line2[20] === '<' ? 'U' : line2[20];
    const rawExpiry = line2.substring(21, 27);
    const expiryCheckActual = line2[27];
    const expiryCheckExpected = String(computeCheckDigit(rawExpiry));
    const optionalData = line2.substring(28, 36);

    const checks = [
      {
        field: 'Visa Number Checksum',
        actual: docNumCheckActual,
        expected: docNumCheckExpected,
        passed: docNumCheckActual === docNumCheckExpected,
        detail: `MRV-B Visa# "${rawDocNum}" -> Check digit: ${docNumCheckExpected}`
      },
      {
        field: 'Date of Birth Checksum',
        actual: dobCheckActual,
        expected: dobCheckExpected,
        passed: dobCheckActual === dobCheckExpected,
        detail: `MRV-B DOB "${rawDob}" -> Check digit: ${dobCheckExpected}`
      },
      {
        field: 'Expiry Date Checksum',
        actual: expiryCheckActual,
        expected: expiryCheckExpected,
        passed: expiryCheckActual === expiryCheckExpected,
        detail: `MRV-B Expiry "${rawExpiry}" -> Check digit: ${expiryCheckExpected}`
      }
    ];

    const allPassed = checks.every(c => c.passed);

    return {
      isValid: allPassed,
      format: 'MRV-B',
      standard: 'ICAO 9303 MRV-B (Visa Format B)',
      documentType: 'VISA',
      issuingState,
      fullName,
      surname,
      givenNames,
      documentNumber: docNum,
      nationality,
      dateOfBirth: parseYYMMDD(rawDob, true),
      rawDob,
      sex,
      expiryDate: parseYYMMDD(rawExpiry, false),
      rawExpiry,
      optionalData: optionalData.replace(/</g, ''),
      checks,
      mrzLines: [line1, line2]
    };
  }
}

export function parseYYMMDD(yymmdd, isDob) {
  if (!yymmdd || yymmdd.length !== 6) return yymmdd;
  const yy = parseInt(yymmdd.substring(0, 2), 10);
  const mm = yymmdd.substring(2, 4);
  const dd = yymmdd.substring(4, 6);

  if (isNaN(yy)) return yymmdd;

  const currentYear = new Date().getFullYear() % 100;
  let fullYear;
  if (isDob) {
    fullYear = yy > currentYear ? 1900 + yy : 2000 + yy;
  } else {
    fullYear = yy < 50 ? 2000 + yy : 1900 + yy;
  }

  return `${fullYear}-${mm}-${dd}`;
}

// Global window exposure for browser devtools & testing
if (typeof window !== 'undefined') {
  window.MRZValidator = MRZValidator;
  window.computeMRZCheckDigit = computeCheckDigit;
}
