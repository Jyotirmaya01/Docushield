/**
 * DocuShield Configuration & Constants
 * Tactical Border Security Screener (SSB Checkpoint CP-04)
 */

export const CONFIG = {
  APP_NAME: 'DocuShield',
  VERSION: '1.0.0-PROD',
  SECTOR: 'SSB Sector 04 - Panitanki Checkpoint (Indo-Nepal)',
  CHECKPOINT_ID: 'CP-04-NORTH',
  TERMINAL_ID: 'TERM-SSB-9942',
  
  OFFICER: {
    name: 'Inspector Rameshwar Singh',
    rank: 'Inspector / Screening Lead',
    id: 'SSB-7489-N',
    shift: '06:00 - 14:00 (Alpha)',
    badge: 'SSB-VET-441'
  },

  THRESHOLDS: {
    MAX_AUTO_APPROVE_RISK: 35,    // Risk score <= 35 -> Auto-Approve (High Confidence)
    MIN_FACE_MATCH_PCT: 80,       // Biometric match >= 80%
    MIN_LAPLACIAN_VAR: 90,        // Blur check threshold (variance > 90 is sharp)
    MAX_OVEREXPOSURE_PCT: 14,     // Glare check: max 14% of pixels > 245
    MAX_UNDEREXPOSURE_PCT: 45,    // Darkness check: max 45% of pixels < 30
    MIN_ASPECT_RATIO: 1.25,       // Passport/ID aspect bounds
    MAX_ASPECT_RATIO: 1.65
  },

  WEIGHTS: {
    MRZ_CHECKSUM: 0.25,
    FIELD_CONSISTENCY: 0.15,
    CHRONOLOGY_LOGIC: 0.15,
    TAMPER_CNN: 0.25,
    FACE_MATCH: 0.15,
    HIDDEN_TEXT_INJECTION: 0.05
  },

  // ICAO 9303 3-Letter Country Code List (ISO 3166-1 alpha-3)
  ICAO_COUNTRIES: {
    'IND': 'India', 'NPL': 'Nepal', 'BTN': 'Bhutan', 'BGD': 'Bangladesh',
    'LKA': 'Sri Lanka', 'MDV': 'Maldives', 'MMR': 'Myanmar', 'PAK': 'Pakistan',
    'AFG': 'Afghanistan', 'CHN': 'China', 'GBR': 'United Kingdom', 'USA': 'United States',
    'CAN': 'Canada', 'AUS': 'Australia', 'DEU': 'Germany', 'FRA': 'France',
    'JPN': 'Japan', 'SGP': 'Singapore', 'MYS': 'Malaysia', 'THA': 'Thailand',
    'ARE': 'United Arab Emirates', 'SAU': 'Saudi Arabia', 'QAT': 'Qatar', 'KWT': 'Kuwait',
    'OMN': 'Oman', 'RUS': 'Russian Federation', 'ITA': 'Italy', 'ESP': 'Spain',
    'NLD': 'Netherlands', 'CHE': 'Switzerland', 'SWE': 'Sweden', 'NOR': 'Norway',
    'KOR': 'Republic of Korea', 'VNM': 'Viet Nam', 'IDN': 'Indonesia', 'PHL': 'Philippines',
    'NZL': 'New Zealand', 'ZAF': 'South Africa', 'BRA': 'Brazil', 'MEX': 'Mexico',
    'TUR': 'Turkey', 'ISR': 'Israel', 'EGY': 'Egypt', 'IRN': 'Iran', 'IRQ': 'Iraq'
  }
};
